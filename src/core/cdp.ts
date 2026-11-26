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
  if (signal.aborted) {
    void promise.catch(() => {});
    throw new Error('aborted');
  }
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
  const timeout = AbortSignal.timeout(4000);
  const signal = init?.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
  return fetch(url, { ...init, signal }).then(r => r.ok ? r.json() : null).catch(() => null);
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
  if (signal?.aborted) return null;
  const entry = await rawEnsurePage(cdpUrl, roleKey, targetUrl);
  if (!entry || signal?.aborted) return null;
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

/** 通用：导航目标页并捕获 Document 主文档响应体（SSR 数据提取用；同样零 Runtime 附加）。 */
export async function rawCaptureDocument(
  cdpUrl: string,
  roleKey: string,
  targetUrl: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string | null> {
  if (signal?.aborted) return null;
  const entry = await rawEnsurePage(cdpUrl, roleKey, targetUrl);
  if (!entry || signal?.aborted) return null;
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
