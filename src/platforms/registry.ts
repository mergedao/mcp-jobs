import { searchZhipin } from './zhipin';
import { searchLiepin } from './liepin';
import { search51job } from './job51';
import { searchZhaopin } from './zhaopin';
import { rawCloseAll, resetBoundPages } from '../core/cdp';
import type { JobPlatform } from '../config/urlConfig';
import type { ApiSearchResult } from './types';
import type { RawFilters } from './filters';

/**
 * 平台策略注册表：每平台一个最优解实现（S1），失败由 index.ts 落回公开页/DOM（S2）。
 * 新增平台 = 新增一个文件 + 在这里注册一行。
 */

type SearchFn = (keyword: string, city: string | undefined, page: number, signal?: AbortSignal, timeoutMs?: number, filters?: RawFilters) => Promise<ApiSearchResult | null>;

export const PLATFORM_SEARCH: Record<JobPlatform, SearchFn> = {
  zhipin: searchZhipin,
  liepin: (keyword, _city, page, signal, timeoutMs, filters) => searchLiepin(keyword, page, signal, timeoutMs, filters),
  '51job': (keyword, city, page, signal, timeoutMs, filters) => search51job(keyword, city, page, signal, timeoutMs, filters),
  zhaopin: searchZhaopin
};

export function platformApiSearch(
  platform: JobPlatform,
  params: { keyword?: string; city?: string; page?: number; filters?: RawFilters },
  signal?: AbortSignal,
  timeoutMs = 15000
): Promise<ApiSearchResult | null> {
  if (signal?.aborted) return Promise.resolve(null);
  // 总开关：MCP_JOBS_DISABLE_PLATFORM_APIS=1 时只用公开页/DOM 层（测试、纯公开模式）
  if (process.env.MCP_JOBS_DISABLE_PLATFORM_APIS === '1') return Promise.resolve(null);
  const keyword = (params.keyword ?? '').trim();
  if (!keyword) return Promise.resolve(null);
  const page = params.page && params.page >= 1 ? Math.min(params.page, 10) : 1;
  const fn = PLATFORM_SEARCH[platform];
  if (!fn) return Promise.resolve(null);
  return fn(keyword, params.city, page, signal, timeoutMs, params.filters).catch(() => null);
}

export async function closePlatformApis(): Promise<void> {
  rawCloseAll();
  resetBoundPages();
  const { closeSharedBrowser } = await import('../core/browser');
  await closeSharedBrowser();
}
