import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlerConfigs } from '../config/crawlerConfig';

test('urlBuilder builds expected search urls', () => {
  const lagou = crawlerConfigs.find(c => c.name === 'lagou');
  assert.ok(lagou);
  assert.equal(
    lagou.urlBuilder(lagou.url, { keyword: '前端 开发', page: 2 }, lagou.config || {}),
    'https://www.lagou.com/wn/jobs?fromSearch=true&kd=%E5%89%8D%E7%AB%AF%20%E5%BC%80%E5%8F%91&pn=2'
  );

  const zhaopin = crawlerConfigs.find(c => c.name === 'zhaopin');
  assert.ok(zhaopin);
  assert.equal(
    zhaopin.urlBuilder(zhaopin.url, { keyword: '后端', page: 1 }, zhaopin.config || {}),
    'https://sou.zhaopin.com/?p=1&kw=%E5%90%8E%E7%AB%AF'
  );

  const job51 = crawlerConfigs.find(c => c.name === '51job');
  assert.ok(job51);
  assert.equal(
    job51.urlBuilder(job51.url, { keyword: '测试', page: 3 }, job51.config || {}),
    'https://search.51job.com/list/000000,000000,0000,00,9,99,%E6%B5%8B%E8%AF%95,2,3.html'
  );
});

