const { copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const bundle = join(__dirname, 'bundle');
mkdirSync(bundle, { recursive: true });
copyFileSync(join(root, 'skill', 'SKILL.md'), join(bundle, 'SKILL.md'));
copyFileSync(join(root, 'LICENSE'), join(__dirname, 'LICENSE'));
