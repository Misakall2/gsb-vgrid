'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, access } = require('node:fs/promises');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');

function localAssetUrls(html, attribute) {
  const urls = [];
  const pattern = new RegExp(`${attribute}=["']([^"']+)["']`, 'g');
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const url = match[1];
    if (!/^(https?:|data:)/.test(url)) urls.push(url);
  }
  return urls;
}

test('page entry loads runtime assets with relative URLs', async () => {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const assets = [
    ...localAssetUrls(html, 'src'),
    ...localAssetUrls(html, 'href'),
  ];

  assert.deepEqual(localAssetUrls(html, 'href'), [
    './src/ui/styles.css',
  ]);
  assert.deepEqual(localAssetUrls(html, 'src'), [
    './src/core/grid-core.js',
    './src/ui/grid-view.js',
    './src/ui/app.js',
  ]);

  for (const url of assets) {
    assert.ok(url.startsWith('./'), `${url} must stay relative for subpath hosting`);
    assert.ok(!url.includes('/test/'), 'pages must not load test files as runtime modules');
    await access(join(root, url.slice(2)));
  }
});

test('page entry has no absolute local paths, remote packages, or test modules', async () => {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)=["']\/(?:Users|home|src|test)\b/);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//);
  assert.doesNotMatch(html, /test\/.*\.(?:js|mjs|cjs)["']/);
  assert.doesNotMatch(html, /node_modules/);
});
