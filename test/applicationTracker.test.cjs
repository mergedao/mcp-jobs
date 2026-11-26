const assert = require('node:assert/strict');
const { mkdtemp, rm, readdir, readFile, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

test('the four platforms hand off to the original site and replay unacknowledged replies across restarts', { timeout: 20000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-jobs-application-test-'));
  const clients = new Set();
  const profileDir = path.join(dir, 'profile');
  const connect = async (monitorOnly = false) => {
    const client = new Client({ name: 'local-application-fixture', version: '1' });
    clients.add(client);
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['-e', `
        globalThis.fetch = async () => { throw new Error('network I/O is out of scope'); };
        require('./dist/mcp');
      `],
      cwd: path.join(__dirname, '..'),
      env: {
        MCP_JOBS_PROFILE_DIR: profileDir,
        MCP_JOBS_CDP_PORT: '0',
        MCP_JOBS_MONITOR_ONLY: monitorOnly ? '1' : '0',
        MCP_JOBS_PROFILE_POLL_MS: '0',
        MCP_JOBS_DISABLE_PLATFORM_APIS: '1'
      },
      stderr: 'pipe'
    }));
    return client;
  };
  const call = async (client, name, arguments_, failure = false) => {
    const reply = await client.callTool({ name, arguments: arguments_ });
    assert.equal(Boolean(reply.isError), failure, reply.content[0].text);
    return reply.content[0].text.startsWith('{') ? JSON.parse(reply.content[0].text) : reply.content[0].text;
  };
  try {
    const first = await connect();
    const login = await call(first, 'mcp_platform_login', { platform: '51job' });
    assert.equal(login.status, 'manual_required');
    assert.equal(login.browserUrl, 'https://www.51job.com/');
    assert.equal((await call(first, 'mcp_login_confirmed', { platform: 'liepin' })).status, 'user_reported');
    const state = await call(first, 'mcp_profile_status', {});
    assert.equal(state.platforms.find(item => item.platform === 'liepin').loggedIn, 'unknown');
    const second = await connect();
    const { tools } = await first.listTools();
    assert.ok(!tools.some(tool => tool.name === 'mcp_apply_confirm'));
    const applySchema = tools.find(tool => tool.name === 'mcp_apply_job').inputSchema;
    assert.ok(applySchema.required.includes('accountId'));
    const manualPlatforms = [
      { platform: 'zhipin', url: 'https://www.zhipin.com/job_detail/Example123.html' },
      { platform: 'zhaopin', url: 'https://www.zhaopin.com/jobdetail/CC123.htm' }
    ];
    for (const target of manualPlatforms) {
      const platformScope = { platform: target.platform, accountId: 'personal' };
      const handoff = await call(first, 'mcp_apply_job', { ...platformScope, url: target.url });
      assert.equal(handoff.status, 'manual_required');
      assert.equal(handoff.browserUrl, target.url);
      const initial = await call(first, 'mcp_check_feedback', platformScope);
      assert.equal(initial.status, 'not_synced');
      await call(first, 'mcp_feedback_import', { ...platformScope, syncStatus: 'ok', events: [
        { type: 'reply', conversationId: 'chat', messageId: 'reply', occurredAt: '2026-11-25T09:00:00Z' }
      ] });
      const feedback = await call(first, 'mcp_check_feedback', platformScope);
      assert.equal(feedback.status, 'updates_available');
      assert.equal(feedback.source, 'user_reported');
      assert.equal(feedback.events[0].messageId, 'reply');
    }
    await call(first, 'mcp_apply_confirm', { actionId: 'old-preview' }, true);
    const scope = { platform: '51job', accountId: 'personal' };
    const spec = { ...scope, url: 'https://jobs.51job.com/beijing/123456.html?ref=a', title: '开发工程师', resumeVersion: 'v1' };
    const otherUrl = 'https://msearch.51job.com/jobs/shanghai/123456.html?ref=b';
    const staging = await Promise.all([
      call(first, 'mcp_apply_job', spec),
      call(second, 'mcp_apply_job', { ...spec, url: otherUrl })
    ]);
    assert.deepEqual(staging.map(x => x.status).sort(), ['already_tracked', 'manual_required']);
    assert.ok(staging.every(result => result.actionId === undefined));
    assert.equal(staging[0].application.jobId, staging[1].application.jobId);
    assert.equal(staging[0].application.resumeVersion, 'v1');
    assert.match(await call(first, 'mcp_apply_job', { ...spec, url: 'https://www.liepin.com/job/123456.shtml' }, true), /平台不匹配/);

    const submitted = { type: 'application', url: otherUrl, status: 'submitted', observedAt: '2026-11-25T09:00:00+08:00', receiptReference: 'receipt-1' };
    const chat = { type: 'reply', conversationId: 'conversation-1', messageId: 'reply-1', occurredAt: '2026-11-25T10:00:00+08:00', company: '示例公司', body: '私信正文应被忽略' };
    const stale = { ...submitted, status: 'unknown', observedAt: '2026-11-25T08:00:00+08:00' };
    const added = await call(first, 'mcp_feedback_import', { ...scope, syncStatus: 'ok', events: [submitted, chat] });
    assert.equal(added.recorded, 2);
    const repeated = await call(second, 'mcp_feedback_import', { ...scope, events: [chat, stale] });
    assert.equal(repeated.recorded, 0);
    assert.equal(repeated.duplicates, 2);
    await call(first, 'mcp_feedback_import', {
      ...scope, events: [{ ...submitted, status: 'unknown', observedAt: '2026-11-25T11:00:00+08:00' }]
    });
    const check = await call(first, 'mcp_check_feedback', scope);
    assert.deepEqual(check.events.map(e => e.type), ['application', 'reply']);
    assert.equal(check.events[0].application.source, 'user_reported');
    assert.equal(check.events[0].application.resumeVersion, 'v1');
    assert.equal(check.events[1].body, undefined);
    assert.match(check.events[1].notificationId, /^\d+:\d+$/);

    // A new observation may land between reading and acknowledging the previous page.
    await call(second, 'mcp_feedback_import', { ...scope, syncStatus: 'session_expired' });
    const ack = await call(first, 'mcp_feedback_ack', { ...scope, cursor: check.cursor, through: check.nextCursor });
    assert.equal(ack.cursor, check.nextCursor);
    await first.close();
    clients.delete(first);
    const restarted = await connect(true);
    const monitorTools = (await restarted.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(monitorTools, ['mcp_application_list', 'mcp_check_feedback', 'mcp_feedback_ack', 'mcp_profile_status', 'mcp_watch_ack', 'mcp_watch_check']);
    await call(restarted, 'mcp_feedback_import', { ...scope, events: [chat] }, true);
    await call(restarted, 'mcp_apply_job', spec, true);
    const after = await call(restarted, 'mcp_check_feedback', scope);
    assert.equal(after.sync.status, 'session_expired');
    const otherConsumer = await call(restarted, 'mcp_check_feedback', { ...scope, consumer: 'other-task' });
    assert.equal(otherConsumer.events.length, 2);
    assert.equal(otherConsumer.events[1].notificationId, check.events[1].notificationId);
    assert.equal(after.status, 'session_expired');
    assert.equal(after.events.length, 0);
    await call(restarted, 'mcp_feedback_ack', { ...scope, cursor: after.cursor, through: after.nextCursor });
    const settled = await call(restarted, 'mcp_check_feedback', scope);
    assert.equal(settled.nextCursor, settled.cursor);
    const list = await call(restarted, 'mcp_application_list', scope);
    assert.equal(list.applications.length, 1);
    assert.equal(list.applications[0].status, 'submitted');
    assert.equal(list.applications[0].receiptReference, 'receipt-1');
    assert.equal(list.applications[0].needsVerificationAt, '2026-11-25T03:00:00.000Z');

    const foreground = await connect();
    const personalLiepin = { platform: 'liepin', accountId: 'personal' };
    assert.deepEqual((await call(restarted, 'mcp_application_list', personalLiepin)).applications, []);
    assert.deepEqual((await call(restarted, 'mcp_application_list', { ...scope, accountId: 'another' })).applications, []);
    const hashJob = await call(foreground, 'mcp_apply_job', { ...personalLiepin, url: 'https://www.liepin.com/a/abc123.shtml' });
    assert.equal(hashJob.application.jobId, 'abc123');
    const liepin = await call(foreground, 'mcp_apply_job', { ...personalLiepin, url: 'https://m.liepin.com/job/123456.shtml?from=share' });
    assert.equal(liepin.browserUrl, 'https://www.liepin.com/job/123456.shtml');
    await call(foreground, 'mcp_feedback_import', {
      ...personalLiepin, events: [{ ...submitted, url: liepin.browserUrl }, chat]
    });
    assert.equal((await call(restarted, 'mcp_check_feedback', personalLiepin)).events.length, 2);
    const firstPage = await call(restarted, 'mcp_application_list', { ...personalLiepin, limit: 1 });
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.nextOffset, 1);
    const secondPage = await call(restarted, 'mcp_application_list', { ...personalLiepin, limit: 1, offset: firstPage.nextOffset });
    assert.equal(secondPage.nextOffset, null);
    assert.notEqual(firstPage.applications[0].jobId, secondPage.applications[0].jobId);

    const root = path.join(`${profileDir}.application-tracker`, '51job');
    const [scopeDir] = await readdir(root);
    const files = await readdir(path.join(root, scopeDir));
    for (const name of files) {
      const file = path.join(root, scopeDir, name);
      if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.ok(!(await readFile(file, 'utf8')).includes('私信正文'));
    }
  } finally {
    await Promise.allSettled([...clients].map(client => client.close()));
    await rm(dir, { recursive: true, force: true });
  }
});
