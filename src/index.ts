import { CrawlerService } from './mcp/crawlerService';
import { StorageService } from './services/storageService';
import { crawlerConfigs } from './config/crawlerConfig';
import { Dataset } from '@crawlee/playwright';

async function main() {
  const crawlerService = new CrawlerService();
  const storageService = new StorageService();

  for (const config of crawlerConfigs) {
    try {
      console.log(`Starting crawl for ${config.name}...`);
      const result = await crawlerService.startCrawling(config);
      
      // 获取爬取的数据
      const dataset = result || [];
      
      // 保存爬取结果
      await storageService.saveData(config.name, {
        config,
        items: dataset,
        timestamp: Date.now()
      });

      console.log(`Crawling completed for ${config.name}`);
    } catch (error) {
      console.error(`Error crawling ${config.name}:`, error);
    }
  }
}

main();