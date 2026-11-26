const assert = require('node:assert/strict');
const test = require('node:test');
const { searchJobSources } = require('../dist/index');
const registry = require('../dist/platforms/registry');

test('search returns completed pages when a later page times out', async t => {
  const before = process.env.MCP_JOBS_TIMEOUT_MS;
  process.env.MCP_JOBS_TIMEOUT_MS = '1600';
  t.after(() => before === undefined ? delete process.env.MCP_JOBS_TIMEOUT_MS : process.env.MCP_JOBS_TIMEOUT_MS = before);
  const pages = [];
  t.mock.method(registry, 'platformApiSearch', async (source, params, signal) => {
    assert.equal(source, 'liepin');
    pages.push(params.page);
    if (params.page === 1) return { status: 'ok', jobs: [{ title: '开发', jobDetail: 'https://www.liepin.com/a/abc123.shtml?ref=fixture' }] };
    return new Promise(resolve => signal.addEventListener('abort', () => resolve(null), { once: true }));
  });
  const result = await searchJobSources({ keyword: '开发', platforms: ['liepin'], maxPages: 2 });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.jobs[0].jobDetail, 'https://www.liepin.com/a/abc123.shtml');
  assert.deepEqual(result.sources.map(source => [source.source, source.status, source.count, source.partial]), [['liepin', 'ok', 1, true]]);
});

test('restricted and empty sources report their actual status without fallback requests', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('unexpected fallback'); });
  t.mock.method(registry, 'platformApiSearch', async source => ({
    status: source === 'liepin' ? 'rate_limited' : 'empty', jobs: []
  }));
  const result = await searchJobSources({ keyword: '开发', platforms: ['liepin', 'zhaopin'] });
  assert.deepEqual(result.sources.map(source => [source.source, source.status]), [['liepin', 'rate_limited'], ['zhaopin', 'empty']]);
  assert.deepEqual(result.jobs, []);
});

test('Liepin city requests exclude out-of-city results from the same source', async t => {
  t.mock.method(registry, 'platformApiSearch', async () => ({
    status: 'ok', jobs: [
      { title: '开发', address: '上海浦东', jobDetail: 'https://www.liepin.com/job/1.shtml' },
      { title: '开发', address: '北京市朝阳区', jobDetail: 'https://www.liepin.com/job/2.shtml' },
      { title: '开发', jobDetail: 'https://www.liepin.com/job/3.shtml' }
    ]
  }));
  const result = await searchJobSources({ keyword: '开发', city: '北京市', platforms: ['liepin'] });
  assert.deepEqual(result.jobs.map(job => job.jobDetail), ['https://www.liepin.com/job/2.shtml']);
});
