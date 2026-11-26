import * as nodeCrypto from 'crypto';
import { inPageFetch } from '../core/browser';
import { harvestJobs } from './harvest';
import type { ApiSearchResult } from './types';
import type { RawFilters } from './filters';

/**
 * 51job：静态 key HMAC-SHA256(path+query) 签名直连搜索 API（免登录，2023→2025 多次公开复核）。
 * 老版阿里 WAF（arg1 挑战）本地求解；新版 VM WAF 交真 Chrome 现场过挑战后页面内签名 fetch。
 * 筛选：salary/workYear/education 无公开实证码 → 一律由客户端过滤层保证。
 */

const JOB51_SIGN_KEY = 'abfc8f9dcf8c3f3d8aa294ac5f2cf2cc7767e5592590f39c3f503271dd68562b';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function solveAcwScV3(arg1: string): string {
  // 阿里云 WAF acw_sc__v2/v3 通用静态解：arg1 固定位置重排后与密钥 hexXor（2023 起社区通用解法）
  const ACW_KEY = '3000176000856006061501533003690027800375';
  const ACW_POSITIONS = [15, 35, 29, 24, 33, 16, 1, 38, 10, 9, 19, 31, 40, 27, 22, 23, 25, 13, 6, 11, 39, 18, 20, 21, 12, 8, 7, 2, 17, 41, 37, 26, 4, 3, 42, 32, 28, 5, 30, 36, 34, 14];
  if (arg1.length < ACW_POSITIONS.length) return '';
  let shuffled = '';
  for (const position of ACW_POSITIONS) shuffled += arg1[position - 1];
  let output = '';
  for (let i = 0; i + 2 <= shuffled.length; i += 2) {
    const byte = parseInt(shuffled.slice(i, i + 2), 16) ^ parseInt(ACW_KEY.slice(i, i + 2), 16);
    output += byte.toString(16).padStart(2, '0');
  }
  return output;
}

export async function search51job(keyword: string, city: string | undefined, page: number, signal?: AbortSignal, timeoutMs = 15000, filters?: RawFilters): Promise<ApiSearchResult | null> {
  void city; // 城市码无权威全表：全国检索 + 客户端按城市字段过滤，避免错码静默污染结果
  void filters; // 无实证码：客户端过滤层保证
  const timestamp = Math.floor(Date.now() / 1000);
  const requestId = nodeCrypto.randomBytes(16).toString('hex');
  const query = new URLSearchParams({
    api_key: '51job',
    timestamp: String(timestamp),
    keyword,
    searchType: '2',
    jobArea: '000000',
    pageNum: String(page),
    pageSize: '20',
    requestId,
    source: '1',
    accountId: '',
    pageCode: 'sou'
  });
  const pathWithQuery = `/api/job/search-pc?${query.toString()}`;
  const sign = nodeCrypto.createHmac('sha256', JOB51_SIGN_KEY).update(pathWithQuery).digest('hex');
  const headers: Record<string, string> = {
    sign,
    'user-agent': CHROME_UA,
    referer: `https://we.51job.com/pc/search?keyword=${encodeURIComponent(keyword)}&searchType=2`,
    accept: 'application/json, text/plain, */*'
  };

  // 首跳：HTTP 直连（sign）。老版 WAF（arg1 挑战）本地求解重试；新版 VM WAF 交浏览器现场过。
  const first = await first51jobHop(`https://we.51job.com${pathWithQuery}`, headers, signal);
  if (first.kind === 'json') return finish51job(first.json);
  if (first.kind === 'challenge') {
    const cookie = `${first.cookieName}=${first.cookieValue}`;
    const retry = await fetch(`https://we.51job.com${pathWithQuery}`, {
      headers: { ...headers, cookie },
      signal: signal ?? undefined
    }).catch(() => null);
    if (retry) {
      const json: unknown = await retry.json().catch(() => null);
      if (json && typeof json === 'object') return finish51job(json);
    }
  }
  // 浏览器兜底：真实 Chromium 打开官网过 WAF 挑战，再由页面内同源 fetch 调搜索 API。
  // WAF 对浏览器首访也可能抖（偶尔返回空/挑战变体）——带噪声自动重试一次。
  let browserJson = await inPageFetch('https://we.51job.com/pc/search', `https://we.51job.com${pathWithQuery}`, { headers: { sign } }, signal, timeoutMs);
  if (!browserJson) {
    await new Promise(resolve => setTimeout(resolve, 1500 + Math.floor(Math.random() * 2000)));
    browserJson = await inPageFetch('https://we.51job.com/pc/search', `https://we.51job.com${pathWithQuery}`, { headers: { sign } }, signal, timeoutMs);
  }
  if (!browserJson) return { status: 'access_restricted', jobs: [] };
  return finish51job(browserJson);
}

function finish51job(json: unknown): ApiSearchResult {
  const envelope = json as Record<string, unknown>;
  if (envelope.status === '110011') return { status: 'access_restricted', jobs: [] };
  const body = envelope.resultbody ?? envelope.data ?? envelope;
  const jobs = harvestJobs(body, '51job', 'https://we.51job.com');
  return { status: jobs.length ? 'ok' : 'empty', jobs };
}

type FirstHop = { kind: 'json'; json: unknown } | { kind: 'challenge'; cookieName: string; cookieValue: string } | { kind: 'blocked' };

async function first51jobHop(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<FirstHop> {
  const first = await fetch(url, { headers, signal: signal ?? undefined }).catch(() => null);
  if (!first) return { kind: 'blocked' };
  const contentType = first.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    const json: unknown = await first.json().catch(() => null);
    return json && typeof json === 'object' ? { kind: 'json', json } : { kind: 'blocked' };
  }
  const html = (await first.text().catch(() => '')).slice(0, 262144);
  const arg1 = /arg1\s*=\s*['"]([0-9A-Fa-f]{40,})['"]/.exec(html)?.[1];
  const value = arg1 ? solveAcwScV3(arg1) : '';
  if (!value) return { kind: 'blocked' };
  const cookieName = /acw_sc__v2/.test(html) ? 'acw_sc__v2' : 'acw_sc__v3';
  return { kind: 'challenge', cookieName, cookieValue: value };
}
