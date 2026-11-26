import { managedCdpUrl } from '../core/browser';
import { portOpen, rawCaptureJson } from '../core/cdp';
import { harvestJobs } from './harvest';
import { liepinNativeFilters } from './filters';
import type { ApiSearchResult, ApiStatus } from './types';
import type { RawFilters } from './filters';

/**
 * 猎聘：托管 Chrome SPA 被动旁听 pc-search-job（与 BOSS/智联同架构）。
 * 旧实现用 Playwright 每次开全新隐身上下文——登录态在统一 profile 里，搜索接不上会话。
 * 新实现复用托管 Chrome 的猎聘标签（登录 cookie 生效），原生筛选码直接拼 URL，
 * 让页面自己发搜索请求（自带全套 X-Fscp-* 头/token/指纹），只听响应。
 * 手写 fetch 会被 -1400 环境校验拒绝（新版校验含动态 token）。
 */

export async function searchLiepin(keyword: string, page: number, signal?: AbortSignal, timeoutMs = 15000, filters?: RawFilters): Promise<ApiSearchResult | null> {
  const cdpUrl = managedCdpUrl();
  if (!(await portOpen(cdpUrl))) {
    return { status: 'login_required', jobs: [], note: '未发现托管 Chrome。调用 mcp_platform_login(platform=liepin) 拉起并登录' };
  }
  // 原生筛选码（SPA 同源）：salaryCode/workYearCode 直接拼 URL，SPA 按筛选发起搜索
  const native = liepinNativeFilters(filters ?? {});
  const query = new URLSearchParams({ key: keyword, currentPage: String(page) });
  for (const [key, value] of Object.entries(native)) query.set(key, value);
  const target = `https://www.liepin.com/zhaopin/?${query.toString()}`;
  const json = await rawCaptureJson(
    cdpUrl, 'liepin-search', target,
    // 精确匹配职位列表接口，排除 pc-search-job-cond-init（筛选条件初始化）
    /api-c\.liepin\.com\/api\/com\.liepin\.searchfront4c\.pc-search-job(?:\?|$)/,
    Math.max(timeoutMs - 2000, 8000), signal,
    // 过滤 flag=0 的错误响应（-1400 环境校验等），等 SPA 重试出的真数据
    json => Number((json as { flag?: unknown }).flag ?? 1) === 1
  );
  if (signal?.aborted) return null;
  if (!json) return null;
  const envelope = json as Record<string, unknown>;
  if (envelope.flag === 0) return { status: classifyLiepinError(String(envelope.errorCode ?? envelope.code ?? '')), jobs: [] };
  const jobs = harvestJobs(envelope.data ?? envelope, 'liepin', 'https://www.liepin.com');
  return { status: jobs.length ? 'ok' : 'empty', jobs };
}

export function classifyLiepinError(code: string): ApiStatus {
  if (code === '60001') return 'rate_limited';
  if (code === '20000' || code === '40001') return 'login_required';
  if (code === '-1400') return 'access_restricted';
  return 'unavailable';
}
