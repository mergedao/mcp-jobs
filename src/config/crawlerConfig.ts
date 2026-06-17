import { ElementHandle } from 'playwright';

export interface CrawlerRule {
  selector: string;      // CSS 选择器
  attribute?: string;    // 要获取的属性（如 href, src 等）
  type: 'text' | 'attribute' | 'html';  // 获取类型
  handler?: (currentData: Record<string, any>, extractedValue: any, element: ElementHandle<Element>) => Promise<any>;  // 数据处理器
}

export interface BrowserConfig {
  headless?: boolean;    // 是否无头模式运行
  timeout?: number;      // 页面超时时间
  viewport?: {           // 视窗大小
    width: number;
    height: number;
  };
  userAgent?: string;    // 用户代理
}

export interface SiteConfig {
  url: string;           // 网站URL
  name: string;          // 网站名称
  urlPattern?: string;   // URL 匹配模式（支持正则表达式）
  urlBuilder: (url: string, params: Record<string, any>, paramsConfig: Record<string, any>) => string; // URL 构建器
  rules: {              // 数据提取规则
    [key: string]: CrawlerRule;
  };
  config?: {
    [key: string]: {
      name: string;
      description: string;
      type: string;
      default: string;
      rule?: Record<string, string>;
    };
  };
  maxRequestsPerCrawl?: number;
  maxConcurrency?: number;
  timeout?: number;
  browserConfig?: BrowserConfig;  // 浏览器配置
}

export const crawlerConfigs: SiteConfig[] = [
  {
    url: 'https://www.liepin.com/zhaopin/',
    name: 'liepin',
    urlPattern: '^https://www\.liepin\.com/zhaopin/.*$',
    urlBuilder: (url, params, paramsConfig) => {
      const { keyword, salary, workYear, page } = params;
      const { salaryCode, workYearCode } = paramsConfig;
      return url + `?city=000&dq=000&key=${encodeURIComponent(keyword)}&currentPage=${page}&salaryCode=${salaryCode.rule[salary] || ''}&workYearCode=${workYearCode.rule[workYear] || ''}`;
    },
    // 示例：为猎聘网站配置特定的浏览器设置
    browserConfig: {
      // 可以在这里覆盖全局设置
      // headless: false,  // 如果需要调试此特定网站，可以设置为 false
      // timeout: 45000,   // 如果此网站需要更长的加载时间
    },
    config: {
      salaryCode: {
        name: 'salaryCode',
        description: '薪资编码',
        type: 'string',
        default: '',
        rule: {
          '10万以下': '1',
          '10-15万': '2',
          '16-20万': '3',
          '21-30万': '4',
          '31-50万': '5',
          '51-100万': '6',
          '100万以上': '7'
        }
      },
      workYearCode: {
        name: 'workYearCode',
        description: '工作经验',
        type: 'string',
        default: '',
        rule: {
          '应届生': '1',
          '实习生': '2',
          '1年以下': '0$1',
          '1-3年': '1$3',
          '3-5年': '3$5',
          '5-10年': '5$10',
          '10年以上': '10$999'
        }
      }
    },
    rules: {
      jobInfo: {
        selector: '.job-card-pc-container',
        type: 'html',
        handler: async (currentData, value, element) => {
          try {
            // console.log('element，当前元素内容：');
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

            // console.log('Extracted job info:', { title, salary, company, address, tags, jobDetail });

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
    url: 'https://m.zhipin.com/c100010000',
    name: 'zhipin',
    urlPattern: '^https://m\.zhipin\.com/c100010000/[^\.]+$',
    urlBuilder: (url, params, paramsConfig) => {
      const { salary, workYear, keyword, page } = params;
      const { salaryCode, workYearCode } = paramsConfig;
      return url + `/${workYearCode.rule[workYear] || ''}?ka=${salaryCode.rule[salary] || ''}&page=${page}&query=${encodeURIComponent(keyword)}`;
    },
    config: {
      salaryCode: {
        name: 'ka',
        description: '薪资编码',
        type: 'string',
        default: '',
        rule: {
          '10万以下': 'sel-salary-1',
          '10-15万': 'sel-salary-2',
          '16-20万': 'sel-salary-3',
          '21-30万': 'sel-salary-4',
          '31-50万': 'sel-salary-5',
          '51-100万': 'sel-salary-6',
          '100万以上': 'sel-salary-7'
        }
      },
      workYearCode: {
        name: 'exp',
        description: '工作经验',
        type: 'string',
        default: '',
        rule: {
          '应届生': 'e_102',
          '实习生': 'e_108',
          '1年以下': 'e_103',
          '1-3年': 'e_104',
          '3-5年': 'e_105',
          '5-10年': 'e_106',
          '10年以上': 'e_107'
        }
      }
    },
    rules: {
      jobInfo: {
        selector: 'li.item',
        type: 'html',
        handler: async (currentData, value, element) => {
          // console.log('element，begin：');
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
          // console.log('element，当前元素内容：', { title, salary, company, address, jobDetail, tags });
          return { title, salary, company, address, jobDetail, tags };
        }
      }
    }
  },
  {
    url: '',
    name: 'zhipin-detail',
    urlPattern: '^https://m\.zhipin\.com/job_detail/.*$',
    urlBuilder: (url, params, paramsConfig) => {
      return url;
    },
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
    urlBuilder: (url, params, paramsConfig) => {
      return url;
    },
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
  {
    url: 'https://www.lagou.com/',
    name: 'lagou',
    urlPattern: '^https://www\\.lagou\\.com/wn/jobs.*$',
    urlBuilder: (url, params, paramsConfig) => {
      const { keyword, page } = params;
      const targetPage = page || 1;
      return 'https://www.lagou.com/wn/jobs' + `?fromSearch=true&kd=${encodeURIComponent(keyword || '')}&pn=${targetPage}`;
    },
    rules: {
      jobInfo: {
        selector: 'div[class*="job-list"] li, ul[class*="list"] li, div[class*="position"]',
        type: 'html',
        handler: async (currentData, value, element) => {
          const getText = async (selectors: string[]) => {
            for (const selector of selectors) {
              try {
                const v = await element.$eval(selector, el => el.textContent?.trim() || '');
                if (v) return v;
              } catch {}
            }
            return '';
          };

          const getHref = async (selectors: string[]) => {
            for (const selector of selectors) {
              try {
                const v = await element.$eval(selector, el => (el as HTMLAnchorElement).href || el.getAttribute('href') || '');
                if (v) return v.startsWith('http') ? v : `https://www.lagou.com${v}`;
              } catch {}
            }
            try {
              const v = (await element.getAttribute('href')) || '';
              if (v) return v.startsWith('http') ? v : `https://www.lagou.com${v}`;
            } catch {}
            return '';
          };

          const title = await getText(['.position__title', '.position-name', '.job-name', 'h3', 'h2']);
          const salary = await getText(['.position__salary', '.salary', '.money', '[class*="salary"]']);
          const company = await getText(['.company__name', '.company-name', '.company', '[class*="company"]']);
          const address = await getText(['.position__address', '.city', '.workplace', '[class*="address"]']);
          const publishTime = await getText(['.time', '.create-time', '[class*="time"]']);
          const education = await getText(['.education', '[class*="edu"]']);
          const experience = await getText(['.experience', '[class*="exp"]']);
          const industry = await getText(['.industry', '[class*="industry"]']);
          const companySize = await getText(['.scale', '[class*="scale"]', '[class*="size"]']);
          const financeStage = await getText(['.finance', '[class*="finance"]']);

          let tags: string[] = [];
          try {
            tags = await element.$$eval('.tag, .tags span, [class*="tag"]', elements =>
              elements.map(el => el.textContent?.trim() || '').filter(Boolean)
            );
          } catch {}

          const jobDetail = await getHref(['a[href*="/jobs/"][href$=".html"]', 'a[href*="/jobs/"]', 'a[href]']);
          if (!title && !company && !jobDetail) {
            return null;
          }

          return { title, salary, company, address, tags, jobDetail, publishTime, education, experience, industry, companySize, financeStage };
        }
      }
    }
  },
  {
    url: '',
    name: 'lagou-detail',
    urlPattern: '^https://www\\.lagou\\.com/jobs/\\d+\\.html.*$',
    urlBuilder: (url, params, paramsConfig) => {
      return url;
    },
    rules: {
      job: {
        selector: 'body',
        type: 'html',
        handler: async (currentData, value, element) => {
          const getText = async (selectors: string[]) => {
            for (const selector of selectors) {
              try {
                const v = await element.$eval(selector, el => el.textContent?.trim() || '');
                if (v) return v;
              } catch {}
            }
            return '';
          };

          const jobDescription = await getText(['.job-detail', '.job-detail__content', '.job_bt', '[class*="job"] [class*="desc"]']);
          const companyDescription = await getText(['.company-intro', '.company_desc', '[class*="company"] [class*="intro"]']);
          const publishTime = await getText(['.publish_time', '.create-time', '[class*="time"]']);
          const education = await getText(['.education', '[class*="edu"]']);
          const experience = await getText(['.experience', '[class*="exp"]']);
          const industry = await getText(['.industry', '[class*="industry"]']);
          const companySize = await getText(['.scale', '[class*="scale"]', '[class*="size"]']);
          const financeStage = await getText(['.finance', '[class*="finance"]']);

          return { jobDescription, companyDescription, publishTime, education, experience, industry, companySize, financeStage };
        }
      }
    }
  },
  {
    url: 'https://www.zhaopin.com/',
    name: 'zhaopin',
    urlPattern: '^https://sou\\.zhaopin\\.com/.*$',
    urlBuilder: (url, params, paramsConfig) => {
      const { keyword, page } = params;
      const targetPage = page || 1;
      return 'https://sou.zhaopin.com/' + `?p=${targetPage}&kw=${encodeURIComponent(keyword || '')}`;
    },
    rules: {
      jobInfo: {
        selector: 'div[class*="joblist"] div, div[class*="JobList"] div',
        type: 'html',
        handler: async (currentData, value, element) => {
          const getText = async (selectors: string[]) => {
            for (const selector of selectors) {
              try {
                const v = await element.$eval(selector, el => el.textContent?.trim() || '');
                if (v) return v;
              } catch {}
            }
            return '';
          };

          const getHref = async (selectors: string[]) => {
            for (const selector of selectors) {
              try {
                const v = await element.$eval(selector, el => (el as HTMLAnchorElement).href || el.getAttribute('href') || '');
                if (v) return v.startsWith('http') ? v : `https:${v}`;
              } catch {}
            }
            return '';
          };

          const jobDetail = await getHref(['a[href*="jobs.zhaopin.com"]', 'a[href*="jobdetail"]', 'a[href]']);
          if (!jobDetail) {
            return null;
          }

          const title = await getText(['a[href*="jobs.zhaopin.com"]', 'a[href*="jobdetail"]', '[class*="title"]', 'h3']);
          const salary = await getText(['[class*="salary"]', '.salary']);
          const company = await getText(['[class*="company"]', '.companyName', '.company']);
          const address = await getText(['[class*="city"]', '[class*="address"]']);
          const publishTime = await getText(['[class*="time"]', '[class*="date"]']);
          const education = await getText(['[class*="edu"]', '[class*="degree"]']);
          const experience = await getText(['[class*="exp"]']);
          const industry = await getText(['[class*="industry"]']);
          const companySize = await getText(['[class*="scale"]', '[class*="size"]']);
          const financeStage = await getText(['[class*="finance"]']);

          let tags: string[] = [];
          try {
            tags = await element.$$eval('span, li', elements =>
              elements.map(el => el.textContent?.trim() || '').filter(Boolean)
            );
          } catch {}

          return { title, salary, company, address, tags, jobDetail, publishTime, education, experience, industry, companySize, financeStage };
        }
      }
    }
  },
  {
    url: '',
    name: 'zhaopin-detail',
    urlPattern: '^https://jobs\\.zhaopin\\.com/.*$',
    urlBuilder: (url, params, paramsConfig) => {
      return url;
    },
    rules: {
      job: {
        selector: 'body',
        type: 'html',
        handler: async (currentData, value, element) => {
          const getText = async (selectors: string[]) => {
            for (const selector of selectors) {
              try {
                const v = await element.$eval(selector, el => el.textContent?.trim() || '');
                if (v) return v;
              } catch {}
            }
            return '';
          };

          const jobDescription = await getText(['[class*="jobDescription"]', '[class*="job-detail"]', '[class*="detail"]']);
          const companyDescription = await getText(['[class*="company"] [class*="intro"]', '[class*="companyDescription"]']);
          const publishTime = await getText(['[class*="time"]', '[class*="date"]']);
          const education = await getText(['[class*="edu"]', '[class*="degree"]']);
          const experience = await getText(['[class*="exp"]']);
          const industry = await getText(['[class*="industry"]']);
          const companySize = await getText(['[class*="scale"]', '[class*="size"]']);
          const financeStage = await getText(['[class*="finance"]']);

          return { jobDescription, companyDescription, publishTime, education, experience, industry, companySize, financeStage };
        }
      }
    }
  },
  {
    url: 'https://www.51job.com/',
    name: '51job',
    urlPattern: '^https://search\\.51job\\.com/list/.*$',
    urlBuilder: (url, params, paramsConfig) => {
      const { keyword, page } = params;
      const targetPage = page || 1;
      return 'https://search.51job.com/list/000000,000000,0000,00,9,99,' + `${encodeURIComponent(keyword || '')},2,${targetPage}.html`;
    },
    rules: {
      jobInfo: {
        selector: '#resultList .el, .j_joblist .e, div[class*="joblist"] a',
        type: 'html',
        handler: async (currentData, value, element) => {
          const getText = async (selectors: string[]) => {
            for (const selector of selectors) {
              try {
                const v = await element.$eval(selector, el => el.textContent?.trim() || '');
                if (v) return v;
              } catch {}
            }
            return '';
          };

          const getHref = async (selectors: string[]) => {
            for (const selector of selectors) {
              try {
                const v = await element.$eval(selector, el => (el as HTMLAnchorElement).href || el.getAttribute('href') || '');
                if (v) return v.startsWith('http') ? v : `https:${v}`;
              } catch {}
            }
            return '';
          };

          const jobDetail = await getHref(['a[href*="jobs.51job.com"]', 'a[href$=".html"]', 'a[href]']);
          if (!jobDetail) {
            return null;
          }

          const title = await getText(['a[href*="jobs.51job.com"]', 'a[href$=".html"]', '.t1 a', '.jname']);
          const salary = await getText(['.t4', '.sal', '[class*="salary"]']);
          const company = await getText(['.t2 a', '.cname', '[class*="company"]']);
          const address = await getText(['.t3', '.d', '[class*="city"]']);
          const publishTime = await getText(['.t5', '.time', '[class*="time"]']);
          const education = await getText(['.edu', '[class*="edu"]']);
          const experience = await getText(['.exp', '[class*="exp"]']);
          const industry = await getText(['.industry', '[class*="industry"]']);
          const companySize = await getText(['.size', '[class*="scale"]', '[class*="size"]']);
          const financeStage = await getText(['.finance', '[class*="finance"]']);

          let tags: string[] = [];
          try {
            tags = await element.$$eval('span, em, i', elements =>
              elements.map(el => el.textContent?.trim() || '').filter(Boolean)
            );
          } catch {}

          return { title, salary, company, address, tags, jobDetail, publishTime, education, experience, industry, companySize, financeStage };
        }
      }
    }
  },
  {
    url: '',
    name: '51job-detail',
    urlPattern: '^https://jobs\\.51job\\.com/.*\\.html.*$',
    urlBuilder: (url, params, paramsConfig) => {
      return url;
    },
    rules: {
      job: {
        selector: 'body',
        type: 'html',
        handler: async (currentData, value, element) => {
          const getText = async (selectors: string[]) => {
            for (const selector of selectors) {
              try {
                const v = await element.$eval(selector, el => el.textContent?.trim() || '');
                if (v) return v;
              } catch {}
            }
            return '';
          };

          const jobDescription = await getText(['.bmsg.job_msg.inbox', '#job_detail', '[class*="job"] [class*="msg"]']);
          const companyDescription = await getText(['.tmsg.inbox', '[class*="company"] [class*="intro"]']);
          const publishTime = await getText(['.msg.ltype', '[class*="time"]']);
          const education = await getText(['.edu', '[class*="edu"]']);
          const experience = await getText(['.exp', '[class*="exp"]']);
          const industry = await getText(['.industry', '[class*="industry"]']);
          const companySize = await getText(['.type', '[class*="scale"]', '[class*="size"]']);
          const financeStage = await getText(['.finance', '[class*="finance"]']);

          return { jobDescription, companyDescription, publishTime, education, experience, industry, companySize, financeStage };
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
