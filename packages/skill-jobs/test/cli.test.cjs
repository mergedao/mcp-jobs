const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { unzipSync } = require('fflate');

const cli = path.join(__dirname, '..', 'cli.cjs');
const canonical = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'skill', 'SKILL.md'));

function workspace(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-jobs-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return { cwd, run: (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }) };
}

test('installs canonical Skill in the Codex and Claude Code project directories', t => {
  const { cwd, run } = workspace(t);
  for (const [client, directory] of [['codex', '.agents'], ['claude', '.claude']]) {
    const installed = path.join(cwd, directory, 'skills', 'mcp-jobs', 'SKILL.md');
    assert.equal(run('install', client).status, 0);
    assert.deepEqual(fs.readFileSync(installed), canonical);
    assert.match(run('install', client).stdout, /Already installed/);
    fs.writeFileSync(installed, 'my local edit');
    assert.notEqual(run('install', client).status, 0);
    assert.equal(fs.readFileSync(installed, 'utf8'), 'my local edit');
  }
});

test('exports a standalone instruction file and the supported archive layouts', t => {
  const { cwd, run } = workspace(t);
  const markdown = run('export', 'markdown');
  assert.equal(markdown.status, 0);
  assert.equal(markdown.stdout, canonical.toString());
  assert.match(markdown.stdout, /## 独立使用/);
  assert.match(markdown.stdout, /## 连接 MCP 后/);
  assert.equal(run('export', 'markdown', '--out', 'standalone.md').status, 0);
  assert.deepEqual(fs.readFileSync(path.join(cwd, 'standalone.md')), canonical);

  assert.equal(run('export', 'claude').status, 0);
  const claude = unzipSync(fs.readFileSync(path.join(cwd, 'skill-jobs-claude.zip')));
  assert.deepEqual(Buffer.from(claude['mcp-jobs/SKILL.md']), canonical);

  assert.equal(run('export', 'doubao', '--out', 'upload.zip').status, 0);
  const doubao = unzipSync(fs.readFileSync(path.join(cwd, 'upload.zip')));
  const manifest = JSON.parse(Buffer.from(doubao['plugin.json']));
  assert.equal(manifest.name, 'skill-jobs');
  assert.equal(manifest.version, require('../package.json').version);
  assert.deepEqual(Buffer.from(doubao['skills/mcp-jobs/SKILL.md']), canonical);
  const icon = manifest.extensions['com.doubao'].icon.replace(/^\.\//, '');
  assert.ok(doubao[icon]);
  assert.ok(!doubao['mcp.json']);
  assert.notEqual(run('export', 'doubao', '--out', 'upload.zip').status, 0);
});

test('rejects unsupported commands and flags', t => {
  const { run } = workspace(t);
  for (const args of [['install', 'doubao'], ['install', 'codex', '--scope', 'global'], ['export', 'claude', '--scope', 'user']]) {
    assert.notEqual(run(...args).status, 0);
  }
});
