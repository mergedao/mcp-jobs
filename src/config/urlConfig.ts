export const jobSearchUrls = [
  {
    url: 'https://m.zhipin.com/c100010000',
    name: 'zhipin',
    browserUrl: 'https://www.zhipin.com/',
  },
  {
    url: 'https://www.liepin.com/zhaopin/',
    name: 'liepin',
    browserUrl: 'https://www.liepin.com/',
  },
  {
    url: 'https://m.51job.com/',
    name: '51job',
    browserUrl: 'https://www.51job.com/',
    publicSample: true,
  },
  {
    url: 'https://sou.zhaopin.com/',
    name: 'zhaopin',
    browserUrl: 'https://www.zhaopin.com/',
  }
] as const;

export type JobPlatform = typeof jobSearchUrls[number]['name'];
