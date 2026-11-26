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
  cookieBaselines?: Record<string, string[]>;
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
    fs.writeFileSync(STATE_FILE(), JSON.stringify(merged, null, 2));
  } catch { /* 状态文件失败不影响主流程 */ }
}

export function recordLogin(platform: string): void {
  const state = readState();
  state.lastLoginAt = { ...(state.lastLoginAt ?? {}), [platform]: new Date().toISOString() };
  state.lastVerifiedAt = { ...(state.lastVerifiedAt ?? {}), [platform]: new Date().toISOString() };
  writeState(state);
}

/** cookie 基线持久化：登录检测跨进程/跨时间可靠（不在监视期登录也能被发现）。 */
export function getCookieBaseline(domain: string): string[] | undefined {
  const state = readState();
  return state.cookieBaselines?.[domain];
}

export function setCookieBaseline(domain: string, keys: string[]): void {
  const state = readState();
  state.cookieBaselines = { ...(state.cookieBaselines ?? {}), [domain]: keys };
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

  // 智联：无稳定公开的登录 cookie 名，用「最近一次验证记录 + 托管探针历史」表达
  const zhaopinLastLogin = state.lastLoginAt?.zhaopin;
  const zhaopinVerified = state.lastVerifiedAt?.zhaopin;
  platforms.push({
    platform: 'zhaopin',
    loginRequired: true,
    loggedIn: zhaopinVerified ? true : 'unknown',
    lastLoginAt: zhaopinLastLogin,
    lastVerifiedAt: zhaopinVerified,
    method: zhaopinVerified ? 'recorded' : 'none',
    note: zhaopinVerified ? undefined : '尚未验证过登录态；调用 mcp_platform_login(platform=zhaopin) 完成登录'
  });

  for (const name of ['liepin', '51job']) {
    platforms.push({
      platform: name,
      loginRequired: true,
      loggedIn: state.lastLoginAt?.[name] ? true : 'unknown',
      lastLoginAt: state.lastLoginAt?.[name],
      lastVerifiedAt: state.lastVerifiedAt?.[name],
      method: state.lastLoginAt?.[name] ? 'recorded' : 'none',
      note: state.lastLoginAt?.[name] ? '登录态已由用户确认记录' : '公开搜索可用性由搜索结果报告。投递和消息权限需在官方页面确认，台账按本地账号代号隔离。'
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
