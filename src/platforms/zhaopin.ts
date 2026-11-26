import { harvestJobs } from './harvest';
import { managedCdpUrl } from '../core/browser';
import { httpJson, hostOf, portOpen, rawCaptureDocument, safeJsonParse } from '../core/cdp';
import { recordLogin } from '../core/profileState';
import type { ApiSearchResult } from './types';
import type { RawFilters } from './filters';

/**
 * 智联：托管真 Chrome + SSR 文档捕获。
 * 关键发现：登录后的新版搜索页（www.zhaopin.com/jobs）是 SSR——首屏职位列表
 * 直接内嵌在 HTML 的 window.__INITIAL_STATE__.positionList 里，根本不走列表 API
 * （base/data 只是筛选元数据）。所以最优解 = 读主文档响应体 + 提取内嵌状态：
 * 零页面 JS 执行、零 Runtime 附加，反检测面最小，且 20 条全量字段一次到手。
 * 筛选：SSR 页原生筛选参数未实证 → 客户端过滤层保证。
 * 节奏红线：60–90s+ 抖动、日请求 ≤150。
 */

const INITIAL_STATE_MARKER = '__INITIAL_STATE__=';

/** 从 SSR HTML 中提取 window.__INITIAL_STATE__ JSON。 */
export function extractZhaopinState(html: string): Record<string, unknown> | null {
  const start = html.indexOf(INITIAL_STATE_MARKER);
  if (start < 0) return null;
  const from = start + INITIAL_STATE_MARKER.length;
  const end = html.indexOf('</script>', from);
  if (end < 0) return null;
  const raw = html.slice(from, end).replace(/;\s*$/, '');
  const parsed = safeJsonParse(raw);
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
}

export async function searchZhaopin(keyword: string, city: string | undefined, page: number, signal?: AbortSignal, timeoutMs = 15000, filters?: RawFilters): Promise<ApiSearchResult | null> {
  void filters; // SSR 原生筛选参数未实证：客户端过滤层保证
  const cdpUrl = managedCdpUrl();
  if (!(await portOpen(cdpUrl))) {
    return { status: 'login_required', jobs: [], note: '未发现智联专用 Chrome。调用 mcp_platform_login(platform=zhaopin) 自动拉起并等待登录' };
  }
  if (page > 1) {
    // SSR 只出第一屏；后续页由 SPA 增量加载（滚动），走 API 层捕获效率低——落回 S2 处理
    return null;
  }
  const query = new URLSearchParams({ kw: keyword });
  if (city) query.set('jl', city.replace(/市$/, ''));
  const targetUrl = `https://www.zhaopin.com/jobs?${query.toString()}`;
  const html = await rawCaptureDocument(cdpUrl, 'zhaopin-search', targetUrl, Math.max(timeoutMs - 2000, 8000), signal);
  if (signal?.aborted) return null;
  if (!html) return null;
  const state = extractZhaopinState(html);
  if (!state) {
    // 没有内嵌状态：多半是 EdgeOne 挑战页或登录墙
    if (/Security Verification|安全验证|访问验证/i.test(html)) return { status: 'access_restricted', jobs: [] };
    if (/passport\.zhaopin\.com\/login/i.test(html)) return { status: 'login_required', jobs: [] };
    return null;
  }
  const jobs = harvestJobs(state, 'zhaopin', 'https://www.zhaopin.com');
  if (jobs.length) {
    recordLogin('zhaopin'); // 搜索成功 = 登录态有效（profile 感知自动转绿）
    return { status: 'ok', jobs };
  }
  return { status: 'empty', jobs: [] };
}

/** 读取当前 zhaopin 标签页 URL（用于分类登录墙/验证页）。 */
async function zhaopinTabUrl(): Promise<string> {
  const tabs = await httpJson<any[]>(`${managedCdpUrl()}/json/list`);
  const tab = (tabs ?? []).find((t: any) => t.type === 'page' && hostOf(t.url ?? '').endsWith('zhaopin.com'));
  return tab?.url ?? '';
}
