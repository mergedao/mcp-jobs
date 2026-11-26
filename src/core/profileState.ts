import * as fs from 'fs';
import * as path from 'path';
import { profileDir, managedCdpUrl } from './browser';
import { portOpen, rawBrowserSession, rawSend } from './cdp';
import { BOSS_LOGIN_COOKIE, bossCdpUrls } from '../platforms/zhipin';

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
  method: 'cookie' | 'recorded' | 'none';
  sessionEvidence?: 'credential_present' | 'credential_missing' | 'unavailable';
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
  lastCredentialSeenAt?: Record<string, string>;
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

type BrowserCookie = { domain: string; name: string; value: string; expires?: number };
async function readBrowserCookies(url: string): Promise<BrowserCookie[] | undefined> {
  const session = await rawBrowserSession(url);
  if (!session) return undefined;
  try {
    const result = await rawSend<{ cookies?: BrowserCookie[] }>(session, 'Storage.getCookies');
    return Array.isArray(result.cookies) ? result.cookies : undefined;
  } catch {
    return undefined;
  }
}

function sessionCookie(cookies: BrowserCookie[] | undefined, domain: string, name: string, nowMs: number) {
  return cookies?.find(cookie => cookie.name === name && typeof cookie.value === 'string' &&
    Boolean(cookie.value.trim()) && typeof cookie.domain === 'string' &&
    (cookie.domain === domain || cookie.domain.endsWith('.' + domain)) &&
    (cookie.expires === undefined || cookie.expires <= 0 || cookie.expires * 1000 > nowMs));
}

function loopback(url: string) {
  try {
    const endpoint = new URL(url);
    return ['http:', 'https:'].includes(endpoint.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  } catch {
    return false;
  }
}

export async function snapshotProfile(): Promise<ProfileSnapshot> {
  const managed = managedCdpUrl();
  const alternate = bossCdpUrls().find(url => url !== managed && loopback(url));
  const chromeRunning = await portOpen(managed);
  const [managedCookies, alternateCookies] = await Promise.all([
    chromeRunning ? readBrowserCookies(managed) : undefined,
    alternate && await portOpen(alternate) ? readBrowserCookies(alternate) : undefined
  ]);
  const now = new Date();
  const updatedAt = now.toISOString();
  const nowMs = now.getTime();
  const state = readState();
  const lastCredentialSeenAt = { ...state.lastCredentialSeenAt };
  const bossCookies = alternateCookies ?? managedCookies;
  const observed = [
    { platform: 'zhipin', cookies: bossCookies, cookie: sessionCookie(bossCookies, 'zhipin.com', BOSS_LOGIN_COOKIE, nowMs) },
    { platform: 'liepin', cookies: managedCookies, cookie: sessionCookie(managedCookies, 'liepin.com', 'liepin_login_valid', nowMs) }
  ];
  const platforms: PlatformLoginStatus[] = observed.map(({ platform, cookies, cookie }) => {
    if (cookie) lastCredentialSeenAt[platform] = updatedAt;
    return {
      platform,
      loginRequired: true,
      loggedIn: 'unknown',
      lastLoginAt: state.lastLoginAt?.[platform],
      lastVerifiedAt: lastCredentialSeenAt[platform],
      cookieExpiresAt: cookie?.expires && cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : undefined,
      method: cookies ? 'cookie' : state.lastLoginAt?.[platform] ? 'recorded' : 'none',
      sessionEvidence: cookie ? 'credential_present' : cookies ? 'credential_missing' : 'unavailable',
      note: cookie ? '已观察到本地会话凭证，平台登录状态尚未确认。' : '当前会话请在官方页面核对。'
    };
  });

  for (const platform of ['zhaopin', '51job']) {
    const lastLoginAt = state.lastLoginAt?.[platform];
    platforms.push({
      platform,
      loginRequired: true,
      loggedIn: 'unknown',
      lastLoginAt,
      method: lastLoginAt ? 'recorded' : 'none',
      note: lastLoginAt ? '仅记录用户确认时间，当前会话未验证。' : '请在官方页面核对当前会话。'
    });
  }

  const snapshot = { updatedAt, profileDir: profileDir(), managedChromeRunning: chromeRunning, platforms };
  writeState({ lastSnapshot: snapshot, lastCredentialSeenAt });
  return snapshot;
}
