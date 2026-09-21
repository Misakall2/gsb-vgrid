'use strict';

const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, extname } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = join(__dirname, '..');
const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getChromePath() {
  const { existsSync } = await import('node:fs');
  const found = chromeCandidates.find((p) => existsSync(p));
  if (found) return found;
  throw new Error('Could not find Chrome or Chromium for the browser regression test.');
}

async function startServer() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const filePath = join(root, url.pathname === '/' ? 'index.html' : url.pathname);
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': types[extname(filePath)] || 'application/octet-stream' });
      res.end(body);
    } catch (err) {
      res.writeHead(404);
      res.end(err.message);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  }

  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return result;
  }

  async close() {
    await this.ready;
    this.ws.close();
  }
}

const browserTest = `(async () => {
  const grid = document.getElementById('grid');
  const canvas = document.getElementById('canvas');
  const header = document.getElementById('header');
  const failures = [];
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const assert = (ok, message, detail) => {
    if (!ok) failures.push(message + (detail === undefined ? '' : ' - ' + JSON.stringify(detail)));
  };
  const dispatchKey = (target, key, shiftKey = false, isComposing = false) => {
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key, code: key, bubbles: true, cancelable: true, shiftKey, isComposing,
    }));
  };
  const cellAt = (r, c) => canvas.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
  const selectedCount = () => canvas.querySelectorAll('.cell.selected').length;
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };

  // 1. IME composition survives row recycling, click and navigation attempts.
  const first = cellAt(0, 1);
  first.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await frame();
  const input = grid.querySelector('input.editor');
  assert(!!input, 'IME: editor opened');
  const oldValue = input.value;
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'bei' }));
  input.value = 'bei';
  grid.scrollTop = 8000;
  grid.dispatchEvent(new Event('scroll', { bubbles: true }));
  await frame();
  assert(grid.contains(input), 'IME: input is not destroyed when its row recycles');
  assert(input.value === 'bei', 'IME: provisional pinyin is retained', input.value);
  dispatchKey(input, 'ArrowDown', false, true);
  await frame();
  assert(grid.contains(input) && input.value === 'bei', 'IME: composing arrow key does not commit');
  grid.scrollTop = 0;
  grid.dispatchEvent(new Event('scroll', { bubbles: true }));
  await frame();
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  const otherCell = cellAt(1, 2);
  otherCell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  otherCell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await frame();
  assert(grid.contains(input) && input.value === 'bei', 'IME: another-cell click during composition does not commit');
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '北' }));
  assert(input.value === 'bei', 'IME: compositionend does not auto-write provisional text');
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));
  await frame();
  assert(!cellAt(0, 1).textContent.includes('bei'), 'IME: pinyin never enters the source cell', cellAt(0, 1).textContent);
  assert(cellAt(0, 1).textContent === oldValue, 'IME: source row is unchanged after cancellation');

  // 2. Selection is data-index state and re-paints after recycled rows return.
  cellAt(0, 0).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 9; i++) dispatchKey(grid, 'ArrowRight', true);
  for (let i = 0; i < 14; i++) dispatchKey(grid, 'ArrowDown', true);
  assert(selectedCount() === 15 * 10, 'selection: initial Shift rectangle has all cells', selectedCount());
  grid.scrollTop = 9000;
  grid.dispatchEvent(new Event('scroll'));
  await frame();
  grid.scrollTop = 0;
  grid.dispatchEvent(new Event('scroll'));
  await frame();
  assert(selectedCount() === 15 * 10, 'selection: rectangle returns after recycle', selectedCount());
  for (let r = 0; r <= 14; r++) {
    assert(cellAt(r, 0).classList.contains('selected'), 'selection: frozen first column row ' + r + ' is selected');
    assert(cellAt(r, 9).classList.contains('selected'), 'selection: last column row ' + r + ' is selected');
  }

  // 3. Frozen header/first column share row height while scrolling both axes.
  grid.scrollTop = 0;
  grid.scrollLeft = 900;
  grid.dispatchEvent(new Event('scroll'));
  await frame();
  const header0 = rect(header.children[0]);
  const stickyBodyCell = canvas.querySelectorAll('.row:not(.header-row) .cell.sticky')[0];
  assert(!!stickyBodyCell, 'frozen: a body sticky cell is rendered');
  const body0 = stickyBodyCell ? rect(stickyBodyCell) : null;
  assert(header0.left === body0.left, 'frozen: header and first column share left edge', {
    header: header0.left, body: body0.left,
  });
  const frozenLongCell = cellAt(0, 0);
  const noteLongCell = cellAt(0, 9);
  assert(!!frozenLongCell && !!noteLongCell, 'frozen: long row remains in overscan window');
  const longRow = frozenLongCell ? rect(frozenLongCell) : null;
  const longCell = noteLongCell ? rect(noteLongCell) : null;
  assert(longRow.height === longCell.height && longRow.height > 32, 'frozen: long-text row height reaches frozen cell', {
    frozen: longRow.height, note: longCell.height,
  });

  // 4. TSV is exactly rows x columns, including the frozen column.
  cellAt(0, 0).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 2; i++) dispatchKey(grid, 'ArrowRight', true);
  dispatchKey(grid, 'ArrowDown', true);
  grid.focus();
  let copied = '';
  document.dispatchEvent(new ClipboardEvent('copy', {
    bubbles: true,
    cancelable: true,
    clipboardData: new DataTransfer(),
  }));
  copied = document.__lastCopy || '';
  document.addEventListener('copy', (e) => {
    copied = e.clipboardData.getData('text/plain');
  }, { once: true });
  document.dispatchEvent(new ClipboardEvent('copy', {
    bubbles: true,
    cancelable: true,
    clipboardData: new DataTransfer(),
  }));
  const copyRows = copied.split('\\n');
  assert(copyRows.length === 2, 'TSV: copies two rows', copyRows);
  assert(copyRows.every((row) => row.split('\\t').length === 3), 'TSV: copies frozen plus two selected columns', copyRows);
  assert(!copied.endsWith('\\t'), 'TSV: no trailing empty tab');

  // 5. Empty/reset filtering restores scroll length and first-row position.
  const filterInput = document.getElementById('filterInput');
  const clearFilter = document.getElementById('clearFilter');
  grid.scrollTop = 7000;
  filterInput.value = '不存在的关键字';
  filterInput.dispatchEvent(new Event('input', { bubbles: true }));
  await frame();
  assert(grid.scrollTop === 0, 'scroll: zero-result filter resets top', grid.scrollTop);
  assert(canvas.offsetHeight <= grid.clientHeight, 'scroll: zero-result canvas has no stale scrollbar', {
    canvas: canvas.offsetHeight, viewport: grid.clientHeight,
  });
  clearFilter.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await frame();
  assert(grid.scrollTop === 0, 'scroll: clearing filter keeps first row at top', grid.scrollTop);
  assert(!!cellAt(0, 0) && rect(cellAt(0, 0)).top === Math.round(header0.bottom), 'scroll: first data row is directly under header', {
    top: rect(cellAt(0, 0)).top,
    headerBottom: Math.round(header0.bottom),
  });

  return { failures, copied };
})()`;

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const chrome = await getChromePath();
  const userDataDir = await import('node:fs/promises').then((fs) =>
    fs.mkdtemp(require('node:os').tmpdir() + '/vgrid-cdp-'));
  const browser = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--user-data-dir=' + userDataDir,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  browser.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const match = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for Chrome DevTools.\n' + stderr)), 10000);
      browser.stderr.on('data', (chunk) => {
        const found = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      });
    });
    const cdp = new Cdp(match);
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    const { targetId } = await cdp.send('Target.createTarget', {
      url: `http://127.0.0.1:${port}/index.html?rows=10000`,
    });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await sleep(1000);
    const result = await cdp.send('Runtime.evaluate', {
      expression: browserTest,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
    }
    const value = result.result.value;
    for (const [query, expectedRows] of [['rows=0', 'empty'], ['rows=1', 'single-row']]) {
      await cdp.send('Page.navigate', {
        url: `http://127.0.0.1:${port}/index.html?${query}`,
      }, sessionId);
      await sleep(700);
      const boundary = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const grid = document.getElementById('grid');
          const canvas = document.getElementById('canvas');
          const firstRow = canvas.querySelector('.row:not(.header-row)');
          const header = document.getElementById('header');
          grid.scrollTop = 7000;
          grid.scrollLeft = 7000;
          grid.dispatchEvent(new Event('scroll'));
          await frame();
          return {
            renderedRows: canvas.querySelectorAll('.row:not(.header-row)').length,
            scrollTop: grid.scrollTop,
            scrollLeft: grid.scrollLeft,
            firstTop: firstRow ? Math.round(firstRow.getBoundingClientRect().top) : null,
            headerBottom: Math.round(header.getBoundingClientRect().bottom),
            canvasHeight: canvas.offsetHeight,
            viewportHeight: grid.clientHeight,
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      }, sessionId);
      const b = boundary.result.value;
      if (expectedRows === 'empty') {
        if (b.renderedRows !== 0 || b.scrollTop !== 0 || b.scrollLeft !== 0 ||
          b.canvasHeight > b.viewportHeight) {
          value.failures.push('scroll: empty-table bounds are wrong - ' + JSON.stringify(b));
        }
      } else {
        if (b.renderedRows !== 1 || b.scrollTop !== 0 || b.scrollLeft !== 0 ||
          b.firstTop !== b.headerBottom) {
          value.failures.push('scroll: single-row bounds are wrong - ' + JSON.stringify(b));
        }
      }
    }
    await cdp.send('Target.closeTarget', { targetId });
    await cdp.close();
    return value;
  } finally {
    browser.kill('SIGTERM');
    server.close();
  }
}

async function runBrowserRegression() {
  try {
    const result = await main();
    assert.deepEqual(result.failures, []);
    return result;
  } catch (err) {
    throw err;
  }
}

if (require.main === module) {
  runBrowserRegression().then(() => {
    console.log('browser regressions: 5 incident checks passed');
  }).catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
} else if (process.env.RUN_BROWSER_TEST === '1') {
  test('browser: five virtual-grid incidents stay fixed', runBrowserRegression);
}

module.exports = { runBrowserRegression };
