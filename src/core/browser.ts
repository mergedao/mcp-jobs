import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
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
  if (!process.env.MCP_JOBS_PROFILE_DIR) migrateLegacyProfiles(dir);
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
  let launchFailed = false;
  child.once('error', () => { launchFailed = true; });
  child.unref();
  // 等 CDP 就绪
  const deadline = Date.now() + 20_000;
  while (!launchFailed && Date.now() < deadline) {
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
