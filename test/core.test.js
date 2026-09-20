const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/core.js');

function makeModel(rowCount) {
  const rows = Array.from({ length: rowCount }, (_, row) => [
    `id-${row}`,
    `客户-${row}`,
    `金额-${row}`,
  ]);
  return core.createModel(rows, {
    columns: [
      { title: '订单号' },
      { title: '客户', width: 180 },
      { title: '金额' },
    ],
  });
}

test('empty table has a safe visible range and no selection target', () => {
  const model = makeModel(0);
  const vertical = core.getVisibleRange(0, 500, 0);
  const horizontal = core.getColumnRange(0, 500, model.widths);

  assert.equal(model.rowCount, 0);
  assert.deepEqual(vertical, {
    start: 0,
    end: -1,
    offset: 0,
    visibleStart: 0,
    visibleEnd: -1,
  });
  assert.equal(horizontal.start, 0);
  assert.ok(horizontal.end >= 0);
  assert.equal(core.moveClamped(null, 'ArrowDown', model.rowCount, model.columnCount), null);
});

test('a single row clamps vertical navigation and Tab stays on the same row', () => {
  const model = makeModel(1);
  const down = core.moveClamped({ row: 0, col: 0 }, 'ArrowDown', model.rowCount, model.columnCount);
  const tabEnd = core.moveTab({ row: 0, col: 2 }, model.rowCount, model.columnCount);
  const shiftTabStart = core.moveTab({ row: 0, col: 0 }, model.rowCount, model.columnCount, true);

  assert.deepEqual(down, { row: 0, col: 0 });
  assert.deepEqual(tabEnd, { row: 0, col: 2 });
  assert.deepEqual(shiftTabStart, { row: 0, col: 0 });
});

test('10,000 rows use a small window but preserve the full scroll size', () => {
  const model = makeModel(10000);
  const totalHeight = model.rowCount * core.ROW_HEIGHT;
  const range = core.getVisibleRange(5000, 600, totalHeight);

  assert.equal(totalHeight, 320000);
  assert.equal(range.visibleStart, 156);
  assert.equal(range.visibleEnd, 174);
  assert.ok(range.start < range.visibleStart);
  assert.ok(range.end > range.visibleEnd);
  assert.ok(range.end - range.start + 1 < 40);
});

test('scrolling near the bottom does not return rows beyond the last index', () => {
  const model = makeModel(10000);
  const range = core.getVisibleRange(319600, 600, model.rowCount * core.ROW_HEIGHT);

  assert.equal(range.visibleStart, 9981);
  assert.equal(range.visibleEnd, 9999);
  assert.equal(range.end, 9999);
});

test('a small table stays within row indexes even when the viewport is taller than data', () => {
  const range = core.getVisibleRange(0, 700, 2 * core.ROW_HEIGHT);

  assert.equal(range.visibleStart, 0);
  assert.equal(range.visibleEnd, 1);
  assert.equal(range.end, 1);
});

test('horizontal virtualization only renders columns intersecting the viewport', () => {
  const widths = [176, 150, 150, 150, 150, 150];
  const range = core.getColumnRange(260, 320, widths);

  assert.equal(range.start, 0);
  assert.equal(range.end, 5);
  assert.equal(range.offsets[2], 326);
});

test('selection lives in the data model and remains available after rows are recycled', () => {
  const anchor = { row: 3, col: 1 };
  const active = { row: 9001, col: 4 };
  const selection = core.normalizeSelection(anchor, active);

  assert.equal(core.isCellSelected(selection, 100, 1), true);
  assert.equal(core.isCellSelected(selection, 100, 4), true);
  assert.equal(core.isCellSelected(selection, 2, 1), false);
  assert.equal(core.isActiveCell(selection, 9001, 4), true);
});

test('Shift+Arrow keeps the anchor and moves only the active endpoint', () => {
  let selection = core.normalizeSelection({ row: 2, col: 2 }, { row: 2, col: 2 });
  selection = core.extendSelection(selection, 'ArrowRight', 10, 10);
  selection = core.extendSelection(selection, 'ArrowDown', 10, 10);

  assert.deepEqual(selection.anchor, { row: 2, col: 2 });
  assert.deepEqual(selection.active, { row: 3, col: 3 });
  assert.deepEqual(
    { top: selection.top, bottom: selection.bottom, left: selection.left, right: selection.right },
    { top: 2, bottom: 3, left: 2, right: 3 }
  );
});

test('selection is copied as TSV and quotes tab, newline, and quote characters', () => {
  const model = core.createModel([
    ['a', 'b\tc', 'line1\nline2'],
    ['d', 'she said "hi"', 'f'],
  ], { columnCount: 3 });
  const selection = core.normalizeSelection({ row: 0, col: 0 }, { row: 1, col: 2 });

  assert.equal(
    core.selectionToTSV(model, selection),
    'a\t"b\tc"\t"line1\nline2"\nd\t"she said ""hi"""\tf'
  );
});

test('English input updates immediately while a normal Enter key is processed by the app', () => {
  let model = makeModel(2);
  let edit = core.startEdit({ row: 0, col: 1 }, '');
  edit = { ...edit, draft: 'hello' };
  const result = core.commitEdit(model, edit);

  model = result.model;
  assert.equal(core.getCellValue(model, 0, 1), 'hello');
  assert.equal(core.shouldIgnoreEditorKey({ isComposing: false, keyCode: 13 }, edit), false);
});

test('IME composition ignores arrow keys and Enter, then commits exactly once after compositionend', () => {
  let model = makeModel(2);
  let edit = core.startEdit({ row: 0, col: 1 }, '');
  edit = core.beginComposition(edit);
  edit = core.updateComposition(edit, 'ni');

  assert.equal(core.shouldIgnoreEditorKey({ isComposing: true, key: 'ArrowDown', keyCode: 229 }, edit), true);
  assert.equal(core.shouldIgnoreEditorKey({ isComposing: false, key: 'Enter', keyCode: 229 }, edit), true);

  edit = core.endComposition(edit, '你');
  model = core.commitEdit(model, edit).model;

  assert.equal(core.getCellValue(model, 0, 1), '你');
  assert.equal(edit.isComposing, false);
});

test('long cell values remain string data and do not change row geometry', () => {
  const longValue = '超长备注'.repeat(500);
  const model = core.createModel([['id', longValue]], { columnCount: 2 });

  assert.equal(core.getCellValue(model, 0, 1), longValue);
  assert.equal(model.rowCount * core.ROW_HEIGHT, core.ROW_HEIGHT);
  assert.ok(model.widths[1] < longValue.length);
});

test('scroll helpers bring rows and columns into view without overshooting', () => {
  const model = makeModel(10000);
  const rowScroll = core.scrollIndexIntoView(9000, 5000, 600, model.rowCount * core.ROW_HEIGHT, core.ROW_HEIGHT);
  const colScroll = core.scrollColumnIntoView(2, 0, 220, model.widths);

  assert.equal(rowScroll, 287432);
  assert.equal(colScroll, 286);
});
