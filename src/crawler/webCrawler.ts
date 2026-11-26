import { chromium, Browser, BrowserContext, Page, Response } from 'playwright';
import { SiteConfig, CrawlerRule } from '../config/crawlerConfig';
import { crawlerConfigService } from '../services/crawlerConfigService';

export type PageFailure = 'login_required' | 'access_restricted' | 'rate_limited' | 'unavailable' | 'unrecognized_page' | 'not_found' | 'timeout';

export interface CrawlerData {
  url: string;
  data: Record<string, any>;
  rawData?: Record<string, any>;  // 存储原始数据
  timestamp: number;
  params?: Record<string, string>;
  succeeded: boolean;
  failure?: PageFailure;
  empty?: boolean;
  errors?: string[];
}

function pageFailure(response: Response | null, current: string, target: string): PageFailure | undefined {
  const code = response?.status();
  const finalUrl = new URL(current);
  if (code === 429) return 'rate_limited';
  if (code === 403 || /(?:^|\/)(?:security|captcha|verify|accountblock)(?:\/|[.-]|$)/i.test(finalUrl.pathname)) return 'access_restricted';
  if (code === 401 || /(?:^|\/)(?:login|signin|passport)(?:\/|[.-]|$)/i.test(finalUrl.pathname)) return 'login_required';
  if (code === 404 || code === 410) return 'not_found';
  if (!code || code >= 400) return 'unavailable';
  const original = new URL(target);
  if (finalUrl.origin !== original.origin || finalUrl.pathname.replace(/\/$/, '') !== original.pathname.replace(/\/$/, '')) return 'unrecognized_page';
}

export class WebCrawler {
  private crawledData: Map<string, CrawlerData[]>;
  private debug: boolean;
  private browser: Browser | null;
  private context: BrowserContext | null;
  private currentSiteConfig?: SiteConfig;

  constructor(debug?: boolean) {
    // 如果没有明确指定 debug，则从配置服务获取
    this.debug = debug !== undefined ? debug : crawlerConfigService.isDebugMode();
    this.crawledData = new Map();
    this.browser = null;
    this.context = null;
    this.log('Initializing WebCrawler...');
    this.log(crawlerConfigService.getConfigSummary());
  }

  private log(message: string, data?: any): void {
    if (this.debug) {
      const timestamp = new Date().toISOString();
      // console.log(`[${timestamp}] ${message}`);
      // if (data) {
      //   console.log(JSON.stringify(data, null, 2));
      // }
    }
  }

  private async setupBrowser(timeout: number, signal?: AbortSignal): Promise<void> {
    if (!this.browser) {
      this.log('Launching browser...');

      // 获取浏览器启动配置
      const launchOptions = crawlerConfigService.getBrowserLaunchOptions(
        this.currentSiteConfig?.browserConfig
      );

      this.log(`Browser launch options: headless=${launchOptions.headless}`);

      // 优先本机真实 Chrome（指纹先验更强）；不可用再落回 Playwright 内置 Chromium
      try {
        this.browser = await chromium.launch({ ...launchOptions, timeout, channel: 'chrome' });
      } catch {
        this.browser = await chromium.launch({ ...launchOptions, timeout });
      }
      signal?.throwIfAborted();
      this.log('Browser launched');
    }

    if (!this.context) {
      this.log('Creating browser context...');

      // 获取浏览器上下文配置
      const contextOptions = crawlerConfigService.getBrowserContextOptions(
        this.currentSiteConfig?.browserConfig
      );

      this.context = await this.browser.newContext(contextOptions);
      this.log('Browser context created');
    }
  }

  private async closeBrowser(): Promise<void> {
    const browser = this.browser;
    this.context = null;
    if (!browser) return;
    try {
      await browser.close();
    } finally {
      if (this.browser === browser) this.browser = null;
    }
  }

  private async handleUrl(url: string, config: SiteConfig, timeout: number, params?: Record<string, string>): Promise<void> {
    let page: Page | null = null;
    
    try {
      this.log('Creating new page...');
      page = await this.context!.newPage();
      
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      let failure = pageFailure(response, page.url(), url);
      if (!failure) {
        const selectors = Object.values(config.rules).map(rule => rule.selector);
        if (config.emptySelector) selectors.push(config.emptySelector);
        if (selectors.length) {
          await page.waitForSelector(selectors.join(', '), { state: 'attached', timeout: Math.min(timeout, 2000) })
            .catch(error => { if (error.name !== 'TimeoutError') throw error; });
        }
        failure = pageFailure(response, page.url(), url);
        if (!failure && /^(?:Security Verification|安全验证|访问验证)$/i.test((await page.title()).trim())) {
          failure = 'access_restricted';
        }
      }
      if (failure) {
        this.saveData(config.name, { url, data: {}, timestamp: Date.now(), succeeded: false, failure });
        return;
      }

      this.log('Page loaded successfully');
      
      this.log('Extracting data using rules:', config.rules);
      const { rawData, processedData } = await this.extractData(page, config.rules);
      this.log('Data extracted successfully:', { raw: rawData, processed: processedData });
      
      const crawlerData: CrawlerData = {
        url: url,
        data: processedData,
        rawData,
        timestamp: Date.now(),
        params: params,
        succeeded: true,
        empty: config.emptySelector ? Boolean(await page.$(config.emptySelector)) : false
      };

      this.log(`Saving data for site: ${config.name}`);
      this.saveData(config.name, crawlerData);
      this.log('Data saved successfully');
      
    } catch (error: any) {
      this.log(`Error crawling ${url}:`, error);
      const errorData: CrawlerData = {
        url: url,
        data: {},
        timestamp: Date.now(),
        succeeded: false,
        failure: error.name === 'TimeoutError' ? 'timeout' : 'unavailable',
        errors: [error.message]
      };
      this.log('Saving error data');
      this.saveData(config.name, errorData);
    } finally {
      if (page) {
        this.log('Closing page...');
        await page.close().catch(() => {});
      }
    }
  }

  private saveData(siteName: string, data: CrawlerData): void {
    this.log(`Saving data for site: ${siteName}`, data);
    if (!this.crawledData.has(siteName)) {
      this.log(`Creating new data array for site: ${siteName}`);
      this.crawledData.set(siteName, []);
    }
    this.crawledData.get(siteName)?.push(data);
    this.log(`Current data count for ${siteName}: ${this.crawledData.get(siteName)?.length}`);
  }

  private async extractData(page: Page, rules: Record<string, CrawlerRule>): Promise<{ rawData: Record<string, any>, processedData: Record<string, any> }> {
    const rawData: Record<string, any> = {};
    const processedData: Record<string, any> = {};

    for (const [key, rule] of Object.entries(rules)) {
      this.log(`Extracting data for rule: ${key}`, rule);
      try {
        const elements = await page.$$(rule.selector);
        this.log(`Found ${elements.length} elements for selector: ${rule.selector}`);
        
        // 获取原始数据
        const values = await Promise.all(
          elements.map(async (element) => {
            switch (rule.type) {
              case 'text':
                return await element.textContent();
              case 'attribute':
                return await element.getAttribute(rule.attribute || '');
              case 'html':
                return await element.innerHTML();
              default:
                return null;
            }
          })
        );

        // 存储原始数据
        rawData[key] = values.length === 1 ? values[0] : values;
        this.log(`Extracted raw value for ${key}:`, rawData[key]);

        // 应用数据处理器
        if (rule.handler) {
          try {
            // 对每个元素应用处理器
            const results = await Promise.all(
              elements.map(async (element) => {
                return rule.handler!(processedData, rawData[key], element);
              })
            );

            processedData[key] = results.length === 1 ? results[0] : results;
            this.log(`Processed value for ${key}:`, processedData[key]);
          } catch (error) {
            this.log(`Error in handler for ${key}:`, error);
            processedData[key] = rawData[key];
          }
        } else {
          processedData[key] = rawData[key];
        }

      } catch (error) {
        this.log(`Error extracting data for rule ${key}:`, error);
        rawData[key] = null;
        processedData[key] = null;
      }
    }

    return { rawData: {}, processedData };
  }

  async crawl(config: SiteConfig & { params?: Record<string, string> }, signal?: AbortSignal, budgetMs = 15000): Promise<void> {
    this.log('Starting crawl with config:', config);

    // 设置当前站点配置，以便 setupBrowser 可以使用站点特定的浏览器配置
    this.currentSiteConfig = config;

    const timeout = Math.min(budgetMs, config.timeout ?? crawlerConfigService.getGlobalConfig().timeout);
    const interrupt = () => { void this.browser?.close().catch(() => {}); };
    signal?.addEventListener('abort', interrupt, { once: true });
    try {
      signal?.throwIfAborted();
      await this.setupBrowser(timeout, signal);
      signal?.throwIfAborted();
      await this.handleUrl(config.url, config, timeout, config.params);
    } finally {
      try {
        await this.closeBrowser().catch(error => {
          if (!signal?.aborted) console.error('Unable to close browser:', error.message);
        });
      } finally {
        signal?.removeEventListener('abort', interrupt);
        this.currentSiteConfig = undefined;
      }
    }

    this.log('Crawl completed');
  }

  // 数据读取接口
  getData(siteName?: string): | CrawlerData[] | null {
    this.log(`Getting data${siteName ? ` for site: ${siteName}` : ' for all sites'}`);
    const data = siteName 
      ? this.crawledData.get(siteName) || null
      : Array.from(this.crawledData.entries()).reduce((acc, [key, value]) => {
          acc.push(...value);
          return acc;
        }, [] as CrawlerData[])
    this.log('Retrieved data:', data);
    return data;
  }

  // 获取最新数据
  getLatestData(siteName: string): CrawlerData | null {
    this.log(`Getting latest data for site: ${siteName}`);
    const siteData = this.crawledData.get(siteName);
    if (!siteData || siteData.length === 0) {
      this.log(`No data found for site: ${siteName}`);
      return null;
    }
    const latestData = siteData[siteData.length - 1];
    this.log('Latest data:', latestData);
    return latestData;
  }

  // 获取成功爬取的数据
  getSuccessfulData(siteName: string): CrawlerData[] {
    this.log(`Getting successful data for site: ${siteName}`);
    const siteData = this.crawledData.get(siteName);
    if (!siteData) {
      this.log(`No data found for site: ${siteName}`);
      return [];
    }
    const successfulData = siteData.filter(data => data.succeeded);
    this.log(`Found ${successfulData.length} successful entries`);
    return successfulData;
  }

  // 获取失败的数据
  getFailedData(siteName: string): CrawlerData[] {
    this.log(`Getting failed data for site: ${siteName}`);
    const siteData = this.crawledData.get(siteName);
    if (!siteData) {
      this.log(`No data found for site: ${siteName}`);
      return [];
    }
    const failedData = siteData.filter(data => !data.succeeded);
    this.log(`Found ${failedData.length} failed entries`);
    return failedData;
  }

  // 清除数据
  clearData(siteName?: string): void {
    if (siteName) {
      this.log(`Clearing data for site: ${siteName}`);
      this.crawledData.delete(siteName);
    } else {
      this.log('Clearing all data');
      this.crawledData.clear();
    }
  }
} 