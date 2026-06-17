import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlerConfigs } from '../config/crawlerConfig';

test('urlPattern matches expected detail urls', () => {
  const patterns = crawlerConfigs
    .filter(c => c.urlPattern)
    .map(c => ({ name: c.name, re: new RegExp(c.urlPattern!) }));

  const match = (name: string, url: string) => {
    const p = patterns.find(x => x.name === name);
    assert.ok(p);
    assert.ok(p.re.test(url));
  };

  match('zhipin-detail', 'https://m.zhipin.com/job_detail/xxx.html');
  match('liepin-detail', 'https://www.liepin.com/job/12345678.shtml');
  match('lagou-detail', 'https://www.lagou.com/jobs/123456.html');
  match('zhaopin-detail', 'https://jobs.zhaopin.com/CC123456789J00000000000.htm');
  match('51job-detail', 'https://jobs.51job.com/shanghai/123456.html');
});

