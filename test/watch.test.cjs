const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const search = require('../dist/index');
const { acknowledgeWatch, watchCheck, resetWatch } = require('../dist/core/watch');

test('watch only advances a source on successful scans, and expires pending jobs before confirmation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-jobs-watch-'));
  const profile = process.env.MCP_JOBS_PROFILE_DIR;
  process.env.MCP_JOBS_PROFILE_DIR = join(root, 'profile');
  t.after(async () => {
    if (profile === undefined) delete process.env.MCP_JOBS_PROFILE_DIR;
    else process.env.MCP_JOBS_PROFILE_DIR = profile;
    await rm(root, { force: true, recursive: true });
  });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-01T01:00:00Z') });
  const platforms = ['51job', 'liepin'];
  const args = { keyword: '开发', platforms };
  let snapshots = {};
  t.mock.method(search, 'searchJobSources', async (request, signal) => {
    assert.deepEqual(request.platforms, platforms);
    const sources = platforms.map(source => ({
      source, coverage: snapshots[source]?.coverage ?? 'search', status: snapshots[source]?.status ?? 'unavailable', count: snapshots[source]?.ids?.length ?? 0
    }));
    const jobs = sources.flatMap(({ source }) => (snapshots[source]?.ids ?? []).map(id => ({
      source, jobDetail: source === '51job'
        ? 'https://jobs.51job.com/beijing/' + id + '.html'
        : 'https://www.liepin.com/job/' + id + '.shtml'
    })));
    return { sources, jobs };
  });
  const list = (...ids) => ({ status: ids.length ? 'ok' : 'empty', ids });
  assert.equal((await watchCheck(args)).baseline, false);
  snapshots = { '51job': list() };
  assert.equal((await watchCheck(args)).baseline, true);
  snapshots = { '51job': list(123), liepin: list(456) };
  assert.equal((await watchCheck(args)).newCount, 0);
  snapshots = { '51job': { ...list(), coverage: 'public_page' }, liepin: list(456) };
  assert.equal((await watchCheck(args)).newCount, 0);
  snapshots = { liepin: list(456) };
  assert.equal((await watchCheck(args)).newCount, 0);
  snapshots = { '51job': list(123), liepin: list(456) };
  const notified = await watchCheck(args);
  assert.equal(notified.newCount, 1);
  assert.deepEqual((await watchCheck(args)).newJobs, notified.newJobs);
  assert.equal(acknowledgeWatch(notified.watchId, notified.nextCursor).acknowledged, true);
  assert.equal((await watchCheck(args)).newCount, 0);

  snapshots = { '51job': list(789) };
  assert.equal((await watchCheck(args)).newCount, 0);
  snapshots = { '51job': list() };
  await watchCheck(args);
  snapshots = { '51job': list(789) };
  assert.equal((await watchCheck(args)).newCount, 0);
  t.mock.timers.tick(14 * 24 * 60 * 60 * 1000);
  assert.equal((await watchCheck(args)).newCount, 0);
  snapshots = { '51job': list(789, 900) };
  const cancelled = await watchCheck(args, AbortSignal.abort());
  assert.equal(cancelled.newCount, 0);
  assert.equal((await watchCheck(args)).newCount, 1);
  const id = resetWatch(args.keyword, args.city, ['liepin', '51job', '51job']);
  const reset = await watchCheck(args);
  assert.equal(reset.watchId, id);
  assert.equal(reset.baseline, true);
  assert.equal(reset.newCount, 0);
});

test('concurrent MCP processes share one unacknowledged job notice and retain it after exit', { timeout: 25000 }, async t => {
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const run = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), 'mcp-jobs-watch-concurrent-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = `
    const search = require('./dist/index');
    const ids = JSON.parse(process.argv[1]);
    search.searchJobSources = async () => ({
      sources: [{ source: 'liepin', status: 'ok', coverage: 'search' }],
      jobs: ids.map(id => ({ source: 'liepin', jobDetail: 'https://www.liepin.com/job/' + id + '.shtml' }))
    });
    const { watchCheck, acknowledgeWatch } = require('./dist/core/watch');
    const run = process.argv[2]
      ? Promise.resolve(acknowledgeWatch(process.argv[2], Number(process.argv[3])))
      : watchCheck({ keyword: '开发', platforms: ['liepin'] });
    run.then(result => console.log(JSON.stringify(result)));
  `;
  const call = async (ids, ...ack) => {
    const { stdout } = await run(process.execPath, ['-e', script, JSON.stringify(ids), ...ack], {
      cwd: join(__dirname, '..'),
      env: { ...process.env, MCP_JOBS_PROFILE_DIR: join(dir, 'profile') }
    });
    return JSON.parse(stdout);
  };
  await call([10]);
  await call([10, 11]);
  const both = await Promise.all([call([10, 11]), call([10, 11])]);
  assert.equal(both[0].newCount, 1);
  assert.equal(both[1].newCount, 1);
  assert.equal(both[0].nextCursor, both[1].nextCursor);
  assert.deepEqual((await call([10, 11])).newJobs, both[0].newJobs);
  await call([], both[0].watchId, String(both[0].nextCursor));
  assert.equal((await call([10, 11])).newCount, 0);
});
