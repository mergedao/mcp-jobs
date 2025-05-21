import { SiteConfig } from '../config/crawlerConfig';
import { WebCrawler, CrawlerData } from '../crawler/webCrawler';

export class CrawlerService {
  private crawler: WebCrawler;

  constructor() {
    this.crawler = new WebCrawler();
  }

  async startCrawling(options: SiteConfig, params: Record<string, string> = { keyword: '' }): Promise<CrawlerData[] | null> {
    try {
      if (params?.keyword) {
        try {
          const url = new URL(options.url);
          url.searchParams.append('keyword', params.keyword);
          options.url = url.toString();
          console.log(`[CrawlerService] Appended keyword. New URL: ${options.url}`);
        } catch (e: any) {
          console.error(`[CrawlerService] Error constructing URL with keyword: ${params.keyword} for base URL: ${options.url}. Error: ${e.message}`);
          // Proceeding with original or partially modified URL. Consider if this should be a critical failure.
        }
      }
      await this.crawler.crawl(options);
      return this.crawler.getData(options.name) || [];
    } catch (error) {
      console.error('Error in crawler service:', error);
      throw error;
    }
  }

  public async close(): Promise<void> {
    await this.crawler.close();
  }
} 