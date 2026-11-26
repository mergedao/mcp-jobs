const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const fixture = `
  process.env.MCP_JOBS_DISABLE_PLATFORM_APIS = '1';
  process.env.MCP_JOBS_PROFILE_POLL_MS = '0';
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
  require('./dist/mcp');
  setInterval(() => {}, 10000).unref();
`;

test('51job and Liepin track applications in the local ledger across restarts', { timeout: 15000 }, async () => {
  const root = path.join(__dirname, '..');
  const clients = new Set();
  const connect = async () => {
    const client = new Client({ name: 'ledger-regression', version: '1.0.0' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['-e', fixture],
      cwd: root,
      stderr: 'ignore'
    }));
    clients.add(client);
    return client;
  };
  const call = async (client, name, args, expectError = false) => {
    const response = await client.callTool({ name, arguments: args });
    if (response.isError) {
      const text = response.content[0].text;
      if (expectError) return text; // 错误响应是纯文本（如「错误: ...」）
      throw new Error(text);
    }
    return JSON.parse(response.content[0].text);
  };

  const first = await connect();
  const scope = { platform: '51job', accountId: 'personal' };
  const spec = { ...scope, url: 'https://jobs.51job.com/beijing/123456.html?ref=a', title: '开发工程师', resumeVersion: 'v1' };
  const otherUrl = 'https://msearch.51job.com/jobs/shanghai/123456.html?ref=b';
  const staging = await Promise.all([
    call(first, 'mcp_apply_job', spec),
    call(first, 'mcp_apply_job', { ...spec, url: otherUrl })
  ]);
  // 同一台账内按 jobId 去重：URL 变体（/beijing/ vs /shanghai/）指向同一职位 → 均 already_tracked
  assert.deepEqual(staging.map(x => x.status).sort(), ['already_tracked', 'already_tracked']);
  assert.equal(staging[0].application.jobId, staging[1].application.jobId);
  assert.equal(staging[0].application.resumeVersion, 'v1');
  // 平台归属校验：51job 台账里传猎聘链接要被拒
  assert.match(await call(first, 'mcp_apply_job', { ...spec, url: 'https://www.liepin.com/job/123456.shtml' }, true), /平台不匹配/);
  // 猎聘搜索产出的 /a/<hash>.shtml 链接同样被台账接受（review 修复：搜索与台账共用链接识别）
  assert.ok((await call(first, 'mcp_apply_job', { platform: 'liepin', accountId: 'personal', url: 'https://www.liepin.com/a/abc123.shtml', title: 'FDE' })).application);

  const list = await call(first, 'mcp_application_list', scope);
  assert.equal(list.applications.length, 1);
  assert.equal(list.applications[0].status, 'prepared');
  assert.equal(list.applications[0].receiptReference, undefined);

  await first.close();
  clients.delete(first);
  const restarted = await connect();
  const after = await call(restarted, 'mcp_application_list', scope);
  assert.equal(after.applications.length, 1, '台账跨重启持久');

  const personalLiepin = { platform: 'liepin', accountId: 'personal' };
  // /a/<hash>.shtml 链接入账：jobId 取 hash（review 修复验证：搜索与台账共用链接识别）
  const liepinList = (await call(restarted, 'mcp_application_list', personalLiepin)).applications;
  assert.equal(liepinList.length, 1);
  assert.equal(liepinList[0].jobId, 'abc123');

  for (const client of clients) await client.close().catch(() => {});
});

test('mcp_login_confirmed records user-confirmed login state', { timeout: 15000 }, async () => {
  const root = path.join(__dirname, '..');
  const client = new Client({ name: 'login-confirm', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['-e', fixture],
    cwd: root,
    stderr: 'ignore'
  }));
  const response = await client.callTool({ name: 'mcp_login_confirmed', arguments: { platform: 'liepin' } });
  const payload = JSON.parse(response.content[0].text);
  assert.equal(payload.status, 'logged_in');
  await client.close().catch(() => {});
});
