import { PlaywrightCrawler, Request } from '@crawlee/playwright';
import { Page, ElementHandle } from 'playwright';
import { SiteConfig, CrawlerRule } from '../config/crawlerConfig';
import { crawlerConfigs } from '../config/crawlerConfig';

export interface CrawlerData {
  url: string;
  data: Record<string, any>;
  rawData?: Record<string, any>;  // 存储原始数据
  timestamp: number;
  params?: Record<string, string>;
  succeeded: boolean;
  errors?: string[];
}

export class WebCrawler {
  private crawler: PlaywrightCrawler;
  private crawledData: Map<string, CrawlerData[]>;
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
    this.crawledData = new Map();
    this.log('Initializing WebCrawler...');
    
    this.crawler = new PlaywrightCrawler({
      headless: false,
      maxRequestsPerCrawl: 100,
      maxConcurrency: 1,
      requestHandlerTimeoutSecs: 30,
      maxRequestRetries: 1,
      navigationTimeoutSecs: 30,
      requestHandler: this.requestHandler.bind(this),
      failedRequestHandler: this.failedRequestHandler.bind(this)
    });
    
    this.log('WebCrawler initialized with configuration:', {
      headless: false,
      maxRequestsPerCrawl: 1,
      maxConcurrency: 1,
      requestHandlerTimeoutSecs: 30,
      maxRequestRetries: 1,
      navigationTimeoutSecs: 30
    });
  }

  private log(message: string, data?: any): void {
    if (this.debug) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] ${message}`);
      if (data) {
        console.log(JSON.stringify(data, null, 2));
      }
    }
  }

  private async requestHandler({ page, request }: { page: Page, request: Request }): Promise<void> {
    this.log(`Starting to crawl URL: ${request.url}`);
    try {
      console.log('requestHandler 开始处理数据');
      this.log('Waiting for page to load...');
      await page.waitForLoadState('networkidle');
      this.log('Page loaded successfully');
      
      this.log('Extracting data using rules:', request.userData.config.rules);
      const { rawData, processedData } = await this.extractData(page);
      this.log('Data extracted successfully:', { raw: rawData, processed: processedData });
      // console.log('requestHandler 处理数据完成', processedData);
      const crawlerData: CrawlerData = {
        url: request.url,
        data: processedData,
        rawData,
        timestamp: Date.now(),
        params: request.userData.params,
        succeeded: true
      };

      this.log(`Saving data for site: ${request.userData.config.name}`);
      this.saveData(request.userData.config.name, crawlerData);
      this.log('Data saved successfully');
    } catch (error: any) {
      this.log(`Error crawling ${request.url}:`, error);
      const errorData: CrawlerData = {
        url: request.url,
        data: {},
        timestamp: Date.now(),
        succeeded: false,
        errors: [error.message]
      };
      this.log('Saving error data');
      this.saveData(request.userData.config.name, errorData);
    }
  }

  private async failedRequestHandler({ request }: { request: Request }): Promise<void> {
    this.log(`Request failed for URL: ${request.url}`, {
      errorMessages: request.errorMessages
    });
    
    const errorData: CrawlerData = {
      url: request.url,
      data: {},
      timestamp: Date.now(),
      succeeded: false,
      errors: request.errorMessages
    };
    this.saveData(request.userData.config.name, errorData);
    this.log('Failed request data saved');
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

  private async extractData(page: Page): Promise<{ rawData: Record<string, any>, processedData: Record<string, any> }> {
    const rawData: Record<string, any> = {};
    const processedData: Record<string, any> = {};
    const rules = crawlerConfigs.find(config => {
      return config.url === page.url() || (config.urlPattern && new RegExp(config.urlPattern).test(page.url()))
    })?.rules;

    for (const [key, rule] of Object.entries(rules || [])) {
      this.log(`Extracting data for rule: ${key}`, rule);
      console.log('rule',key, rule);
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

        console.log('rawData[key]', rule, rule.handler);
        // 应用数据处理器
        if (rule.handler) {
          try {
            // 对每个元素应用处理器
            const results = await Promise.all(
              elements.map(async (element) => {
                console.log('element', element);
                return rule.handler!(processedData, rawData[key], element);
              })
            );
            // console.log('results----:', results);

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

    return { rawData, processedData };
  }

  async crawl(config: SiteConfig & { params?: Record<string, string> }): Promise<void> {
    this.log('Starting crawl with config:', config);
    await this.crawler.run([{
      url: config.url,
      userData: {
        config,
        params: config.params
      }
    }]);
    this.log('Crawl completed');
  }

  // 数据读取接口
  getData(siteName?: string): Record<string, CrawlerData[]> | CrawlerData[] | null {
    this.log(`Getting data${siteName ? ` for site: ${siteName}` : ' for all sites'}`);
    const data = siteName 
      ? this.crawledData.get(siteName) || null
      : Object.fromEntries(this.crawledData);
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