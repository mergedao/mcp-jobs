import { SiteConfig } from '../config/crawlerConfig';
import { WebCrawler, CrawlerData } from '../crawler/webCrawler';

export class CrawlerService {
  private crawler: WebCrawler;

  constructor() {
    this.crawler = new WebCrawler();
  }

  async startCrawling(options: SiteConfig): Promise<CrawlerData[] | Record<string, CrawlerData[]>> {
    try {
      await this.crawler.crawl(options);
      return this.crawler.getData(options.name) || [];
    } catch (error) {
      console.error('Error in crawler service:', error);
      throw error;
    }
  }
} 