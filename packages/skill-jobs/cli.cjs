#!/usr/bin/env node
const { COPYFILE_EXCL } = require('node:fs').constants;
const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const { parseArgs } = require('node:util');
const { zipSync } = require('fflate');
const { version } = require('./package.json');

const usage = `Usage:
  skill-jobs install codex|claude [--scope project|user]
  skill-jobs export claude|doubao|markdown [--out FILE]
  skill-jobs --help`;
const skillName = 'mcp-jobs';
const skillFile = join(__dirname, 'bundle', 'SKILL.md');

function install(client, scope) {
  const folders = { codex: '.agents', claude: '.claude' };
  if (!Object.hasOwn(folders, client) || !['project', 'user'].includes(scope)) {
    throw new Error('Choose codex or claude and use --scope project or user.');
  }
  const path = join(scope === 'user' ? homedir() : process.cwd(), folders[client], 'skills', skillName, 'SKILL.md');
  mkdirSync(dirname(path), { recursive: true });
  try {
    copyFileSync(skillFile, path, COPYFILE_EXCL);
    console.log('Installed ' + path);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    if (!readFileSync(path).equals(readFileSync(skillFile))) {
      throw new Error('A different skill already exists at ' + path + '. Back it up before installing.');
    }
    console.log('Already installed ' + path);
  }
}

function exportSkill(client, out) {
  const contents = readFileSync(skillFile);
  if (client === 'markdown') {
    if (out) writeFileSync(resolve(out), contents, { flag: 'wx' });
    else process.stdout.write(contents);
    return;
  }
  if (client !== 'claude' && client !== 'doubao') throw new Error('Choose claude, doubao, or markdown.');
  const license = readFileSync(join(__dirname, 'LICENSE'));
  let entries;
  if (client === 'claude') {
    entries = { [skillName + '/SKILL.md']: contents, [skillName + '/LICENSE']: license };
  } else {
    const plugin = require('./assets/doubao-plugin.json');
    entries = {
      'plugin.json': Buffer.from(JSON.stringify({ ...plugin, version }, null, 2)),
      ['skills/' + skillName + '/SKILL.md']: contents,
      'com.doubao/assets/plugin-icon.png': readFileSync(join(__dirname, 'assets', 'plugin-icon.png')),
      'LICENSE': license
    };
  }
  const path = resolve(out ?? 'skill-jobs-' + client + '.zip');
  writeFileSync(path, zipSync(entries), { flag: 'wx' });
  console.log('Exported ' + path);
}

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' }, scope: { type: 'string' }, out: { type: 'string' } }
  });
  const [action, client] = positionals;
  if (values.help || !action) console.log(usage);
  else if (positionals.length !== 2) throw new Error(usage);
  else if (action === 'install' && values.out === undefined) install(client, values.scope ?? 'project');
  else if (action === 'export' && values.scope === undefined) exportSkill(client, values.out);
  else throw new Error(usage);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
