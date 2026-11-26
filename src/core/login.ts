import { existsSync } from 'fs';
import { managedCdpUrl, chromeBinary, ensureManagedChrome, activateTab } from './browser';
import { httpJson, jitterPause, pause, portOpen, rawBrowserSession, rawSend } from './cdp';
import { searchZhaopin } from '../platforms/zhaopin';
import { bossCdpUrls, BOSS_LOGIN_COOKIE, rawBossLoggedIn } from '../platforms/zhipin';
import { recordLogin } from './profileState';

/**
 * 人工登录流（四平台）：需要登录时才把登录标签带到前台（唯一允许抢焦点的时刻），
 * 纯 cookie 静默轮询检测，登录完成后调用方直接继续搜索。
 * 单标签原则：登录复用各平台已有的搜索标签（导航过去），登录完成后由搜索导航回来——
 * 用户全程只面对一个 Chrome 窗口、每个平台至多一个标签。
 */

export type LoginPlatform = 'zhipin' | 'zhaopin' | 'liepin' | '51job';

export type LoginOutcome = {
  platform: LoginPlatform;
  status: 'already_logged_in' | 'logged_in' | 'waiting' | 'manual_required';
  detail: string;
};

/** 各平台登录入口（导航复用搜索标签，单标签原则）。 */
const LOGIN_PAGES: Record<LoginPlatform, string> = {
  zhipin: 'https://www.zhipin.com/web/user/?ka=header-login',
  zhaopin: 'https://passport.zhaopin.com/login',
  liepin: 'https://account.liepin.com/account/v4/#/login',
  '51job': 'https://www.51job.com/'
};

/** 统计类 cookie 黑名单：diff 时排除，避免埋点误报。 */
const NOISE_COOKIE = /^(Hm_|sensors|sajssdk|_uab|LastCity|HMACCOUNT|x-zp-(client|device)|_ga|_gid|Hm_lpvt|Hm_lvt)/i;

export async function platformLogin(platform: LoginPlatform, waitMs: number, signal?: AbortSignal): Promise<LoginOutcome> {
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
  switch (platform) {
    case 'zhipin': return loginZhipin(cdpUrl, waitMs, signal);
    case 'zhaopin': return loginZhaopin(cdpUrl, waitMs, signal);
    case 'liepin': return loginWithCookieDetection(cdpUrl, {
      platform, loginUrl: LOGIN_PAGES.liepin, roleKey: 'liepin-search', domainFilter: 'liepin',
      // 登录凭证：liepin_login_valid（实测仅在登录后出现；__gc_id 未登录访问也会生成，不可用）
      loginCookie: 'liepin_login_valid',
      successDetail: '猎聘登录成功（liepin_login_valid 会话已落盘），现在搜索即走 API 层取全量数据'
    }, waitMs, signal);
    case '51job': return loginWithCookieDetection(cdpUrl, {
      platform, loginUrl: LOGIN_PAGES['51job'], roleKey: '51job-search', domainFilter: '51job',
      successDetail: '51job 登录成功（会话 cookie 已落盘），现在搜索即走 API 层取全量数据'
    }, waitMs, signal);
  }
}

/** 人工确认登录（用于没有可靠登录 cookie 特征的平台，如猎聘）。 */
export async function confirmLogin(platform: LoginPlatform): Promise<LoginOutcome> {
  recordLogin(platform);
  return { platform, status: 'logged_in', detail: `${platform} 登录态已由用户确认记录` };
}

/** BOSS：wt2 cookie 精确判定。 */
async function loginZhipin(cdpUrl: string, waitMs: number, signal?: AbortSignal): Promise<LoginOutcome> {
  const targetCdp = (await portOpen(process.env.BOSS_CDP_URL || cdpUrl)) ? (process.env.BOSS_CDP_URL || cdpUrl) : cdpUrl;
  if (await bossLoggedIn()) {
    recordLogin('zhipin');
    return { platform: 'zhipin', status: 'already_logged_in', detail: '浏览器已登录 BOSS 直聘，直接搜索即可' };
  }
  const opened = await openLoginPageTab(targetCdp, LOGIN_PAGES.zhipin, 'zhipin-search', 'https://www.zhipin.com/web/geek/job');
  if (!opened) {
    return { platform: 'zhipin', status: 'manual_required', detail: 'Chrome 已启动但 CDP 未就绪，请稍后重试' };
  }
  const deadline = Date.now() + Math.max(waitMs, 10_000);
  while (Date.now() < deadline && !signal?.aborted) {
    if (await bossLoggedIn()) {
      recordLogin('zhipin');
      return { platform: 'zhipin', status: 'logged_in', detail: 'BOSS 直聘登录成功，现在搜索即走 API 层取全量数据' };
    }
    await pause(2500 + Math.floor(Math.random() * 1500)); // 轮询节奏随机噪声
  }
  return {
    platform: 'zhipin',
    status: 'waiting',
    detail: '已定位到 BOSS 登录页。请点「登录」扫码；登录态保存后直接重试 mcp_search_job 即可'
  };
}

/** 智联：登录页导航 + cookie diff 检测 + 登录后功能探针确认。 */
async function loginZhaopin(cdpUrl: string, waitMs: number, signal?: AbortSignal): Promise<LoginOutcome> {
  // 已登录快速通道：真实探针能拿到数据 = 登录态有效
  if (await portOpen(cdpUrl)) {
    const probe = await searchZhaopin('工程师', undefined, 1, undefined, 20_000);
    if (probe?.jobs.length) {
      recordLogin('zhaopin');
      return { platform: 'zhaopin', status: 'already_logged_in', detail: '智联已登录且搜索接口可用，直接搜索即可' };
    }
  }
  // 登录页开在智联搜索标签上（单标签原则），登录后搜索导航回 jobs 页
  const targetId = await navigateRolePage(cdpUrl, 'zhaopin-search', LOGIN_PAGES.zhaopin);
  if (!targetId) {
    return { platform: 'zhaopin', status: 'manual_required', detail: '智联标签未就绪，请稍后重试' };
  }
  await activateTab(cdpUrl, targetId);
  await pause(3000);
  const deadline = Date.now() + Math.max(waitMs, 10_000);
  while (Date.now() < deadline && !signal?.aborted) {
    const fresh = (await domainCookieDiff('zhaopin')).filter(name => !NOISE_COOKIE.test(name));
    if (fresh.length > 0) {
      const probe = await searchZhaopin('工程师', undefined, 1, undefined, 20_000);
      if (probe?.jobs.length) {
        recordLogin('zhaopin');
        return { platform: 'zhaopin', status: 'logged_in', detail: '智联登录成功且搜索接口可用（登录态保留在统一 profile），现在搜索即走 API 层取全量数据' };
      }
    }
    await pause(4500 + Math.floor(Math.random() * 2000)); // 轮询节奏随机噪声
  }
  return {
    platform: 'zhaopin',
    status: 'waiting',
    detail: '已定位到智联登录页。请完成登录（手机号/扫码均可）；登录态保留，完成后直接重试 mcp_search_job 即可'
  };
}

/** 通用 cookie-diff 登录流（51job/猎聘等无公开登录 cookie 名的平台）。 */
async function loginWithCookieDetection(
  cdpUrl: string,
  config: {
    platform: LoginPlatform;
    loginUrl: string;
    roleKey: string;
    domainFilter: string;
    loginCookie?: string;
    successDetail: string;
  },
  waitMs: number,
  signal?: AbortSignal
): Promise<LoginOutcome> {
  // 已登录快速通道：指定登录 cookie 存在即视为已登录
  if (config.loginCookie && (await domainHasCookie(config.domainFilter, config.loginCookie))) {
    recordLogin(config.platform);
    return { platform: config.platform, status: 'already_logged_in', detail: '已登录（检测到会话 cookie），直接搜索即可' };
  }
  const targetId = await navigateRolePage(cdpUrl, config.roleKey, config.loginUrl);
  if (!targetId) {
    return { platform: config.platform, status: 'manual_required', detail: '登录标签未就绪，请稍后重试' };
  }
  await activateTab(cdpUrl, targetId);
  await pause(3000);
  const deadline = Date.now() + Math.max(waitMs, 10_000);
  while (Date.now() < deadline && !signal?.aborted) {
    const fresh = (await domainCookieDiff(config.domainFilter)).filter(name => !NOISE_COOKIE.test(name));
    if (fresh.length > 0) {
      // 会话有变化但不代表登录（如猎聘 __gc_id 未登录也会生成）：
      // 报告 waiting + 请用户在对话里确认，由 mcp_login_confirmed 记录
      return {
        platform: config.platform,
        status: 'waiting',
        detail: `检测到 ${config.platform} 会话有变化。如果你已完成登录，请告诉 agent「${config.platform} 登录好了」由 agent 调 mcp_login_confirmed 记录；如果还没登录请继续扫码`
      };
    }
    await pause(4500 + Math.floor(Math.random() * 2000));
  }
  return {
    platform: config.platform,
    status: 'waiting',
    detail: '已定位到登录页。请完成登录；登录态保留在统一 profile，完成后告诉 agent 或直接重试搜索即可'
  };
}

async function bossLoggedIn(): Promise<boolean> {
  for (const cdpUrl of bossCdpUrls()) {
    if (await portOpen(cdpUrl) && await rawBossLoggedIn(cdpUrl)) return true;
  }
  return false;
}

/** 确保登录页标签开着并返回 targetId（优先复用 role 标签导航过去，单标签原则）。 */
async function openLoginPageTab(cdpUrl: string, loginUrl: string, roleKey: string, roleHomeUrl: string): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!(await portOpen(cdpUrl))) {
      await pause(1000);
      continue;
    }
    const tabs = await httpJson<any[]>(`${cdpUrl}/json/list`);
    const hasLoginTab = (tabs ?? []).some((t: any) => t.type === 'page' && t.url?.startsWith(loginUrl.split('?')[0]));
    if (hasLoginTab) return true;
    await jitterPause(300, 800);
    const tab = await httpJson(`${cdpUrl}/json/new?${encodeURIComponent(loginUrl)}`, { method: 'PUT' });
    if (tab?.id) {
      await activateTab(cdpUrl, tab.id); // 登录 = 用户要操作 = 定位到登录页
      return true;
    }
    await pause(1000);
  }
  void roleKey;
  void roleHomeUrl;
  return false;
}

/** 把 role 绑定的标签导航到目标 URL（单标签原则：登录/搜索共用一个标签）。 */
async function navigateRolePage(cdpUrl: string, roleKey: string, targetUrl: string): Promise<string | null> {
  const { rawEnsurePage } = await import('./cdp');
  const entry = await rawEnsurePage(cdpUrl, roleKey, targetUrl);
  if (!entry) return null;
  await rawSend(entry.session, 'Page.navigate', { url: targetUrl }).catch(() => {});
  return entry.targetId;
}

/** 浏览器级读取指定域的全部 cookie 键（Storage 域，零页面附加）。 */
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

/** 持久化基线的 cookie-diff：基线存状态文件，跨进程/跨时间可靠。 */
async function domainCookieDiff(domainFilter: string): Promise<string[]> {
  const { getCookieBaseline, setCookieBaseline } = await import('./profileState');
  const current = await domainCookieKeys(domainFilter);
  const stored = getCookieBaseline(domainFilter);
  if (!stored) {
    setCookieBaseline(domainFilter, [...current]);
    return [];
  }
  const fresh = [...current].filter(key => !stored.includes(key));
  setCookieBaseline(domainFilter, [...current]);
  return fresh;
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

/** 供 profileState 用：BOSS 登录 cookie 名。 */
export { BOSS_LOGIN_COOKIE };
