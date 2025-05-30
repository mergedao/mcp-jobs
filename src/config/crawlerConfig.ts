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
  // {
  //   url: 'https://m.liepin.com/zhaopin/?dqs=000&keyword=',
  //   name: 'liepin',
  //   urlPattern: '^https://m\.liepin.com\.com/(?:products|items)/(?<id>\\d+)$',
  //   rules: {
  //     jobInfo: {
  //       selector: '.recommend-job-list .job-card',
  //       type: 'html',
  //       handler: async (currentData, value, element) => {
  //         try {
  //           console.log('element，当前元素内容：');
  //           // 使用 $eval 获取子元素内容
  //           const title = await element.$eval('h3 span', el => el.textContent?.trim() || '');
  //           const salary = await element.$eval('h3 small', el => el.textContent?.trim() || '');
  //           const company = await element.$eval('.job-card-company', el => el.textContent?.trim() || '');
            
  //           // 使用 $$eval 获取多个子元素
  //           const tags = await element.$$eval('.job-card-labels label', elements => 
  //             elements.map(el => el.textContent?.trim() || '')
  //           );

  //           // 职位详情
  //           const jobDetail = await element.getAttribute('href');

  //           console.log('Extracted job info:', { title, salary, company, tags, jobDetail });

  //           return {
  //             title,
  //             salary,
  //             company,
  //             tags,
  //             jobDetail
  //           };
  //         } catch (error) {
  //           console.error('Error extracting job info:', error);
  //           // 如果出错，尝试使用另一种方式获取
  //           const content = await element.textContent();
  //           // console.log('Raw element content:', content);
  //           return { content };
  //         }
  //       }
  //     },
  //     // hotJobs: {
  //     //   selector: '.hot-job-list',
  //     //   type: 'html',
  //     //   handler: async (currentData, value, element) => {
  //     //     try {
  //     //       // 使用 $eval 获取标题
  //     //       const title = await element.$eval('.section-title', el => el.textContent?.trim() || '');
            
  //     //       // 使用 $$eval 获取所有工作项
  //     //       const jobs = await element.$$eval('.job-item', items =>
  //     //         items.map(item => ({
  //     //           name: item.querySelector('.job-name')?.textContent?.trim() || '',
  //     //           company: item.querySelector('.company-name')?.textContent?.trim() || '',
  //     //           salary: item.querySelector('.salary')?.textContent?.trim() || ''
  //     //         }))
  //     //       );

  //     //       console.log('Extracted hot jobs:', { title, jobCount: jobs.length });

  //     //       return {
  //     //         title,
  //     //         jobs
  //     //       };
  //     //     } catch (error) {
  //     //       console.error('Error extracting hot jobs:', error);
  //     //       return null;
  //     //     }
  //     //   }
  //     // },
  //     // recommendCompanies: {
  //     //   selector: '.recommend-company-list',
  //     //   type: 'html',
  //     //   handler: async (currentData, value, element) => {
  //     //     try {
  //     //       // 使用 $$eval 获取所有公司信息
  //     //       const companies = await element.$$eval('.company-item', items =>
  //     //         items.map(item => ({
  //     //           name: item.querySelector('.company-name')?.textContent?.trim() || '',
  //     //           industry: item.querySelector('.industry')?.textContent?.trim() || '',
  //     //           scale: item.querySelector('.scale')?.textContent?.trim() || '',
  //     //           jobs: Array.from(item.querySelectorAll('.job-item')).map(job => ({
  //     //             title: job.querySelector('.job-title')?.textContent?.trim() || '',
  //     //             salary: job.querySelector('.salary')?.textContent?.trim() || ''
  //     //           }))
  //     //         }))
  //     //       );

  //     //       console.log('Extracted companies:', { companyCount: companies.length });

  //     //       return companies;
  //     //     } catch (error) {
  //     //       console.error('Error extracting companies:', error);
  //     //       return [];
  //     //     }
  //     //   }
  //     // }
  //   },
  //   maxRequestsPerCrawl: 1,
  //   maxConcurrency: 1,
  //   timeout: 30000
  // },
  {
    url: 'https://www.liepin.com/zhaopin/?city=000&dq=000&key=',
    name: 'liepin',
    urlPattern: '^https://www\.liepin\.com/zhaopin/.*$',
    rules: {
      jobInfo: {
        selector: '.job-card-pc-container',
        type: 'html',
        handler: async (currentData, value, element) => {
          try {
            console.log('element，当前元素内容：');
            // 使用 $eval 获取子元素内容
            const title = await element.$eval('.job-title-box > .ellipsis-1', el => el.textContent?.trim() || '');
            const salary = await element.$eval('.job-salary', el => el.textContent?.trim() || '');
            const company = await element.$eval('.company-name', el => el.textContent?.trim() || '');
            const address = await element.$eval('.job-dq-box', el => el.textContent?.trim() || '');
            // 使用 $$eval 获取多个子元素
            let tags = await element.$$eval('.job-labels-box span', elements => 
              elements.map(el => el.textContent?.trim() || '')
            );

            const companyTags = await element.$$eval('.company-tags-box span', elements => 
              elements.map(el => el.textContent?.trim() || '')
            );

            tags = [...tags, ...companyTags];

            // 职位详情
            const jobDetail = await element.$eval('a', el => el.getAttribute('href') || '');

            console.log('Extracted job info:', { title, salary, company, address, tags, jobDetail });

            return {
              title,
              salary,
              company,
              address,
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
  },
  {
    url: 'https://m.zhipin.com/job_detail/?query=',
    name: 'zhipin',
    urlPattern: '^https://m\.zhipin\.com/job_detail/[^\.]+$',
    rules: {
      jobInfo: {
        selector: 'li.item',
        type: 'html',
        handler: async (currentData, value, element) => {
          console.log('element，begin：');
          const title = await element.$eval('.title-text', el => el.textContent?.trim() || '');
          const salary = await element.$eval('.salary', el => el.textContent?.trim() || '');
          const company = await element.$eval('.company', el => el.textContent?.trim() || '');
          const address = await element.$eval('.workplace', el => el.textContent?.trim() || '');
          
          const jobDetail = await element.$eval('a', el => {
            const href = el.getAttribute('href') || '';
            return href.startsWith('https://') ? href : `https://m.zhipin.com${href}`;
          });
          
          const tags = await element.$$eval('.labels span', elements => 
            elements.map(el => el.textContent?.trim() || '')
          );
          console.log('element，当前元素内容：', { title, salary, company, address, jobDetail, tags });
          return { title, salary, company, address, jobDetail, tags };
        }
      }
    }
  },
  {
    url: '',
    name: 'zhipin-detail',
    urlPattern: '^https://m\.zhipin\.com/job_detail/.*$',
    rules: {
      job: {
        selector: '.job-detail',
        type: 'html',
        handler: async (currentData, value, element) => {
          const jobDescription = await element.$eval('.job-sec > .text', el => el.textContent?.trim() || '');
          const companyDescription = await element.$eval('.job-sec > .detail-text', el => el.textContent?.trim() || '');
          return { jobDescription, companyDescription };         
        }
      }
    }
  },
  {
    url: '',
    name: 'liepin-detail',
    urlPattern: '^https://www.liepin.com/job/.*$',
    rules: {
      job: {
        selector: 'body',
        type: 'html',
        handler: async (currentData, value, element) => {
          const jobDescription = await element.$eval('.job-intro-container dd', el => el.textContent?.trim() || '');
          const companyDescription = await element.$eval('.company-intro-container .ellipsis-3', el => el.textContent?.trim() || '');
          return { jobDescription, companyDescription };         
        }
      }
    }
  },
  // {
  //   url: 'https://www.zhipin.com/web/geek/job?query=%E5%89%8D%E7%AB%AF%E5%BC%80%E5%8F%91%20%E5%8D%97%E4%BA%AC',
  //   name: 'zhipin',
  //   urlPattern: '^https://www\.zhipin\.com/.+$',
  //   rules: {
  //     jobInfo: {
  //       selector: '.job-card-wrapper',
  //       type: 'html',
  //       handler: async (currentData, value, element) => {
  //         console.log('element，begin：');
  //         const title = await element.$eval('.job-name', el => el.textContent?.trim() || '');
  //         const salary = await element.$eval('.salary', el => el.textContent?.trim() || '');
  //         const company = await element.$eval('.job-card-right .company-name', el => el.textContent?.trim() || '');
  //         const tags = await element.$$eval('.tag-list li', elements => 
  //           elements.map(el => el.textContent?.trim() || '')
  //         );
  //         const address = await element.$eval('.job-area', el => el.textContent?.trim() || '');
  //         const jobDetail = await element.$eval('.job-card-left', el => el.getAttribute('href') || '');
  //         const jobExperience = await element.$eval('.info-desc', el => el.textContent?.trim() || '');
  //         console.log('element，当前元素内容：', { title, salary, company, tags, address, jobDetail, jobExperience });
  //         return { title, salary, company, tags, address, jobDetail, jobExperience };
  //       }
  //     }
  //   }
  // }
  // {
  //   url: 'https://www.pulsemcp.com/servers',
  //   name: 'mcp',
  //   urlPattern: '^https://www\.pulsemcp\.com\/servers/.*$',
  //   rules: {
  //     mcp: {
  //       selector: 'div[data-test-id].h-full > a',
  //       type: 'html',
  //       handler: async (currentData, value, element) => {
  //         const title = await element.$eval('.text-pulse-purple', el => el.textContent?.trim() || '');
  //         const imageUrl = await element.$eval('img.w-5', el => el.getAttribute('src') || '');
  //         const detailUrl = await element.getAttribute('href') || '';
  //         const author = await element.$eval('.mt-1', el => el.textContent?.trim() || '');
  //         const description = await element.$eval('.mt-2', el => el.textContent?.trim() || '');
  //         // const tags = await element.$$eval('.rounded-full', elements => 
  //         //   elements.map(el => el.textContent?.trim() || '')
  //         // );
  //         const originUrl = await element.$eval('.items-center', el => el.getAttribute('href') || '');
  //         return { title, imageUrl, detailUrl, author, description, originUrl };
  //       }
  //     }
  //   }
  // }
];

