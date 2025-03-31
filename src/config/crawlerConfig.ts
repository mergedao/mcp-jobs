import { ElementHandle } from 'playwright';

export interface CrawlerRule {
  selector: string;      // CSS 选择器
  attribute?: string;    // 要获取的属性（如 href, src 等）
  type: 'text' | 'attribute' | 'html';  // 获取类型
  handler?: (currentData: Record<string, any>, extractedValue: any, element: ElementHandle<Element>) => Promise<any>;  // 数据处理器
}

export interface SiteConfig {
  url: string;           // 网站URL
  name: string;          // 网站名称
  urlPattern?: string;   // URL 匹配模式（支持正则表达式）
  rules: {              // 数据提取规则
    [key: string]: CrawlerRule;
  };
  maxRequestsPerCrawl?: number;
  maxConcurrency?: number;
  timeout?: number;
}

export const crawlerConfigs: SiteConfig[] = [
  {
    url: 'https://m.liepin.com/',
    name: 'liepin',
    urlPattern: '^https://m\.liepin.com\.com/(?:products|items)/(?<id>\\d+)$',
    rules: {
      jobInfo: {
        selector: '.recommend-job-list .job-card',
        type: 'html',
        handler: async (currentData, value, element) => {
          try {
            console.log('element，当前元素内容：');
            // 使用 $eval 获取子元素内容
            const title = await element.$eval('.job-title', el => el.textContent?.trim() || '');
            const salary = await element.$eval('small', el => el.textContent?.trim() || '');
            const company = await element.$eval('.job-card-company', el => el.textContent?.trim() || '');
            
            // 使用 $$eval 获取多个子元素
            const tags = await element.$$eval('.job-card-labels label', elements => 
              elements.map(el => el.textContent?.trim() || '')
            );

            // 职位详情
            const jobDetail = await element.getAttribute('href');

            console.log('Extracted job info:', { title, salary, company, tags, jobDetail });

            return {
              title,
              salary,
              company,
              tags,
              jobDetail
            };
          } catch (error) {
            console.error('Error extracting job info:', error);
            // 如果出错，尝试使用另一种方式获取
            const content = await element.textContent();
            // console.log('Raw element content:', content);
            return { content };
          }
        }
      },
      // hotJobs: {
      //   selector: '.hot-job-list',
      //   type: 'html',
      //   handler: async (currentData, value, element) => {
      //     try {
      //       // 使用 $eval 获取标题
      //       const title = await element.$eval('.section-title', el => el.textContent?.trim() || '');
            
      //       // 使用 $$eval 获取所有工作项
      //       const jobs = await element.$$eval('.job-item', items =>
      //         items.map(item => ({
      //           name: item.querySelector('.job-name')?.textContent?.trim() || '',
      //           company: item.querySelector('.company-name')?.textContent?.trim() || '',
      //           salary: item.querySelector('.salary')?.textContent?.trim() || ''
      //         }))
      //       );

      //       console.log('Extracted hot jobs:', { title, jobCount: jobs.length });

      //       return {
      //         title,
      //         jobs
      //       };
      //     } catch (error) {
      //       console.error('Error extracting hot jobs:', error);
      //       return null;
      //     }
      //   }
      // },
      // recommendCompanies: {
      //   selector: '.recommend-company-list',
      //   type: 'html',
      //   handler: async (currentData, value, element) => {
      //     try {
      //       // 使用 $$eval 获取所有公司信息
      //       const companies = await element.$$eval('.company-item', items =>
      //         items.map(item => ({
      //           name: item.querySelector('.company-name')?.textContent?.trim() || '',
      //           industry: item.querySelector('.industry')?.textContent?.trim() || '',
      //           scale: item.querySelector('.scale')?.textContent?.trim() || '',
      //           jobs: Array.from(item.querySelectorAll('.job-item')).map(job => ({
      //             title: job.querySelector('.job-title')?.textContent?.trim() || '',
      //             salary: job.querySelector('.salary')?.textContent?.trim() || ''
      //           }))
      //         }))
      //       );

      //       console.log('Extracted companies:', { companyCount: companies.length });

      //       return companies;
      //     } catch (error) {
      //       console.error('Error extracting companies:', error);
      //       return [];
      //     }
      //   }
      // }
    },
    maxRequestsPerCrawl: 1,
    maxConcurrency: 1,
    timeout: 30000
  }
];
