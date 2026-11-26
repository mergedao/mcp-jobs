const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const cdp = require('../dist/core/cdp');
const { recordLogin, snapshotProfile } = require('../dist/core/profileState');

test('local cookie observations are scoped, expiring and separate from user confirmation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-jobs-login-evidence-'));
  const previousProfile = process.env.MCP_JOBS_PROFILE_DIR;
  const previousAlternate = process.env.BOSS_CDP_URL;
  process.env.MCP_JOBS_PROFILE_DIR = join(dir, 'profile');
  delete process.env.BOSS_CDP_URL;
  t.after(async () => {
    if (previousProfile === undefined) delete process.env.MCP_JOBS_PROFILE_DIR;
    else process.env.MCP_JOBS_PROFILE_DIR = previousProfile;
    if (previousAlternate === undefined) delete process.env.BOSS_CDP_URL;
    else process.env.BOSS_CDP_URL = previousAlternate;
    await rm(dir, { recursive: true, force: true });
  });
  const file = join(dir, 'profile-state.json');
  await writeFile(file, JSON.stringify({ lastVerifiedAt: { liepin: '2026-01-01T00:00:00.000Z' } }));
  const now = new Date('2026-11-26T10:00:00.000Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  let reachable = true;
  let attempts = 0;
  let cookies = [
    { name: 'wt2', domain: 'example.com', value: 'wrong-domain' },
    { name: 'wt2', domain: 'www.zhipin.com', value: 'synthetic-boss', expires: -1 },
    { name: 'liepin_login_valid', domain: 'www.liepin.com', value: 'expired', expires: now.getTime() / 1000 - 1 }
  ];
  t.mock.method(cdp, 'portOpen', async () => reachable);
  t.mock.method(cdp, 'rawBrowserSession', async () => ({}));
  t.mock.method(cdp, 'rawSend', async (_session, method) => {
    assert.equal(method, 'Storage.getCookies');
    attempts++;
    return { cookies };
  });
  const platform = (snapshot, id) => snapshot.platforms.find(item => item.platform === id);
  recordLogin('liepin');
  const first = await snapshotProfile();
  assert.equal(attempts, 1);
  assert.equal(platform(first, 'zhipin').sessionEvidence, 'credential_present');
  assert.equal(platform(first, 'zhipin').loggedIn, 'unknown');
  assert.equal(platform(first, 'zhipin').lastVerifiedAt, now.toISOString());
  assert.equal(platform(first, 'liepin').sessionEvidence, 'credential_missing');
  assert.equal(platform(first, 'liepin').lastVerifiedAt, undefined);
  assert.equal(platform(first, 'liepin').lastLoginAt, now.toISOString());

  t.mock.timers.tick(1000);
  cookies = [
    { name: 'wt2', domain: 'zhipin.com.example.com', value: 'wrong-domain' },
    { name: 'liepin_login_valid', domain: '.liepin.com', value: 'synthetic-liepin', expires: now.getTime() / 1000 + 60 }
  ];
  const later = await snapshotProfile();
  assert.equal(platform(later, 'liepin').sessionEvidence, 'credential_present');
  assert.equal(platform(later, 'liepin').loggedIn, 'unknown');
  assert.equal(platform(later, 'liepin').lastVerifiedAt, '2026-11-26T10:00:01.000Z');
  assert.equal(platform(later, 'liepin').cookieExpiresAt, '2026-11-26T10:01:00.000Z');
  assert.equal(platform(later, 'zhipin').sessionEvidence, 'credential_missing');
  assert.equal(platform(later, 'zhipin').lastVerifiedAt, now.toISOString());

  reachable = false;
  const offline = await snapshotProfile();
  assert.equal(platform(offline, 'liepin').sessionEvidence, 'unavailable');
  assert.equal(platform(offline, 'liepin').lastVerifiedAt, platform(later, 'liepin').lastVerifiedAt);
  assert.doesNotMatch(await readFile(file, 'utf8'), /synthetic-boss|synthetic-liepin|wrong-domain/);
});
