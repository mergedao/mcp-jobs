import { load } from 'cheerio';
import type { SiteConfig, CrawlerRule } from './crawlerConfig';

function publicCards(selector: string, fields: Record<string, string>) {
  return {
    rules: {
      jobInfo: { selector, type: 'attribute' as const, attribute: 'href' }
    },
    parsePublicHtml: (html: string) => {
      const $ = load(html);
      return {
        jobInfo: $(selector).toArray().map(element => {
          const item = $(element);
          const link = item.is('a[href]') ? item : item.find('a[href]').first();
          const card = item.closest('.e');
          const fieldsRoot = card.length ? card : item;
          const job: Record<string, string> = { jobDetail: link.attr('href') ?? '' };
          for (const [name, css] of Object.entries(fields)) job[name] = fieldsRoot.find(css).first().text().trim();
          if (job.address) job.address = job.address.split('|')[0].trim();
          job.title ||= link.attr('title')?.trim() || link.text().trim();
          return job;
        })
      };
    }
  };
}

function details(selector: string): Record<string, CrawlerRule> {
  return {
    job: {
      selector,
      type: 'text',
      handler: async (_data, _value, section) => section.evaluate(element => ({
        jobDescription: element.textContent?.trim() ?? '',
        title: document.querySelector('h1')?.textContent?.trim() ?? ''
      }))
    }
  };
}

const keepUrl = (url: string) => url;

export const publicPageConfigs: SiteConfig[] = [
  {
    name: 'liepin-public', url: '',
    urlPattern: '^https://(?:www|m)\\.liepin\\.com/city-[a-z0-9]+/(?:zp[a-z0-9]+/)?(?:\\?.*)?$',
    urlBuilder: keepUrl,
    ...publicCards('.seo-jobcard2-common, a.job-card', {
      title: '.jobcard2-title, .job-card-title, .job-title',
      company: '.jobcard2-company-title, .job-card-company',
      salary: '.jobcard2-salary, .job-card-salary',
      address: '.jobcard2-location, .job-card-labels > :first-child'
    })
  },
  {
    name: '51job-public', url: 'https://m.51job.com/',
    urlPattern: '^https://(?:m|kaifa|mkaifa)\\.51job\\.com/(?:[a-z0-9-]+/){0,2}(?:\\?.*)?$',
    urlBuilder: keepUrl,
    ...publicCards('a.el[href], a.e[href*="/jobs/"], a.item[href*="/jobs/"]', {
      title: '.jname, .jobname, .name, .top .title',
      company: '.cname, .c, .company',
      salary: '.sal, .salary, .money',
      address: '.area, .location, .info .d, .tabs span:first-child'
    })
  },
  {
    name: 'zhaopin-public', url: 'https://sou.zhaopin.com/',
    urlPattern: '^https://www\\.zhaopin\\.com/zhaopin/[0-9a-f]+/(?:\\?.*)?$',
    urlBuilder: (url, params) => {
      if (new URL(url).hostname !== 'sou.zhaopin.com') return url;
      const target = new URL(url);
      target.searchParams.set('kw', String(params.keyword ?? ''));
      target.searchParams.set('p', String(params.page ?? 1));
      return target.href;
    },
    ...publicCards('a[href*="/jobdetail/"], a[href*="/jobs/CC"]', {
      title: '.jobname, .job-name, .jobinfo__name',
      company: '.company-name, .companyinfo__name',
      salary: '.salary, .jobinfo__salary',
      address: '.location, .jobinfo__location'
    })
  },
  {
    name: 'zhipin-public', url: '',
    urlPattern: '^https://(?:www|m)\\.zhipin\\.com/zhaopin/[A-Za-z0-9_~-]+/(?:\\?.*)?$',
    urlBuilder: keepUrl,
    ...publicCards('li.item, .job-card-wrapper, a[href*="/job_detail/"]', {
      title: '.title-text, .job-name, .job-title',
      company: '.company, .company-name',
      salary: '.salary',
      address: '.workplace, .job-area'
    })
  },
];

export const additionalDetailConfigs: SiteConfig[] = [
  {
    name: '51job-detail', url: '',
    urlPattern: '^https://(?:jobs|msearch)\\.51job\\.com/(?:jobs/)?[a-z0-9-]+/\\d+\\.html(?:\\?.*)?$',
    urlBuilder: keepUrl,
    rules: details('.bmsg.job_msg, .job-described, .job_description, .job-desc')
  },
  {
    name: 'zhaopin-detail', url: '',
    urlPattern: '^https://(?:www\\.zhaopin\\.com/jobdetail|m\\.zhaopin\\.com/jobs)/[A-Z0-9]+\\.htm(?:\\?.*)?$',
    urlBuilder: keepUrl,
    rules: details('.describtion__detail-content, .job-desc, .job-detail__content, [itemprop="description"]')
  }
];
