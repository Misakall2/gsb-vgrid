import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const major = Number(process.versions.node.split('.')[0]);

if (!Number.isFinite(major) || major < 18) {
  console.error(
    `Node.js 18 or newer is required for node:test, but this is Node.js ${process.version}.\n` +
    'Install a current Node.js release, then run: node scripts/test.mjs'
  );
  process.exit(1);
}

const requiredFiles = [
  'index.html',
  'src/core/grid-core.js',
  'src/ui/grid-view.js',
  'src/ui/app.js',
  'src/ui/styles.css',
  'test/logic/grid-core.test.js',
  'test/logic/page-contract.test.js',
];

const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));
if (missing.length) {
  console.error('Cannot run pure-logic tests because required files are missing:');
  for (const file of missing) console.error(`  - ${file}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--test', 'test/logic/grid-core.test.js', 'test/logic/page-contract.test.js'],
  { cwd: root, stdio: 'inherit' }
);

process.exit(result.status === null ? 1 : result.status);
