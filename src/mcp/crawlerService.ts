import { SiteConfig } from '../config/crawlerConfig';
import { WebCrawler, CrawlerData } from '../crawler/webCrawler';

export class CrawlerService {
  private crawler: WebCrawler;

  constructor() {
    this.crawler = new WebCrawler();
  }

  async startCrawling(options: SiteConfig, params: Record<string, string> = { keyword: '' }): Promise<CrawlerData[] | null> {
    try {
      // const queryParams = params ? '?' + new URLSearchParams(params).toString() : '';
      options.url = options.url + params?.keyword;
      await this.crawler.crawl(options);
      return this.crawler.getData(options.name) || [];
    } catch (error) {
      console.error('Error in crawler service:', error);
      throw error;
    }
  }
} 