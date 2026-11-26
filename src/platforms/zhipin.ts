import { harvestJobs } from './harvest';
import { zhipinNativeFilters } from './filters';
import { managedCdpUrl } from '../core/browser';
import { jitterPause, portOpen, rawBrowserSession, rawCaptureJson, rawSend } from '../core/cdp';
import type { ApiSearchResult } from './types';
import type { RawFilters } from './filters';

/**
 * BOSS 直聘：CDP 连本机已登录 Chrome，被动旁听页面自己发出的 joblist.json（薪资明文）。
 * 核心令牌 __zp_stoken__ 由浏览器安全 JS 现场生成/换发——不逆向，让浏览器替我们跑。
 * 节奏红线（社区实证）：页间 12–22s 随机、单次 ≤10 页、遇 code 31/37 立即停。
 */

export const BOSS_LOGIN_COOKIE = 'wt2'; // 社区实证的 BOSS 主登录 Cookie（boss-cli/boss-zhipin-scraper 均依赖）

export const ZHIPIN_CITY_CODES: Record<string, string> = {
  '北京': '101010100', '上海': '101020100', '广州': '101280100', '深圳': '101280600',
  '杭州': '101210100', '成都': '101270100', '武汉': '101200100', '西安': '101110100',
  '南京': '101190400', '郑州': '101180100'
};

/** BOSS 候选调试端口：显式 BOSS_CDP_URL（用户自管 Chrome）优先，其次托管端口。 */
export function bossCdpUrls(): string[] {
  const managed = managedCdpUrl();
  const explicit = process.env.BOSS_CDP_URL;
  return explicit && explicit !== managed ? [explicit, managed] : [managed];
}

export async function zhipinLoggedIn(): Promise<boolean> {
  for (const cdpUrl of bossCdpUrls()) {
    if (!(await portOpen(cdpUrl))) continue;
    if (await rawBossLoggedIn(cdpUrl)) return true;
  }
  return false;
}

/** 浏览器级查登录 Cookie（Storage 域，不附加任何页面 → 无探测面）。 */
export async function rawBossLoggedIn(cdpUrl: string): Promise<boolean> {
  const session = await rawBrowserSession(cdpUrl);
  if (!session) return false;
  try {
    const result = await rawSend<{ cookies?: { name: string; value: string }[] }>(session, 'Storage.getCookies');
    return (result.cookies ?? []).some(cookie => cookie.name === BOSS_LOGIN_COOKIE && cookie.value.trim().length > 0);
  } catch {
    return false;
  }
}

/** BOSS 登录 Cookie 的过期时间（秒级 epoch；0=未知/会话级）。 */
export async function bossLoginCookieExpiry(): Promise<number> {
  for (const cdpUrl of bossCdpUrls()) {
    if (!(await portOpen(cdpUrl))) continue;
    const session = await rawBrowserSession(cdpUrl);
    if (!session) continue;
    try {
      const result = await rawSend<{ cookies?: { name: string; value: string; expires?: number }[] }>(session, 'Storage.getCookies');
      const wt2 = (result.cookies ?? []).find(cookie => cookie.name === BOSS_LOGIN_COOKIE && cookie.value.trim().length > 0);
      if (wt2) return typeof wt2.expires === 'number' && wt2.expires > 0 ? wt2.expires : 0;
    } catch { /* 下一个端口 */ }
  }
  return 0;
}

export async function searchZhipin(keyword: string, city: string | undefined, page: number, signal?: AbortSignal, timeoutMs = 15000, filters?: RawFilters): Promise<ApiSearchResult | null> {
  const cityCode = city ? ZHIPIN_CITY_CODES[city.replace(/市$/, '')] : undefined;
  const query = new URLSearchParams({ query: keyword, page: String(page) });
  if (cityCode) query.set('city', cityCode);
  // 原生筛选码（有公开实证）：experience/salary
  for (const [key, value] of Object.entries(zhipinNativeFilters(filters ?? {}))) query.set(key, value);
  const targetUrl = `https://www.zhipin.com/web/geek/job?${query.toString()}`;

  let loginWall = false;
  let restricted = false;
  let sawPort = false;
  for (const cdpUrl of bossCdpUrls()) {
    if (!(await portOpen(cdpUrl))) continue;
    sawPort = true;
    if (!(await rawBossLoggedIn(cdpUrl))) { loginWall = true; continue; }
    const json = await rawCaptureJson(cdpUrl, 'zhipin-search', targetUrl, /joblist\.json/, Math.max(timeoutMs - 2000, 8000), signal);
    if (signal?.aborted) return null;
    if (!json) continue;
    const envelope = json as Record<string, unknown>;
    const code = Number((envelope as { code?: unknown }).code);
    if (code === 37 || code === 31 || code === 9) { restricted = true; continue; }
    const jobs = harvestJobs(envelope.zpData ?? envelope, 'zhipin', 'https://www.zhipin.com');
    if (jobs.length) return { status: 'ok', jobs };
    if (code === 0) return { status: 'empty', jobs: [] };
    loginWall = true;
  }
  if (restricted) return { status: 'access_restricted', jobs: [] };
  if (!sawPort) {
    return { status: 'login_required', jobs: [], note: '未发现 BOSS Chrome 调试端口。调用 mcp_platform_login(platform=zhipin) 自动拉起并等待登录' };
  }
  if (loginWall) {
    return { status: 'login_required', jobs: [], note: '调用 mcp_platform_login(platform=zhipin) 打开登录窗口，扫码登录后搜索即取全量数据' };
  }
  return null;
}

// 页间人类节奏参考（多页抓取由调用方遵循）：jitterPause(12000, 22000)
void jitterPause;
