import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { chromium, Browser } from 'playwright';
import { httpJson, jitterPause, portOpen, rawConnect, rawSend, raceAbort, hostOf } from './cdp';

/**
 * 托管浏览器层：单 profile + 单调试端口服务全部平台。
 * 一个 Chrome profile 天然共存所有平台的登录态，用户只面对一个窗口；
 * 多账号场景用不同的 MCP_JOBS_PROFILE_DIR + MCP_JOBS_CDP_PORT 再起一套。
 */

export function profileDir(): string {
  return process.env.MCP_JOBS_PROFILE_DIR || path.join(os.homedir(), '.mcp-jobs', 'profile');
}

export function managedCdpUrl(): string {
  return `http://127.0.0.1:${process.env.MCP_JOBS_CDP_PORT || '9223'}`;
}

export function chromeBinary(): string {
  return process.env.MCP_JOBS_CHROME_PATH || process.env.BOSS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

/**
 * 迁移旧版分平台 profile 到统一 profile（一次性）：
 * 旧 boss-profile 里已有 BOSS 登录态，拷贝过来用户就不用重新扫码。
 */
function migrateLegacyProfiles(target: string): void {
  if (fs.existsSync(target)) return;
  const legacy = path.join(os.homedir(), '.mcp-jobs', 'boss-profile');
  if (fs.existsSync(legacy)) {
    try {
      fs.cpSync(legacy, target, { recursive: true, force: false });
    } catch { /* 拷贝失败就从头建 profile */ }
  }
}

/** 拉起托管 Chrome（单实例幂等）：独立 profile + 调试端口，进程脱离本会话存活。 */
export async function ensureManagedChrome(preferredUrl = 'about:blank'): Promise<boolean> {
  const cdpUrl = managedCdpUrl();
  if (await portOpen(cdpUrl)) return true;
  if (!fs.existsSync(chromeBinary())) return false;
  const dir = profileDir();
  migrateLegacyProfiles(dir);
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    `--remote-debugging-port=${new URL(cdpUrl).port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    preferredUrl
  ];
  const child = spawn(chromeBinary(), args, { detached: true, stdio: 'ignore' });
  child.unref();
  // 等 CDP 就绪
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await portOpen(cdpUrl)) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

/** 把指定标签带到前台——仅在需要用户登录时使用（唯一允许抢焦点的地方）。 */
export async function activateTab(cdpUrl: string, targetId: string): Promise<void> {
  const session = await rawConnect((await httpJson<{ webSocketDebuggerUrl?: string }>(`${cdpUrl}/json/version`))?.webSocketDebuggerUrl ?? '').catch(() => null);
  if (!session) return;
  await rawSend(session, 'Target.activateTarget', { targetId }).catch(() => {});
}

/** 打开（或复用）一个页面并返回 targetId；url 为空则只复用不新建。 */
export async function openPage(cdpUrl: string, url: string, opts?: { activate?: boolean; reuseHostOf?: string }): Promise<string | null> {
  const tabs = await httpJson<any[]>(`${cdpUrl}/json/list`);
  if (!tabs) return null;
  let tab: any;
  if (opts?.reuseHostOf) {
    const host = hostOf(opts.reuseHostOf);
    tab = tabs.find((t: any) => t.type === 'page' && hostOf(t.url ?? '') === host);
  }
  if (!tab && url) {
    // 开新标签前加随机噪声，且这是全局唯一会动标签布局的地方
    await jitterPause(300, 900);
    tab = await httpJson(`${cdpUrl}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  }
  if (!tab?.id) return null;
  if (opts?.activate) await activateTab(cdpUrl, tab.id);
  return tab.id as string;
}

/* ---------- 供猎聘/51job 使用的 Playwright 共享浏览器（页面内 fetch，需完整浏览器上下文） ---------- */

let browserPromise: Promise<Browser> | null = null;

export async function closeSharedBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => {});
}

export async function sharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBestBrowser().catch(error => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

/** 优先本机真实 Chrome（指纹先验最强），失败落回 Playwright 内置 Chromium。 */
async function launchBestBrowser(): Promise<Browser> {
  const headless = process.env.CRAWLER_HEADLESS !== 'false';
  try {
    return await chromium.launch({ headless, channel: 'chrome' });
  } catch {
    return chromium.launch({ headless });
  }
}

/** 页面内同源 fetch：浏览器先打开 origin 过掉 WAF/环境挑战，再用页面自己的 TLS/Cookie/源调 API。 */
export async function inPageFetch(
  originUrl: string,
  apiUrl: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  signal?: AbortSignal,
  timeoutMs = 15000
): Promise<unknown> {
  const browser = await sharedBrowser();
  const context = await browser.newContext({ locale: 'zh-CN' }).catch(() => null);
  if (!context) return null;
  try {
    const pageHandle = await context.newPage();
    await jitterPause(400, 1200); // 导航噪声
    await raceAbort(pageHandle.goto(originUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs - 2000, 10000) }), signal);
    // WAF/风控 JS 需要在页面里跑一小段才算通过
    await jitterPause(900, 1800);
    return await raceAbort(
      pageHandle.evaluate(async ({ url, init }: { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }) => {
        const response = await fetch(url, init);
        const text = await response.text();
        try { return JSON.parse(text); } catch { return null; }
      }, { url: apiUrl, init }),
      signal
    );
  } finally {
    await context.close().catch(() => {});
  }
}
