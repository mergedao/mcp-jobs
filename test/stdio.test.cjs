const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const fixture = `
  const assert = require('node:assert/strict');
  const playwright = require.resolve('playwright');
  require(playwright);
  process.env.MCP_JOBS_TIMEOUT_MS = '300';
  process.env.MCP_JOBS_DISABLE_PLATFORM_APIS = '1'; // e2e 只测公开页/DOM 层，不触真实浏览器与账号
  let hangingBrowserClosed = false;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    const hostname = new URL(url).hostname;
    if (hostname === 'sou.zhaopin.com') {
      return new Response('<title>Security Verification</title>', { headers: {'Content-Type': 'text/html'} });
    }
    assert.ok(hostname.endsWith('.51job.com'));
    if (hostname === 'kaifa.51job.com') assert.ok(hangingBrowserClosed, 'search deadline closes the in-flight browser');
    return new Response('<a class="el" href="https://jobs.51job.com/beijing/174331424.html"><span class="jname">北京前端开发</span><span class="location">北京</span></a>', {
      headers: { 'Content-Type': 'text/html' }
    });
  };

  const texts = {
    '.job-title-box > .ellipsis-1': '前端开发工程师',
    '.company-name': '示例公司',
    '.job-intro-container dd': '开发产品界面',
    '.company-intro-container .ellipsis-3': '示例公司'
  };
  require.cache[playwright].exports = {
    chromium: {
      async launch() {
        let slow = false;
        return {
          async newContext() {
            return {
              async newPage() {
                let url;
                let site;
                const card = {
                  innerHTML: async () => '<div>前端开发工程师</div>',
                  $eval: async selector => selector === 'a' ? '/job/example.shtml' : texts[selector] || '',
                  $$eval: async () => [],
                  textContent: async () => '前端开发工程师'
                };
                return {
                  async goto(target) {
                    const link = new URL(target);
                    site = link.hostname;
                    slow = site === 'm.zhipin.com' && link.searchParams.get('query') === '慢';
                    if (slow) return new Promise(() => {});
                    url = target;
                    return { status: () => 200 };
                  },
                  url: () => url,
                  title: async () => site === 'sou.zhaopin.com' ? 'Security Verification' : '公开职位',
                  async waitForSelector() {
                    if (site === 'm.zhipin.com') url = 'https://www.zhipin.com/web/user/login';
                  },
                  async $$(selector) {
                    assert.ok(!['m.zhipin.com', 'sou.zhaopin.com'].includes(site), 'login and verification pages must not be parsed');
                    assert.ok(['.job-card-pc-container', 'body'].includes(selector));
                    if (new URL(url).searchParams.get('key') === '无匹配') return [];
                    return [card];
                  },
                  close: async () => {}
                };
              },
              close: async () => {}
            };
          },
          close: async () => { if (slow) hangingBrowserClosed = true; }
        };
      }
    }
  };
  require('./dist/services/storageService').StorageService.prototype.saveData = async () => {};
  require('./dist/mcp');
`;

test('MCP preserves partial results and continues from a listed job to details and application preparation', { timeout: 10000 }, async () => {
  const root = path.join(__dirname, '..');
  const client = new Client({ name: 'stdio-regression', version: '1.0.0' });
  const errors = [];
  client.onerror = error => errors.push(error);
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['-e', fixture],
      cwd: root,
      stderr: 'ignore'
    }));
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args });
      return { isError: Boolean(response.isError), result: JSON.parse(response.content[0].text) };
    };
    const { tools } = await client.listTools();
    assert.ok(tools.some(tool => tool.name === 'mcp_prepare_application'));
    const search = await call('mcp_search_job', { keyword: '前端开发' });
    assert.equal(search.isError, false);
    assert.equal(search.result.jobs.length, 2);
    const [job] = search.result.jobs;
    assert.equal(job.title, '前端开发工程师');
    assert.equal(job.jobDetail, 'https://www.liepin.com/job/example.shtml');
    assert.deepEqual(search.result.metadata.sources.slice(0, 2).map(s => s.status), ['login_required', 'ok']);
    assert.equal(search.result.metadata.sources[0].browserUrl, 'https://www.zhipin.com/');
    assert.equal(search.result.metadata.sources[3].status, 'access_restricted');

    const detail = await call('mcp_job_detail', { url: job.jobDetail });
    assert.equal(detail.result.jobDetail.jobDescription, '开发产品界面');
    const draft = await call('mcp_prepare_application', { url: job.jobDetail, title: job.title, candidateSummary: '我有 React 开发经验。' });
    assert.equal(draft.result.status, 'draft_ready');
    assert.match(draft.result.communicationDraft, /React/);
    assert.equal(draft.result.nextAction.url, job.jobDetail);

    const partial = await call('mcp_search_job', { keyword: '慢' });
    assert.equal(partial.isError, false);
    assert.equal(partial.result.jobs.length, 1);
    assert.deepEqual(partial.result.metadata.sources.slice(0, 2).map(s => s.status), ['timeout', 'ok']);

    const unidentified = await call('mcp_search_job', { keyword: '无匹配' });
    assert.equal(unidentified.isError, false);
    assert.equal(unidentified.result.metadata.sources[1].status, 'unrecognized_page');

    const publicPages = ['https://kaifa.51job.com/beijing/webqianduankaifa/'];
    const board = await call('mcp_search_job', { keyword: '前端开发', publicPages, city: '北京' });
    assert.equal(board.result.jobs.length, 1);
    assert.equal(board.result.jobs[0].source, '51job');
    assert.equal(board.result.metadata.sources[0].coverage, 'public_page');
    assert.equal(board.result.metadata.sources[0].scanned, 1);
    const empty = await call('mcp_search_job', { keyword: '无匹配', publicPages });
    assert.equal(empty.isError, false);
    assert.equal(empty.result.metadata.sources[0].status, 'empty');
    const unsupported = await call('mcp_search_job', { keyword: '前端', publicPages, salary: '21-30万' });
    assert.equal(unsupported.result.metadata.sources[0].status, 'unsupported_filters');
    assert.deepEqual(errors, []);
  } finally {
    await client.close();
  }
});
