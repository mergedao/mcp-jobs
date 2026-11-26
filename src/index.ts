import { CrawlerService } from './mcp/crawlerService';
import { StorageService } from './services/storageService';
import { crawlerConfigs, SiteConfig } from './config/crawlerConfig';
import { jobSearchUrls, JobPlatform } from './config/urlConfig';
import { CrawlerData, PageFailure } from './crawler/webCrawler';
import { officialJobLink, jobPlatform } from './config/jobLinks';
import { withRequestBudget } from './services/requestBudget';
import { readPublicHtml } from './services/publicHtml';
import { platformApiSearch, closePlatformApis } from './platforms/registry';
import { normalizeFilters, clientFilter } from './platforms/filters';
import { jitterPause } from './core/cdp';
import type { ApiSearchResult } from './platforms/types';

export interface SearchParams {
  keyword?: string;
  city?: string;
  page?: number;
  salary?: string;
  workYear?: string;
  education?: string;
  jobType?: string;
  maxPages?: number;
  publicPages?: string[];
}

export type SourceStatus = PageFailure | 'ok' | 'empty' | 'unsupported_source' | 'unsupported_filters';

function findConfig(url: string): SiteConfig | undefined {
  if (!officialJobLink(url)) return undefined;
  return crawlerConfigs.find(config =>
    config.url === url || (config.urlPattern && new RegExp(config.urlPattern).test(url))
  );
}

async function crawlByUrl(url: string, params: SearchParams, signal?: AbortSignal, timeoutMs?: number): Promise<CrawlerData[] | null> {
  const config = findConfig(url);
  if (!config) return null;

  try {
    const target = config.urlBuilder(url, params, config.config ?? {});
    const request = { ...config, url: target };
    const dataset = config.parsePublicHtml
      ? await readPublicHtml(target, config.parsePublicHtml, signal)
      : await new CrawlerService().startCrawling(request, undefined, signal, timeoutMs);
    if (!signal?.aborted && dataset?.some(page => page.succeeded)) {
      try {
        await new StorageService().saveData(config.name, {
          config: request,
          items: dataset,
          timestamp: Date.now()
        });
      } catch {
        // The optional archive must not turn a successful lookup into a failure.
      }
    }
    return dataset;
  } catch (error) {
    if (!signal?.aborted) console.error(`Unable to load source ${config.name}:`, error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

function browserHandoff(url: string, status: SourceStatus) {
  if (status === 'login_required') {
    return { browserUrl: url, action: '在招聘平台官方页面登录，选好职位后把职位链接和页面信息交给 mcp_prepare_application' };
  }
  if (status === 'access_restricted') {
    return { browserUrl: url, action: '打开招聘平台，按页面提示处理' };
  }
  if (status === 'rate_limited') {
    return { browserUrl: url, action: '稍后重试' };
  }
  return {};
}

function readSource(dataset: CrawlerData[] | null, key: string): { status: SourceStatus; items: Record<string, unknown>[] } {
  const page = dataset?.[0];
  if (!page?.succeeded) return { status: page?.failure ?? 'unavailable', items: [] };

  const value: unknown = page.data[key];
  const values = Array.isArray(value) ? value : [value];
  const items = values.filter((item): item is Record<string, unknown> => {
    if (!item || typeof item !== 'object') return false;
    if (key === 'jobInfo') return 'title' in item && typeof item.title === 'string' && item.title.trim().length > 0;
    return 'jobDescription' in item && typeof item.jobDescription === 'string' && item.jobDescription.trim().length > 0;
  });
  return { status: items.length ? 'ok' : page.empty && key === 'jobInfo' ? 'empty' : 'unrecognized_page', items };
}

type Job = Record<string, unknown>;
type SourceResult = {
  source: JobPlatform;
  coverage: 'search_api' | 'search' | 'public_page';
  scanned?: number;
  publicPageUrl?: string;
  status: SourceStatus;
  count: number;
  browserUrl?: string;
  action?: string;
};
type SearchResult = { jobs: Job[]; sources: SourceResult[] };

type SearchSource = { name: JobPlatform; url: string; browserUrl: string; publicSample: boolean; cityScoped?: boolean };

function searchSources(params: SearchParams): SearchSource[] {
  if (params.publicPages) {
    if (params.publicPages.length < 1 || params.publicPages.length > jobSearchUrls.length) {
      throw new Error('请提供一至四个官方招聘列表链接');
    }
    const seen = new Set<string>();
    return params.publicPages.map(value => {
      const link = officialJobLink(value);
      const source = link && jobSearchUrls.find(entry => entry.name === jobPlatform(link));
      if (!link || !source || !findConfig(link.href)?.rules.jobInfo) {
        throw new Error('只支持已接入的官方招聘列表链接');
      }
      if (seen.has(source.name)) throw new Error('每个平台最多提供一个公开列表页面');
      seen.add(source.name);
      return { ...source, url: link.href, browserUrl: link.href, publicSample: true };
    });
  }

  return jobSearchUrls.map(source => {
    const beijing = params.city === '北京' || params.city === '北京市';
    if (source.name === 'liepin' && beijing && !params.salary && !params.workYear) {
      const url = 'https://www.liepin.com/city-bj/';
      return { ...source, url, browserUrl: url, publicSample: true, cityScoped: true };
    }
    return { ...source, publicSample: 'publicSample' in source };
  });
}

function matches(text: unknown, value: string | undefined) {
  const label = String(text ?? '').toLowerCase();
  return (value ?? '').trim().toLowerCase().split(/\s+/).every(word => label.includes(word));
}

export async function searchJobSources(params: SearchParams = {}, parent?: AbortSignal): Promise<SearchResult> {
  const { keyword, city, page = 1, salary, workYear, education, jobType, maxPages = 1 } = params;
  const selected = searchSources(params);
  const filters = normalizeFilters({ salary, workYear, education, jobType });
  const pages = Math.min(Math.max(maxPages, 1), 10);
  const jobs: Job[][] = selected.map(() => []);
  const sources: SourceResult[] = selected.map(source => ({
    source: source.name,
    coverage: source.publicSample ? 'public_page' : 'search',
    status: 'timeout',
    count: 0
  }));
  const snapshot = (): SearchResult => ({ jobs: jobs.flat(), sources: [...sources] });

  return withRequestBudget(async (signal, timeoutMs) => {
    await Promise.all(selected.map(async (source, index) => {
      const initial = sources[index];
      if (source.publicSample && (salary || workYear || education || jobType || pages > 1)) {
        sources[index] = {
          ...initial,
          status: 'unsupported_filters',
          browserUrl: source.browserUrl,
          action: '此公开页只支持在当前结果中按职位名称和城市筛选'
        };
        return;
      }
      // S1 平台 API 层：数据最全的通道（含原生筛选码），多页串行翻页；失败落回 S2 公开页与 DOM。
      let apiFailure: ApiSearchResult | null = null;
      if (!params.publicPages) {
        const collected: Job[] = [];
        const seenIds = new Set<string>();
        const startTime = Date.now();
        let lastStatus: ApiSearchResult['status'] = 'timeout';
        for (let currentPage = page; currentPage < page + pages; currentPage++) {
          const api = await platformApiSearch(source.name, { keyword, city, page: currentPage, filters }, signal, timeoutMs);
          lastStatus = api?.status ?? 'timeout';
          if (api?.jobs.length) {
            for (const job of api.jobs) {
              const id = String(job.jobDetail ?? '');
              if (seenIds.has(id)) continue;
              seenIds.add(id);
              collected.push({ ...job, source: source.name });
            }
          }
          // 翻页节奏：BOSS 红线 12–22s，其余 1.4–2.8s；超预算立即收敛
          if (currentPage + 1 < page + pages && Date.now() - startTime < timeoutMs * 0.7) {
            if (source.name === 'zhipin') await jitterPause(12000, 22000);
            else await jitterPause(1400, 2800);
          } else break;
          if (lastStatus !== 'ok') break; // 该页非 ok 就不再翻
        }
        const filtered = clientFilter(collected, filters);
        if (collected.length) {
          jobs[index] = filtered.map(job => ({ ...job, source: source.name }));
          sources[index] = {
            ...initial,
            coverage: 'search_api',
            status: filtered.length ? 'ok' : 'empty',
            count: filtered.length,
            ...(pages > 1 ? { scanned: collected.length } : {})
          };
          return;
        }
        if (lastStatus === 'login_required' || lastStatus === 'access_restricted' || lastStatus === 'rate_limited') {
          apiFailure = { status: lastStatus, jobs: [] };
        }
      }
      const dataset = await crawlByUrl(source.url, {
        keyword: [keyword, city].filter(Boolean).join(' '),
        city, page, salary, workYear
      }, signal, timeoutMs);
      if (signal.aborted) return;
      const result = readSource(dataset, 'jobInfo');
      const base = dataset?.[0]?.url ?? source.url;
      const links = new Set<string>();
      const parsed = result.items.flatMap(item => {
        const link = typeof item.jobDetail === 'string' && item.jobDetail.trim()
          ? officialJobLink(item.jobDetail, base)
          : undefined;
        if (!link || jobPlatform(link) !== source.name || !findConfig(link.href)?.rules.job) return [];
        if (link.hostname === 'm.liepin.com') link.hostname = 'www.liepin.com';
        link.hash = '';
        link.search = '';
        if (links.has(link.href)) return [];
        links.add(link.href);
        return [{ ...item, jobDetail: link.href, source: source.name } as Job];
      });
      const start = (page - 1) * 25;
      const items = source.publicSample
        ? parsed.filter(item => matches(item.title, keyword) && (
          source.cityScoped || matches(item.address, city?.replace(/市$/, ''))
        )).slice(start, start + 25)
        : clientFilter(parsed, filters);
      const domStatus = result.status !== 'ok' ? result.status
        : !parsed.length ? 'unrecognized_page'
        : !items.length ? 'empty'
        : 'ok';
      const generic = domStatus === 'timeout' || domStatus === 'unavailable';
      const status = apiFailure && generic ? apiFailure.status : domStatus;
      jobs[index] = items;
      sources[index] = {
        ...initial,
        status,
        count: items.length,
        ...(source.publicSample ? { scanned: parsed.length, publicPageUrl: source.url } : {}),
        ...(apiFailure && generic
          ? { ...(apiFailure.note ? { action: apiFailure.note } : {}), ...browserHandoff(source.browserUrl, status) }
          : browserHandoff(source.browserUrl, status))
      };
    }));
    return snapshot();
  }, snapshot, parent);
}

export async function searchJobList(params: SearchParams = {}) {
  return (await searchJobSources(params)).jobs;
}

type DetailResult = { detail: Job | null; status: SourceStatus; browserUrl?: string; action?: string };

export async function readJobDetail(url: string, parent?: AbortSignal): Promise<DetailResult> {
  const link = officialJobLink(url);
  if (link?.hostname === 'm.liepin.com') link.hostname = 'www.liepin.com';
  const config = link && findConfig(link.href);
  if (!link || !config?.rules.job) return { detail: null, status: 'unsupported_source' };
  return withRequestBudget<DetailResult>(async (signal, timeoutMs) => {
    const { items, status } = readSource(await crawlByUrl(link.href, {}, signal, timeoutMs), 'job');
    return { detail: items[0] ?? null, status, ...browserHandoff(link.href, status) };
  }, () => ({ detail: null, status: 'timeout' }), parent);
}

export async function crawlJobDetail(url: string) {
  return (await readJobDetail(url)).detail;
}

export { crawlByUrl, jobSearchUrls };

if (require.main === module) {
  searchJobList({ keyword: '前端开发', city: '北京' })
    .then(jobs => console.log(jobs))
    .finally(() => closePlatformApis().finally(() => process.exit(0)));
}
