import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from 'node:test';
import { spec as SpecReporter } from 'node:test/reporters';

const root = process.cwd();
const requiredFiles = [
  'index.html',
  'src/app.js',
  'src/core/grid-core.js',
  'src/ui/grid-view.js',
  'src/style.css',
  'tests/unit/grid-core.test.js',
];

function fail(message) {
  console.error(`test setup: ${message}`);
  process.exit(1);
}

const major = Number(process.versions.node.split('.')[0]);
if (!Number.isInteger(major) || major < 20) {
  fail(`Node.js 20 or newer is required for the built-in test runner; current version is ${process.version}.`);
}

for (const file of requiredFiles) {
  try {
    await access(join(root, file));
  } catch {
    fail(`required file is missing: ${file}. Run this command from the repository root.`);
  }
}

const indexHtml = await readFile(join(root, 'index.html'), 'utf8');
const requiredReferences = [
  './src/style.css',
  './src/core/grid-core.js',
  './src/ui/grid-view.js',
  './src/app.js',
];
for (const reference of requiredReferences) {
  if (!indexHtml.includes(`href="${reference}"`) && !indexHtml.includes(`src="${reference}"`)) {
    fail(`index.html is missing the relative runtime reference: ${reference}`);
  }
}

const testStream = run({
  files: [join(root, 'tests/unit/grid-core.test.js')],
  concurrency: 1,
});

testStream.on('fail', () => {
  process.exitCode = 1;
});
testStream.compose(new SpecReporter()).pipe(process.stdout);

await new Promise((resolve) => testStream.on('close', resolve));
