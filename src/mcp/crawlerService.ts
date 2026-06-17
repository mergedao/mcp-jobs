import { SiteConfig } from '../config/crawlerConfig';
import { WebCrawler, CrawlerData } from '../crawler/webCrawler';

export class CrawlerService {
  private crawler: WebCrawler;

  constructor() {
    this.crawler = new WebCrawler();
  }

  async startCrawling(options: SiteConfig, params: Record<string, string> = { keyword: '' }): Promise<CrawlerData[] | null> {
    try {
      await this.crawler.crawl({ ...options, params });
      return this.crawler.getData(options.name) || [];
    } catch (error) {
      console.error('Error in crawler service:', error);
      throw error;
    }
  }
} 
