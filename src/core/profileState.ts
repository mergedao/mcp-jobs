import * as fs from 'fs';
import * as path from 'path';
import { profileDir, managedCdpUrl } from './browser';
import { portOpen } from './cdp';
import { bossLoginCookieExpiry, zhipinLoggedIn } from '../platforms/zhipin';

/**
 * profile 状态感知：被动、无打扰地感知各平台登录态，持久化到状态文件。
 * MCP server 启动时按 MCP_JOBS_PROFILE_POLL_MS 周期自检（默认 10 分钟，0=关闭），
 * agent 通过 mcp_profile_status 随时读取——不用猜登录态还活着没有。
 */

export type PlatformLoginStatus = {
  platform: string;
  loginRequired: boolean;
  loggedIn: boolean | 'unknown';
  cookieExpiresAt?: string;
  lastLoginAt?: string;
  lastVerifiedAt?: string;
  method: 'cookie' | 'probe' | 'recorded' | 'none';
  note?: string;
};

export type ProfileSnapshot = {
  updatedAt: string;
  profileDir: string;
  managedChromeRunning: boolean;
  platforms: PlatformLoginStatus[];
};

const STATE_FILE = () => path.join(profileDir(), '..', 'profile-state.json');

type StateShape = {
  lastLoginAt?: Record<string, string>;
  lastVerifiedAt?: Record<string, string>;
  lastSnapshot?: ProfileSnapshot;
};

function readState(): StateShape {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) as StateShape;
  } catch {
    return {};
  }
}

function writeState(patch: Partial<StateShape>): void {
  try {
    const merged = { ...readState(), ...patch };
    const file = STATE_FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(merged, null, 2), { mode: 0o600 });
  } catch { /* 状态文件失败不影响主流程 */ }
}

export function recordLogin(platform: string): void {
  const state = readState();
  state.lastLoginAt = { ...(state.lastLoginAt ?? {}), [platform]: new Date().toISOString() };
  writeState(state);
}

let pollerStarted = false;

/** MCP server 启动时调用：按 env 周期被动自检（只读 cookie，零页面操作）。 */
export function startProfilePoller(): void {
  if (pollerStarted) return;
  pollerStarted = true;
  if (process.env.MCP_JOBS_PROFILE_POLL_MS === '0') return;
  const ms = Number(process.env.MCP_JOBS_PROFILE_POLL_MS);
  const interval = Number.isInteger(ms) && ms >= 60_000 ? ms : 600_000; // 默认 10 分钟
  const tick = async () => {
    try {
      await snapshotProfile();
    } catch { /* 感知失败静默，下轮再来 */ }
  };
  void tick();
  const timer = setInterval(tick, interval);
  timer.unref?.();
}

export async function snapshotProfile(): Promise<ProfileSnapshot> {
  const state = readState();
  const now = () => new Date().toISOString();
  const chromeRunning = await portOpen(managedCdpUrl());

  const platforms: PlatformLoginStatus[] = [];

  // BOSS：wt2 cookie 精确判定 + 过期时间
  const zhipinLive = chromeRunning ? await zhipinLoggedIn() : false;
  const zhipinExpiry = zhipinLive ? await bossLoginCookieExpiry() : 0;
  platforms.push({
    platform: 'zhipin',
    loginRequired: true,
    loggedIn: chromeRunning ? zhipinLive : 'unknown',
    cookieExpiresAt: zhipinExpiry > 0 ? new Date(zhipinExpiry * 1000).toISOString() : undefined,
    lastLoginAt: state.lastLoginAt?.zhipin,
    lastVerifiedAt: zhipinLive ? now() : state.lastVerifiedAt?.zhipin,
    method: chromeRunning ? 'cookie' : 'none',
    note: chromeRunning ? undefined : '托管 Chrome 未运行，状态未知'
  });

  for (const name of ['zhaopin', 'liepin', '51job']) {
    const lastLoginAt = state.lastLoginAt?.[name];
    platforms.push({
      platform: name,
      loginRequired: true,
      loggedIn: 'unknown',
      lastLoginAt,
      method: lastLoginAt ? 'recorded' : 'none',
      note: lastLoginAt ? '仅记录用户确认时间，当前会话未验证。' : '请在官方页面核对当前会话。'
    });
  }

  const snapshot: ProfileSnapshot = {
    updatedAt: now(),
    profileDir: profileDir(),
    managedChromeRunning: chromeRunning,
    platforms
  };
  writeState({ lastSnapshot: snapshot });
  return snapshot;
}
