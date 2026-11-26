import { sharedBrowser } from '../core/browser';
import { jitterPause, raceAbort } from '../core/cdp';
import { harvestJobs } from './harvest';
import { liepinNativeFilters } from './filters';
import type { ApiJob, ApiSearchResult, ApiStatus } from './types';
import type { RawFilters } from './filters';

/**
 * 猎聘：官网 SPA 被动旁听——让页面自己发搜索请求（自带全套 X-Fscp-* 头/token/指纹），只听响应。
 * 手写 fetch 会被 -1400 环境校验拒绝（新版校验含动态 token）。
 */

export async function searchLiepin(keyword: string, page: number, signal?: AbortSignal, timeoutMs = 15000, filters?: RawFilters): Promise<ApiSearchResult | null> {
  // 原生筛选码（SPA 同源）：salaryCode/workYearCode 直接拼 URL，SPA 按筛选发起搜索
  const native = liepinNativeFilters(filters ?? {});
  const query = new URLSearchParams({ key: keyword, currentPage: String(page) });
  for (const [key, value] of Object.entries(native)) query.set(key, value);
  const target = `https://www.liepin.com/zhaopin/?${query.toString()}`;
  const browser = await sharedBrowser();
  const context = await browser.newContext({ locale: 'zh-CN' }).catch(() => null);
  if (!context) return null;
  try {
    const pageHandle = await context.newPage();
    const responsePromise = pageHandle.waitForResponse(
      // 精确匹配职位列表接口，排除 pc-search-job-cond-init（筛选条件初始化）
      response => /api-c\.liepin\.com\/api\/com\.liepin\.searchfront4c\.pc-search-job(?:\?|$)/.test(response.url()),
      { timeout: Math.max(timeoutMs - 2000, 5000) }
    ).catch(() => null);
    await jitterPause(300, 1000); // 导航噪声
    await raceAbort(pageHandle.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(timeoutMs - 1000, 12000)
    }), signal);
    const response = await raceAbort(responsePromise, signal);
    if (!response) {
      const finalUrl = pageHandle.url();
      if (/captcha|verify|security/i.test(finalUrl)) return { status: 'access_restricted', jobs: [] };
      if (/passport|login/i.test(finalUrl)) return { status: 'login_required', jobs: [], note: '请在官方页面登录猎聘后重试' };
      return null;
    }
    const json: unknown = await response.json().catch(() => null);
    if (!json || typeof json !== 'object') return null;
    const envelope = json as Record<string, unknown>;
    if (envelope.flag === 0) return { status: classifyLiepinError(String(envelope.errorCode ?? envelope.code ?? '')), jobs: [] };
    const jobs = harvestJobs(envelope.data ?? envelope, 'liepin', 'https://www.liepin.com');
    return { status: jobs.length ? 'ok' : 'empty', jobs };
  } finally {
    await context.close().catch(() => {});
  }
}

export function classifyLiepinError(code: string): ApiStatus {
  if (code === '60001') return 'rate_limited';
  if (code === '20000' || code === '40001') return 'login_required';
  if (code === '-1400') return 'access_restricted';
  return 'unavailable';
}
