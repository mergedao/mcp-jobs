import { CrawlerService } from './mcp/crawlerService';
import { StorageService } from './services/storageService';
import { crawlerConfigs } from './config/crawlerConfig';
import { jobSearchUrls } from './config/urlConfig';
import { CrawlerData } from './crawler/webCrawler';

// 定义搜索参数接口
export interface SearchParams {
  keyword?: string;
  city?: string;
  page?: number;
}

async function crawlByUrl(url: string): Promise<CrawlerData[] | null> {
  const crawlerService = new CrawlerService();
  const storageService = new StorageService();

  // 根据 URL 匹配对应的配置
  const matchedConfig = crawlerConfigs.find(config => {
    if (config.url === url) return true;
    if (config.urlPattern && new RegExp(config.urlPattern).test(url)) return true;
    return false;
  });

  if (!matchedConfig) {
    console.error('No matching configuration found for URL:', url);
    return null;
  }

  try {
    console.log(`Starting crawl for URL: ${url}`);
    // 创建一个新的配置，使用匹配到的规则但替换URL
    const customConfig = {
      ...matchedConfig,
      url: url
    };
    
    const result = await crawlerService.startCrawling(customConfig);
    
    // 获取爬取的数据
    const dataset = result || [];
    
    // 保存爬取结果
    await storageService.saveData(customConfig.name, {
      config: customConfig,
      items: dataset,
      timestamp: Date.now()
    });

    console.log(`Crawling completed for URL: ${url}`);
    return dataset;
  } catch (error) {
    console.error(`Error crawling URL ${url}:`, error);
    return null;
  }
}

export async function searchJobList(params: SearchParams = {}) {
  const { keyword, city, page = 1 } = params;
  const result = [];
  for (const config of jobSearchUrls) {
    const dataset = await crawlByUrl(config.url);
    if (dataset) {
      const jobItems = dataset.filter(item => item.data?.jobInfo);
      result.push(...jobItems);
    }
  }
  return result;
}

async function main() {
  // const result = await searchJobList();
  const result = await crawlJobDetail('https://www.liepin.com/job/1962593655.shtml');
  console.log(result);
}

export async function crawlJobDetail(url: string) {
  const result = await crawlByUrl(url);
  if (!result || result.length === 0) {
    return null;
  }
  return result[0]?.data?.jobInfo || null;
}

// 导出函数供外部使用
export { 
  main, 
  crawlByUrl,
  jobSearchUrls
 };

// 如果直接运行此文件，则执行 main 函数
if (require.main === module) {
  main();
}