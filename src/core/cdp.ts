import * as net from 'net';

/**
 * 裸 CDP 会话层：只用最小协议域（Network/Page/Storage/Target）。
 * 为什么不用 Playwright/Puppeteer：它们的附加会启用 Runtime 域，
 * 招聘站的 browser-check 风控 JS 能通过 console 陷阱探测到，命中即跳空白并标记环境。
 * 本层保持零自动化特征：真实 Chrome + 真实用户指纹 + 被动网络监听。
 */

export type RawSession = {
  ws: { send: (data: string) => void; close: () => void; readyState: number };
  seq: number;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  listeners: Set<(msg: any) => void>;
};

const WS_IMPL: any = (globalThis as any).WebSocket;
const rawSessions = new Map<string, RawSession>();

export function rawConnect(wsUrl: string): Promise<RawSession> {
  const cached = rawSessions.get(wsUrl);
  if (cached && cached.ws.readyState === 1) return Promise.resolve(cached);
  rawSessions.delete(wsUrl);
  if (!WS_IMPL) return Promise.reject(new Error('当前 Node 无 WebSocket 支持'));
  return new Promise((resolve, reject) => {
    const ws = new WS_IMPL(wsUrl);
    const session: RawSession = { ws, seq: 1, pending: new Map(), listeners: new Set() };
    ws.onopen = () => { rawSessions.set(wsUrl, session); resolve(session); };
    ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'));
    ws.onclose = () => rawSessions.delete(wsUrl);
    ws.onmessage = (ev: any) => {
      let msg: any;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.id && session.pending.has(msg.id)) {
        const entry = session.pending.get(msg.id)!;
        session.pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(String(msg.error.message ?? 'CDP 错误')));
        else entry.resolve(msg.result);
      } else if (msg.method) {
        for (const listener of session.listeners) {
          try { listener(msg); } catch { /* 监听器异常不中断会话 */ }
        }
      }
    };
  });
}

export function rawSend<T = any>(session: RawSession, method: string, params?: Record<string, unknown>): Promise<T> {
  const id = session.seq++;
  return new Promise<T>((resolve, reject) => {
    session.pending.set(id, { resolve, reject });
    session.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    setTimeout(() => {
      if (session.pending.has(id)) {
        session.pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }
    }, 15000);
  });
}

export function rawClose(wsUrl: string): void {
  const session = rawSessions.get(wsUrl);
  if (session) {
    try { session.ws.close(); } catch { /* 已断开 */ }
    rawSessions.delete(wsUrl);
  }
}

export function rawCloseAll(): void {
  for (const [, session] of rawSessions) {
    try { session.ws.close(); } catch { /* 已断开 */ }
  }
  rawSessions.clear();
}

/** 浏览器级命令（Storage/Target 域）会话：不附加任何页面，零探测面。 */
export async function rawBrowserSession(cdpUrl: string): Promise<RawSession | null> {
  const version = await httpJson<{ webSocketDebuggerUrl?: string }>(`${cdpUrl}/json/version`);
  const wsUrl = version?.webSocketDebuggerUrl;
  if (!wsUrl) return null;
  return rawConnect(wsUrl).catch(() => null);
}

export function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 随机抖动等待：给页面操作之间加人类节奏噪声（反频控基线）。 */
export function jitterPause(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(minMs + Math.random() * Math.max(maxMs - minMs, 1));
  return pause(ms);
}

export async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(new Error('aborted'));
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', cancel); resolve(value); },
      error => { signal.removeEventListener('abort', cancel); reject(error); }
    );
  });
}

export async function httpJson<T = any>(url: string, init?: RequestInit): Promise<T | null> {
  return fetch(url, init).then(r => r.json()).catch(() => null);
}

export function safeJsonParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** CDP 端口快速探测，避免漫长重试。 */
export function portOpen(cdpUrl: string, timeoutMs = 800): Promise<boolean> {
  return new Promise(resolve => {
    let hostname = '127.0.0.1';
    let port = 9223;
    try {
      const parsed = new URL(cdpUrl);
      if (parsed.hostname) hostname = parsed.hostname;
      if (parsed.port) port = Number(parsed.port);
    } catch { /* 用默认值 */ }
    const socket = net.connect({ host: hostname, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/* ---------- 页面会话管理：按 role 绑定标签，targetId 跟踪，去抖防抢焦点 ---------- */

export type BoundPage = { session: RawSession; wsUrl: string; targetId: string };

const boundPages = new Map<string, BoundPage>();
const lastTabSpawnAt = new Map<string, number>();

/** 找到 role 绑定的标签页并挂最小域监听；丢了才补开，且 20s 内不重复补（避免来回抢焦点）。 */
export async function rawEnsurePage(cdpUrl: string, roleKey: string, preferredUrl: string): Promise<BoundPage | null> {
  const key = `${cdpUrl}#${roleKey}`;
  const cached = boundPages.get(key);
  if (cached && cached.session.ws.readyState === 1) {
    // 校验 target 还活着（用户可能关了标签）
    const tabs = await httpJson<any[]>(`${cdpUrl}/json/list`);
    if (tabs?.some((t: any) => t.id === cached.targetId && t.type === 'page')) return cached;
    rawClose(cached.wsUrl);
    boundPages.delete(key);
  }
  const lastSpawn = lastTabSpawnAt.get(key) ?? 0;
  if (Date.now() - lastSpawn < 20_000) return null; // 去抖：刚开过不再补，避免来回抢焦点
  const spawnTab = async (): Promise<{ id: string; webSocketDebuggerUrl: string } | null> => {
    // 优先复用同站现存标签（用户/上轮留下的），不新开
    const tabs = await httpJson<any[]>(`${cdpUrl}/json/list`);
    const host = hostOf(preferredUrl);
    const sameSite = (tabs ?? []).find((t: any) => t.type === 'page' && hostOf(t.url ?? '') === host);
    if (sameSite?.webSocketDebuggerUrl) return sameSite;
    const created = await httpJson(`${cdpUrl}/json/new?${encodeURIComponent(preferredUrl)}`, { method: 'PUT' });
    return created?.id ? created : null;
  };
  lastTabSpawnAt.set(key, Date.now());
  const tab = await spawnTab();
  if (!tab?.webSocketDebuggerUrl) return null;
  const session = await rawConnect(tab.webSocketDebuggerUrl).catch(() => null);
  if (!session) return null;
  await rawSend(session, 'Page.enable').catch(() => {});
  await rawSend(session, 'Network.enable').catch(() => {});
  const entry: BoundPage = { session, wsUrl: tab.webSocketDebuggerUrl, targetId: tab.id };
  boundPages.set(key, entry);
  return entry;
}

/** 通用：导航目标页并被动旁听匹配模式的 JSON 响应（无 Runtime 附加，风控无感）。导航前加随机噪声。
 *  多候选机制：同导航可能触发多个匹配请求（如智联 204 预检 + 200 真数据），
 *  响应体解析失败或未通过 validate 校验（如智联 210 瞬态）就继续等下一个，绝不提前放弃。 */
export async function rawCaptureJson(
  cdpUrl: string,
  roleKey: string,
  targetUrl: string,
  responsePattern: RegExp,
  timeoutMs: number,
  signal?: AbortSignal,
  validate?: (json: any, responseUrl: string) => boolean
): Promise<unknown | null> {
  const entry = await rawEnsurePage(cdpUrl, roleKey, targetUrl);
  if (!entry) return null;
  const { session } = entry;
  return new Promise(resolve => {
    let settled = false;
    const candidates = new Set<string>();
    const tried = new Set<string>();
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.listeners.delete(handler);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const tryRead = (requestId: string) => {
      if (tried.has(requestId)) return;
      tried.add(requestId);
      rawSend<{ body: string; base64Encoded: boolean }>(session, 'Network.getResponseBody', { requestId })
        .then(body => {
          const parsed = safeJsonParse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body);
          const url = responseUrls.get(requestId) ?? '';
          if (parsed !== null && typeof parsed === 'object' && (!validate || validate(parsed, url))) finish(parsed);
          else candidates.delete(requestId); // 空体/非 JSON/校验不过（如 210 瞬态）：继续等其他候选
        })
        .catch(() => candidates.delete(requestId));
    };
    const responseUrls = new Map<string, string>();
    const handler = (msg: any) => {
      if (msg.method === 'Network.responseReceived') {
        const url = String(msg.params?.response?.url ?? '');
        if (responsePattern.test(url)) {
          candidates.add(String(msg.params.requestId));
          responseUrls.set(String(msg.params.requestId), url);
        }
      }
      if (msg.method === 'Network.loadingFinished' && candidates.has(String(msg.params?.requestId))) {
        tryRead(String(msg.params.requestId));
      }
      if (msg.method === 'Network.loadingFailed') {
        candidates.delete(String(msg.params?.requestId));
      }
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), Math.max(timeoutMs, 4000));
    session.listeners.add(handler);
    signal?.addEventListener('abort', onAbort, { once: true });
    // 导航前人类节奏噪声（有界，不挤爆预算）
    jitterPause(350, 1200).then(() => {
      if (!settled) rawSend(session, 'Page.navigate', { url: targetUrl }).catch(() => finish(null));
    });
  });
}

export function resetBoundPages(): void {
  boundPages.clear();
  lastTabSpawnAt.clear();
}

/* ---------- DOM/输入操作（写操作专用）：DOM 域找元素（支持文字搜索，不用 Runtime），
   Input 域派发受信任事件（isTrusted=true），全程人类节奏噪声。 ---------- */

export type DomNode = { nodeId: number; html: string };

/** 确保 DOM 域就绪的页面会话。 */
export async function rawDomPage(cdpUrl: string, roleKey: string, preferredUrl: string): Promise<BoundPage | null> {
  const entry = await rawEnsurePage(cdpUrl, roleKey, preferredUrl);
  if (!entry) return null;
  await rawSend(entry.session, 'DOM.enable').catch(() => {});
  return entry;
}

/** 按文字/选择器搜索节点（DOM.performSearch 支持 CSS 选择器与文字）。 */
export async function domSearch(session: RawSession, query: string, maxNodes = 8): Promise<DomNode[]> {
  try {
    await rawSend(session, 'DOM.getDocument', { depth: 0 }).catch(() => {}); // 初始化 DOM 代理树
    const search = await rawSend<{ searchId: string; resultCount: number }>(session, 'DOM.performSearch', { query, caseSensitive: false });
    if (!search.resultCount) return [];
    const results = await rawSend<{ nodeIds: number[] }>(session, 'DOM.getSearchResults', {
      searchId: search.searchId,
      fromIndex: 0,
      toIndex: Math.min(search.resultCount, maxNodes)
    });
    const nodes: DomNode[] = [];
    for (const nodeId of results.nodeIds ?? []) {
      const html = await rawSend<{ outerHTML: string }>(session, 'DOM.getOuterHTML', { nodeId })
        .then(r => r.outerHTML).catch(() => '');
      nodes.push({ nodeId, html });
    }
    return nodes;
  } catch {
    return [];
  }
}

/** 节点内容盒中心坐标（用于鼠标点击）。 */
export async function domBoxCenter(session: RawSession, nodeId: number): Promise<{ x: number; y: number } | null> {
  try {
    const model = await rawSend<{ model: { content: number[] } }>(session, 'DOM.getBoxModel', { nodeId });
    const c = model.model?.content;
    if (!c || c.length < 8) return null;
    const x = (c[0] + c[2] + c[4] + c[6]) / 4;
    const y = (c[1] + c[3] + c[5] + c[7]) / 4;
    return { x: Math.round(x), y: Math.round(y) };
  } catch {
    return null;
  }
}

/** 人类节奏点击：多段鼠标移动带抖动 → 按下 → 停顿 → 抬起。 */
export async function humanClickAt(session: RawSession, x: number, y: number): Promise<void> {
  // 分 3 段逼近目标，每段带 ±3px 抖动
  let cx = x + (Math.random() * 40 - 20);
  let cy = y + (Math.random() * 30 - 15);
  const steps = 3 + Math.floor(Math.random() * 2);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    cx += (x - cx) * t;
    cy += (y - cy) * t;
    await rawSend(session, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(cx + (Math.random() * 4 - 2)),
      y: Math.round(cy + (Math.random() * 4 - 2))
    }).catch(() => {});
    await pause(40 + Math.floor(Math.random() * 90));
  }
  await rawSend(session, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }).catch(() => {});
  await pause(120 + Math.floor(Math.random() * 260)); // 点前停顿
  await rawSend(session, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }).catch(() => {});
  await pause(60 + Math.floor(Math.random() * 90));
  await rawSend(session, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }).catch(() => {});
  await pause(200 + Math.floor(Math.random() * 400)); // 点后停顿
}

/** 人类节奏滚动（滚轮事件）。 */
export async function humanScroll(session: RawSession, x: number, y: number, deltaY: number): Promise<void> {
  await rawSend(session, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }).catch(() => {});
  await pause(300 + Math.floor(Math.random() * 600));
}

/** 人类节奏输入文字：先点击聚焦，再逐字符键盘事件（随机 45-140ms/字符）。 */
export async function humanType(session: RawSession, x: number, y: number, text: string): Promise<void> {
  await humanClickAt(session, x, y);
  for (const ch of text) {
    await rawSend(session, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: ch,
      unmodifiedText: ch,
      key: ch
    }).catch(() => {});
    await rawSend(session, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ch
    }).catch(() => {});
    await pause(45 + Math.floor(Math.random() * 95));
  }
}

/** 页面等待（被动）：等指定文字出现在 DOM（轮询 DOM.performSearch，零 Runtime）。 */
export async function waitForText(session: RawSession, text: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !signal?.aborted) {
    const nodes = await domSearch(session, text, 1);
    if (nodes.length) return true;
    await pause(800 + Math.floor(Math.random() * 700));
  }
  return false;
}

/**
 * 写操作安全闸（review P0）：把 role 标签导航到确认单指定的职位页，并核对当前页面
 * 确实是目标职位——职位标题片段出现在 DOM 中。核对不过即失败中止，
 * 防止「确认单是 A 职位、点击却发生在 B 页面」的错目标风险。
 */
export async function navigateAndVerifyTarget(
  session: RawSession,
  jobUrl: string,
  titleFragment: string | undefined,
  timeoutMs = 20000,
  signal?: AbortSignal
): Promise<{ ok: boolean; detail: string }> {
  await rawSend(session, 'Page.navigate', { url: jobUrl }).catch(() => {});
  const deadline = Date.now() + timeoutMs;
  // 无标题时：导航目标就是确认单 URL 本身（URL 即绑定），等页面稳定后放行
  if (!titleFragment) {
    await pause(2500);
    return { ok: true, detail: '已导航到确认单 URL（无标题可核对）' };
  }
  const frag = titleFragment.trim().slice(0, 12);
  while (Date.now() < deadline && !signal?.aborted) {
    const hits = await domSearch(session, frag, 1);
    if (hits.length) return { ok: true, detail: `目标核对通过（标题「${frag}」命中）` };
    await pause(800 + Math.floor(Math.random() * 600));
  }
  return {
    ok: false,
    detail: `目标核对失败：${Math.round(timeoutMs / 1000)}s 内未在页面确认到「${frag}」。为防错目标已中止写操作`
  };
}

/** 通用：导航目标页并捕获 Document 主文档响应体（SSR 数据提取用；同样零 Runtime 附加）。 */
export async function rawCaptureDocument(
  cdpUrl: string,
  roleKey: string,
  targetUrl: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string | null> {
  const entry = await rawEnsurePage(cdpUrl, roleKey, targetUrl);
  if (!entry) return null;
  const { session } = entry;
  const host = hostOf(targetUrl);
  return new Promise(resolve => {
    let settled = false;
    let docId: string | null = null;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.listeners.delete(handler);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const handler = (msg: any) => {
      if (msg.method === 'Network.responseReceived' && msg.params?.type === 'Document' && hostOf(String(msg.params?.response?.url ?? '')).endsWith(host)) {
        docId = String(msg.params.requestId);
      }
      if (docId && msg.method === 'Network.loadingFinished' && String(msg.params?.requestId) === docId) {
        rawSend<{ body: string; base64Encoded: boolean }>(session, 'Network.getResponseBody', { requestId: docId })
          .then(body => finish(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body))
          .catch(() => finish(null));
      }
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), Math.max(timeoutMs, 4000));
    session.listeners.add(handler);
    signal?.addEventListener('abort', onAbort, { once: true });
    jitterPause(350, 1200).then(() => {
      if (!settled) rawSend(session, 'Page.navigate', { url: targetUrl }).catch(() => finish(null));
    });
  });
}
