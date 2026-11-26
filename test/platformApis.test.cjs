const assert = require('node:assert/strict');
const test = require('node:test');

const { harvestJobs } = require('../dist/platforms/harvest');
const { classifyLiepinError } = require('../dist/platforms/liepin');
const { platformApiSearch } = require('../dist/platforms/registry');

test('harvestJobs 走通 51job search-pc 嵌套包络', () => {
  const envelope = {
    status: '200',
    data: { data: { body: { jobList: [{
      jobName: 'Java开发工程师',
      jobHref: 'https://jobs.51job.com/all/200001.html',
      companyFullName: '示例科技（上海）有限公司',
      salaryDc: '1.5-2.5万·13薪',
      jobArea: '上海-浦东新区'
    }] } } }
  };
  const jobs = harvestJobs(envelope, '51job', 'https://we.51job.com');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Java开发工程师');
  assert.equal(jobs[0].jobDetail, 'https://jobs.51job.com/all/200001.html');
  assert.equal(jobs[0].company, '示例科技（上海）有限公司');
  assert.equal(jobs[0].salary, '1.5-2.5万·13薪');
  assert.equal(jobs[0].address, '上海-浦东新区');
});

test('harvestJobs 解析猎聘相对链接并落到官方域', () => {
  const envelope = {
    flag: 1,
    data: { datajob: { jobs: [{
      name: '前端开发工程师',
      link: '/a/abc123.shtml',
      compName: '某某网络',
      salary: '15-25万·14薪',
      city: '上海'
    }] } }
  };
  const jobs = harvestJobs(envelope, 'liepin', 'https://www.liepin.com');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].jobDetail, 'https://www.liepin.com/a/abc123.shtml');
  assert.equal(jobs[0].salary, '15-25万·14薪');
});

test('harvestJobs 用 encryptJobId 构造 BOSS 详情链接', () => {
  const envelope = {
    code: 0,
    zpData: { jobList: [{
      jobName: 'Golang 开发专家',
      brandName: '示例字节',
      salaryDesc: '30-60K·15薪',
      cityDistrict: '北京·海淀区',
      encryptJobId: 'AbCdEf01'
    }] }
  };
  const jobs = harvestJobs(envelope, 'zhipin', 'https://www.zhipin.com');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].jobDetail, 'https://www.zhipin.com/job_detail/AbCdEf01.html');
  assert.equal(jobs[0].company, '示例字节');
  assert.equal(jobs[0].salary, '30-60K·15薪');
});

test('harvestJobs 丢弃跨平台链接与无链接条目', () => {
  const items = [{
    name: 'A 职位',
    link: 'https://jobs.51job.com/all/1.html' // 猎聘通道里出现 51job 链接 → 丢弃
  }, {
    name: 'B 职位' // 没有链接也没有可用 id → 丢弃
  }];
  const jobs = harvestJobs({ data: { jobs: items } }, 'liepin', 'https://www.liepin.com');
  assert.equal(jobs.length, 0);
});

test('harvestJobs 按 jobDetail 去重', () => {
  const envelope = { data: { list: [
    { name: '同链接职位', link: 'https://www.liepin.com/a/dup.shtml' },
    { name: '同链接职位重复', link: 'https://www.liepin.com/a/dup.shtml' }
  ] } };
  const jobs = harvestJobs(envelope, 'liepin', 'https://www.liepin.com');
  assert.equal(jobs.length, 1);
});

test('classifyLiepinError 映射猎聘错误码', () => {
  assert.equal(classifyLiepinError('60001'), 'rate_limited');
  assert.equal(classifyLiepinError('20000'), 'login_required');
  assert.equal(classifyLiepinError('40001'), 'login_required');
  assert.equal(classifyLiepinError('-1400'), 'access_restricted');
  assert.equal(classifyLiepinError('unknown'), 'unavailable');
});

test('platformApiSearch 无关键词直接跳过', async () => {
  assert.equal(await platformApiSearch('51job', {}), null);
  assert.equal(await platformApiSearch('liepin', { keyword: '   ' }), null);
});
