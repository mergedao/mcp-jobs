import { chromium, firefox, webkit, Browser, BrowserContext, Page, ElementHandle } from 'playwright';
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
  private crawledData: Map<string, CrawlerData[]>;
  private debug: boolean;
  private browser: Browser | null;
  private context: BrowserContext | null;

  constructor(debug = false) {
    this.debug = debug;
    this.crawledData = new Map();
    this.browser = null;
    this.context = null;
    this.log('Initializing WebCrawler...');
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

  private async setupBrowser(): Promise<void> {
    if (!this.browser) {
      this.log('Launching browser...');
      this.browser = await chromium.launch({
        headless: true
      });
      this.log('Browser launched');
    }

    if (!this.context) {
      this.log('Creating browser context...');
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36'
      });
      this.log('Browser context created');
    }
  }

  public async close(): Promise<void> {
    if (this.context) {
      this.log('Closing browser context...');
      await this.context.close();
      this.context = null;
    }
    
    if (this.browser) {
      this.log('Closing browser...');
      await this.browser.close();
      this.browser = null;
    }
  }

  private async handleUrl(url: string, config: SiteConfig, params?: Record<string, string>): Promise<void> {
    if (!this.browser || !this.context) {
      this.log(`Browser or context not initialized for URL: ${url}. Setting up...`);
      await this.setupBrowser();
    }

    const maxRetries = config.maxRetries ?? 3;
    const retryDelayMs = config.retryDelayMs ?? 1000;
    let attempts = 0;
    let page: Page | null = null; 

    while (attempts < maxRetries) {
      try {
        this.log(`Attempt ${attempts + 1}/${maxRetries} for URL: ${url} (Config: ${config.name})`);

        if (page && !page.isClosed()) {
            this.log('Closing page from previous failed attempt...');
            await page.close();
        }
        page = null; 

        this.log('Creating new page...');
        page = await this.context!.newPage();
        
        const timeout = config.timeout || 30000;
        this.log(`Navigating to ${url} with timeout ${timeout}ms`);
        
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: timeout
        });
        
        // REMOVED: await page.waitForTimeout(2000);

        if (config.readinessSelector) {
          this.log(`Waiting for readiness selector "${config.readinessSelector}" to be visible...`);
          try {
            await page.waitForSelector(config.readinessSelector, { state: 'visible', timeout: timeout });
            this.log('Readiness selector found and visible.');
          } catch (e: any) {
            this.log(`Timeout or error waiting for readiness selector "${config.readinessSelector}": ${e.message}. Proceeding with extraction attempt, but data might be incomplete.`);
            // Optionally, this could be a point where we throw an error to trigger a retry if the selector is critical
            // For now, we'll log and proceed.
          }
        }
        
        this.log('Page navigation and readiness checks complete.');
        this.log(`Extracting data using rules for config: ${config.name}, URL: ${url}`);
        const { rawData, processedData } = await this.extractData(page, config);
        this.log('Data extracted successfully:', { raw: rawData, processed: processedData });
        
        const crawlerData: CrawlerData = {
          url: url,
          data: processedData,
          rawData,
          timestamp: Date.now(),
          params: params,
          succeeded: true
        };

        this.log(`Saving successful data for site: ${config.name}, URL: ${url}`);
        this.saveData(config.name, crawlerData);
        this.log('Data saved successfully');
        break; 

      } catch (error: any) {
        attempts++;
        this.log(`Error on attempt ${attempts}/${maxRetries} for URL ${url} (Config: ${config.name}): ${error.message}`, error);
        
        if (page && !page.isClosed()) {
            try {
                this.log(`Closing page after error on attempt ${attempts}/${maxRetries} for URL ${url}...`);
                await page.close();
            } catch (closeError) {
                this.log(`Error closing page during error handling for URL ${url} (Config: ${config.name}):`, closeError);
            }
        }
        page = null; 

        if (attempts >= maxRetries) {
          this.log(`All ${maxRetries} attempts failed for URL ${url} (Config: ${config.name}). Saving error data.`);
          const errorData: CrawlerData = {
            url: url,
            data: {},
            timestamp: Date.now(),
            succeeded: false,
            errors: [error.message], 
            params: params
          };
          this.saveData(config.name, errorData);
        } else {
          this.log(`Waiting ${retryDelayMs}ms before next attempt for URL ${url} (Config: ${config.name})...`);
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    } 

    if (page && !page.isClosed()) {
        this.log(`Final cleanup: Closing page for URL ${url} (Config: ${config.name}).`);
        try {
            await page.close();
        } catch (finalCloseError) {
            this.log(`Error during final page close for URL ${url} (Config: ${config.name}):`, finalCloseError);
        }
        page = null;
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

  private async extractData(page: Page, config: SiteConfig): Promise<{ rawData: Record<string, any>, processedData: Record<string, any> }> {
    const rawData: Record<string, any> = {};
    const processedData: Record<string, any> = {};
    const rules = config.rules;

    for (const [key, rule] of Object.entries(rules || [])) {
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

    return { rawData, processedData };
  }

  async crawl(config: SiteConfig & { params?: Record<string, string> }): Promise<void> {
    this.log('Starting crawl with config:', config);
    
    try {
      await this.setupBrowser();
      await this.handleUrl(config.url, config, config.params);
    } finally {
      // Browser is no longer closed here to allow reuse by explicit call to close()
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