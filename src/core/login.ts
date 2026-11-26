import { existsSync } from 'fs';
import { activateTab, ensureManagedChrome, managedCdpUrl, chromeBinary, openPage } from './browser';
import { jitterPause, pause, portOpen, rawBrowserSession, rawSend } from './cdp';
import { recordLogin } from './profileState';
import { searchZhaopin } from '../platforms/zhaopin';
import { bossCdpUrls, rawBossLoggedIn } from '../platforms/zhipin';

/**
 * 四平台登录流：打开登录页并置前（唯一允许抢焦点的时刻）→ cookie 静默轮询自动检测 →
 * 检测到可靠登录凭证自动记录并返回；无可靠凭证的平台（51job）用会话 cookie diff，
 * 超时未确认则交由用户口头确认（mcp_login_confirmed 记录）。
 * 凭证均为实测校准：BOSS wt2、猎聘 liepin_login_valid（__gc_id 未登录也会生成，不可用）。
 * 单标签原则：登录复用各平台搜索标签导航。
 */

export type LoginPlatform = 'zhipin' | 'zhaopin' | 'liepin' | '51job';

export type LoginOutcome = {
  platform: LoginPlatform;
  status: 'already_logged_in' | 'logged_in' | 'waiting' | 'manual_required';
  detail: string;
};

const LOGIN_PAGES: Record<LoginPlatform, string> = {
  zhipin: 'https://www.zhipin.com/web/user/?ka=header-login',
  zhaopin: 'https://passport.zhaopin.com/login',
  liepin: 'https://account.liepin.com/account/v4/#/login',
  '51job': 'https://www.51job.com/'
};

/** 实测可靠的登录凭证 cookie（__gc_id 未登录也会生成，不可作为猎聘凭证）。 */
const LOGIN_COOKIE_MARKERS: Partial<Record<LoginPlatform, { domain: string; name: string }>> = {
  zhipin: { domain: 'zhipin', name: 'wt2' },
  liepin: { domain: 'liepin', name: 'liepin_login_valid' }
};

const NOISE_COOKIE = /^(Hm_|sensors|sajssdk|_uab|LastCity|HMACCOUNT|x-zp-(client|device)|_ga|_gid|Hm_lpvt|Hm_lvt)/i;

export async function startPlatformLogin(platform: LoginPlatform, signal?: AbortSignal, waitMs = 240_000): Promise<LoginOutcome> {
  if (!(await ensureManagedChrome())) {
    return {
      platform,
      status: 'manual_required',
      detail: existsSync(chromeBinary())
        ? '托管 Chrome 启动失败，请稍后重试'
        : `未找到 ${chromeBinary()}。请手动启动带调试端口的 Chrome 并登录（或用 MCP_JOBS_CHROME_PATH 指定路径）`
    };
  }
  const cdpUrl = managedCdpUrl();
  const opened = await openLoginPageTab(cdpUrl, LOGIN_PAGES[platform]);
  if (!opened) {
    return { platform, status: 'manual_required', detail: 'Chrome 已启动但登录页未就绪，请稍后重试' };
  }
  await activateTab(cdpUrl, await currentTabId(cdpUrl, platform) ?? '');

  const deadline = Date.now() + Math.max(waitMs, 10_000);
  let baseline51: Set<string> | null = null;
  while (Date.now() < deadline && !signal?.aborted) {
    if (platform === '51job') {
      // 51job 无固定凭证名：首轮固化基线，后续新增非噪声会话 cookie 即视为登录
      const keys = await domainCookieKeys('51job');
      if (!baseline51) baseline51 = keys;
      else if ([...keys].some(k => !baseline51!.has(k) && !NOISE_COOKIE.test(k.split('|')[1]))) {
        recordLogin(platform);
        return { platform, status: 'logged_in', detail: '51job 登录成功（检测到新增会话 cookie），现在搜索即走 API 层取全量数据' };
      }
    } else if (await detectLogin(platform, null)) {
      recordLogin(platform);
      return {
        platform,
        status: 'logged_in',
        detail: `${platform} 登录成功（自动检测到登录凭证），现在搜索即走 API 层取全量数据`
      };
    }
    await jitterPause(3500, 5500);
  }
  return {
    platform,
    status: 'waiting',
    detail: '已定位到登录页。请完成登录；登录态保留在统一 profile，完成后直接重试 mcp_search_job 或告知 agent 调 mcp_login_confirmed 记录'
  };
}

/** 登录检测：可靠 cookie 凭证优先；智联用功能探针（能搜到数据=已登录）；51job 由调用方做 cookie diff。 */
async function detectLogin(platform: LoginPlatform, baseline51: Set<string> | null): Promise<boolean> {
  switch (platform) {
    case 'zhipin': {
      for (const cdpUrl of bossCdpUrls()) {
        if (await portOpen(cdpUrl)) return await rawBossLoggedIn(cdpUrl);
      }
      return false;
    }
    case 'liepin': {
      const marker = LOGIN_COOKIE_MARKERS.liepin!;
      return await domainHasCookie(marker.domain, marker.name);
    }
    case 'zhaopin': {
      const probe = await searchZhaopin('工程师', undefined, 1, undefined, 20_000).catch(() => null);
      return Boolean(probe?.jobs.length);
    }
    case '51job': {
      // diff 在调用方 while 循环内完成（首轮固化基线，后续新增会话 cookie = 登录）
      return baseline51 !== null;
    }
  }
}

async function domainHasCookie(domainFilter: string, cookieName: string): Promise<boolean> {
  const session = await rawBrowserSession(managedCdpUrl());
  if (!session) return false;
  try {
    const result = await rawSend<{ cookies?: { name: string; value: string; domain: string }[] }>(session, 'Storage.getCookies');
    return (result.cookies ?? []).some(c => c.domain.includes(domainFilter) && c.name === cookieName && c.value.trim().length > 0);
  } catch {
    return false;
  }
}

async function domainCookieKeys(domainFilter: string): Promise<Set<string>> {
  const session = await rawBrowserSession(managedCdpUrl());
  if (!session) return new Set();
  try {
    const result = await rawSend<{ cookies?: { name: string; domain: string }[] }>(session, 'Storage.getCookies');
    return new Set((result.cookies ?? []).filter(c => c.domain.includes(domainFilter)).map(c => `${c.domain}|${c.name}`));
  } catch {
    return new Set();
  }
}

async function currentTabId(cdpUrl: string, platform: LoginPlatform): Promise<string | null> {
  const { httpJson } = await import('./cdp');
  const tabs = await httpJson<any[]>(`${cdpUrl}/json/list`);
  const tab = (tabs ?? []).find((t: any) => t.type === 'page' && (t.url ?? '').includes(platformDomain(platform)));
  return tab?.id ?? null;
}

/** 打开（或复用）登录页标签并置前；已开着则直接放行。 */
async function openLoginPageTab(cdpUrl: string, loginUrl: string): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!(await portOpen(cdpUrl))) {
      await pause(1000);
      continue;
    }
    const opened = await openPage(cdpUrl, loginUrl, { activate: true, reuseHostOf: loginUrl });
    if (opened) return true;
    await pause(1000);
  }
  return false;
}

function platformDomain(platform: LoginPlatform): string {
  switch (platform) {
    case 'zhipin': return 'zhipin.com';
    case 'zhaopin': return 'zhaopin.com';
    case 'liepin': return 'liepin.com';
    case '51job': return '51job.com';
  }
}

/** 人工确认登录（兜底：静默检测超时/未运行时由用户口头确认）。 */
export async function confirmLogin(platform: LoginPlatform) {
  recordLogin(platform);
  return { platform, status: 'user_reported', detail: '已保存用户确认时间。当前会话仍需单独核对。' };
}
