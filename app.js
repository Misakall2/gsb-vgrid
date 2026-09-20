/* app.js - DOM layer: virtualized rendering, frozen panes, editing, keyboard. */
/* global GridCore */
(function () {
  'use strict';

  const Core = window.GridCore;
  const ROW_H = Core.ROW_H;
  const HEADER_H = Core.HEADER_H;

  const COLUMNS = [
    { title: '订单号', width: 110 },
    { title: '客户', width: 110 },
    { title: '城市', width: 80 },
    { title: '商品', width: 130 },
    { title: '数量', width: 70 },
    { title: '单价', width: 90 },
    { title: '金额', width: 110 },
    { title: '状态', width: 80 },
    { title: '日期', width: 100 },
    { title: '备注', width: 260 },
  ];
  const COL_COUNT = COLUMNS.length;
  const TOTAL_WIDTH = COLUMNS.reduce(function (s, c) { return s + c.width; }, 0);

  // ?rows=0 / ?rows=1 give reproducible empty / single-row states.
  const params = new URLSearchParams(location.search);
  const parsed = parseInt(params.get('rows') || '10000', 10);
  const ROW_COUNT = isNaN(parsed) || parsed < 0 ? 0 : parsed;

  const data = Core.generateData(ROW_COUNT);
  const bounds = { rowCount: ROW_COUNT, colCount: COL_COUNT };

  const grid = document.getElementById('grid');
  const canvas = document.getElementById('canvas');
  const headerEl = document.getElementById('header');
  const emptyEl = document.getElementById('empty');
  const statusEl = document.getElementById('status');

  let sel = Core.createSelection(0, 0);
  const rowEls = new Map(); // rowIndex -> element, only for rendered rows

  const editor = {
    open: false,
    r: 0,
    c: 0,
    input: null,
    composing: false,
    commitOnBlur: false,
  };

  function colLeft(c) {
    let x = 0;
    for (let i = 0; i < c; i++) x += COLUMNS[i].width;
    return x;
  }

  function buildHeader() {
    headerEl.style.width = TOTAL_WIDTH + 'px';
    COLUMNS.forEach(function (col, i) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (i === 0 ? ' sticky' : '');
      cell.style.width = col.width + 'px';
      cell.textContent = col.title;
      headerEl.appendChild(cell);
    });
  }

  function buildRow(r) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    rowEl.style.top = (HEADER_H + r * ROW_H) + 'px';
    rowEl.style.width = TOTAL_WIDTH + 'px';
    for (let c = 0; c < COL_COUNT; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (c === 0 ? ' sticky' : '');
      cell.style.width = COLUMNS[c].width + 'px';
      cell.textContent = data[r][c];
      cell.dataset.r = r;
      cell.dataset.c = c;
      if (Core.isSelected(sel, r, c)) cell.classList.add('selected');
      if (sel.focus.r === r && sel.focus.c === c) cell.classList.add('active');
      rowEl.appendChild(cell);
    }
    return rowEl;
  }

  function render() {
    const range = Core.visibleRange({
      scrollTop: grid.scrollTop,
      viewportHeight: grid.clientHeight,
      rowCount: ROW_COUNT,
    });
    // Recycle: drop every rendered row, rebuild only the visible window.
    // The selection is pure data, so highlights reappear on rebuild.
    rowEls.forEach(function (el) { el.remove(); });
    rowEls.clear();
    for (let r = range.start; r < range.end; r++) {
      const rowEl = buildRow(r);
      canvas.appendChild(rowEl);
      rowEls.set(r, rowEl);
    }
    if (editor.open) {
      if (editor.r >= range.start && editor.r < range.end) {
        mountEditor(rowEls.get(editor.r));
      } else {
        commitEditor(); // edited row scrolled away: settle the value first
      }
    }
    updateStatus();
  }

  function updateStatus() {
    const n = Core.normalizeSelection(sel);
    const rows = n.r2 - n.r1 + 1;
    const cols = n.c2 - n.c1 + 1;
    statusEl.textContent = ROW_COUNT.toLocaleString() + ' 行' +
      (ROW_COUNT ? ' · 选区 ' + rows + ' 行 × ' + cols + ' 列' : '');
  }

  /* ---------- scrolling ---------- */

  let ticking = false;
  grid.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      render();
    });
  });

  function ensureVisible(r, c) {
    const top = HEADER_H + r * ROW_H;
    const bottom = top + ROW_H;
    const viewTop = grid.scrollTop + HEADER_H; // header stays pinned
    const viewBottom = grid.scrollTop + grid.clientHeight;
    if (top < viewTop) grid.scrollTop = top - HEADER_H;
    else if (bottom > viewBottom) grid.scrollTop = bottom - grid.clientHeight;

    if (c > 0) { // column 0 is frozen, always visible
      const left = colLeft(c);
      const right = left + COLUMNS[c].width;
      const frozenW = COLUMNS[0].width;
      const viewL = grid.scrollLeft + frozenW;
      const viewR = grid.scrollLeft + grid.clientWidth;
      if (left < viewL) grid.scrollLeft = left - frozenW;
      else if (right > viewR) grid.scrollLeft = right - grid.clientWidth;
    }
  }

  /* ---------- selection & keyboard ---------- */

  function afterMove() {
    ensureVisible(sel.focus.r, sel.focus.c);
    render();
    grid.focus();
  }

  function move(dr, dc, extend) {
    sel = Core.moveFocus(sel, dr, dc, bounds, extend);
    afterMove();
  }

  grid.addEventListener('keydown', function (e) {
    if (editor.open) return; // the editor input handles its own keys
    switch (e.key) {
      case 'ArrowUp': move(-1, 0, e.shiftKey); e.preventDefault(); break;
      case 'ArrowDown': move(1, 0, e.shiftKey); e.preventDefault(); break;
      case 'ArrowLeft': move(0, -1, e.shiftKey); e.preventDefault(); break;
      case 'ArrowRight': move(0, 1, e.shiftKey); e.preventDefault(); break;
      case 'Tab':
        sel = Core.tabNext(sel, bounds, e.shiftKey);
        afterMove();
        e.preventDefault();
        break;
      case 'Enter':
        openEditor();
        e.preventDefault();
        break;
      case 'Escape':
        sel = Core.createSelection(sel.focus.r, sel.focus.c);
        render();
        break;
    }
  });

  canvas.addEventListener('click', function (e) {
    const cell = e.target.closest('.cell');
    if (!cell || headerEl.contains(cell)) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (isNaN(r) || isNaN(c)) return;
    if (editor.open && editor.r === r && editor.c === c) return;
    sel = Core.createSelection(r, c);
    render();
    grid.focus();
  });

  canvas.addEventListener('dblclick', function (e) {
    const cell = e.target.closest('.cell');
    if (!cell || headerEl.contains(cell)) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (isNaN(r) || isNaN(c)) return;
    sel = Core.createSelection(r, c);
    openEditor();
  });

  /* Copy the current selection as TSV. Uses the copy event so it also works
     from file:// where the async clipboard API is often blocked. */
  document.addEventListener('copy', function (e) {
    if (editor.open) return; // let the input's own copy through
    if (document.activeElement !== grid) return;
    e.clipboardData.setData('text/plain', Core.toTSV(data, sel));
    e.preventDefault();
  });

  /* ---------- cell editor ---------- */

  function mountEditor(rowEl) {
    if (!rowEl || !editor.input) return;
    const cell = rowEl.children[editor.c];
    cell.classList.add('editing');
    cell.appendChild(editor.input);
  }

  function openEditor() {
    if (ROW_COUNT === 0 || editor.open) return;
    const r = sel.focus.r, c = sel.focus.c;
    ensureVisible(r, c);
    render();
    editor.open = true;
    editor.r = r;
    editor.c = c;
    editor.composing = false;
    editor.commitOnBlur = false;
    const input = document.createElement('input');
    input.className = 'editor';
    input.value = data[r][c];
    editor.input = input;
    bindEditorEvents(input);
    mountEditor(rowEls.get(r));
    input.focus();
    input.select();
  }

  function commitEditor() {
    if (!editor.open) return;
    data[editor.r][editor.c] = editor.input.value;
    editor.open = false;
    editor.composing = false;
    editor.commitOnBlur = false;
    editor.input.remove();
    editor.input = null;
  }

  function cancelEditor() {
    if (!editor.open) return;
    editor.open = false;
    editor.composing = false;
    editor.commitOnBlur = false;
    editor.input.remove();
    editor.input = null;
  }

  function bindEditorEvents(input) {
    input.addEventListener('compositionstart', function () {
      editor.composing = true;
    });
    input.addEventListener('compositionend', function () {
      editor.composing = false;
      // Blur mid-composition (clicked another cell): settle only now that
      // the composed text is final.
      if (editor.commitOnBlur) {
        editor.commitOnBlur = false;
        commitEditor();
        render();
        grid.focus();
      }
    });
    input.addEventListener('keydown', function (e) {
      // The input lives inside the grid: never let keys bubble up, or the
      // grid handler would re-open the editor right after we commit it.
      e.stopPropagation();
      const composing = editor.composing || e.isComposing;
      const action = Core.editorKeyAction(e.key, composing);
      if (action === 'none') return; // typing, or IME is in charge
      e.preventDefault();
      if (action === 'cancel') {
        cancelEditor();
        render();
        grid.focus();
        return;
      }
      commitEditor();
      if (action === 'commit-tab') sel = Core.tabNext(sel, bounds, e.shiftKey);
      else if (action === 'commit-up') sel = Core.moveFocus(sel, -1, 0, bounds, false);
      else if (action === 'commit-down') sel = Core.moveFocus(sel, 1, 0, bounds, false);
      else if (action === 'commit-left') sel = Core.moveFocus(sel, 0, -1, bounds, false);
      else if (action === 'commit-right') sel = Core.moveFocus(sel, 0, 1, bounds, false);
      afterMove();
    });
    input.addEventListener('blur', function () {
      if (!editor.open) return;
      if (editor.composing) {
        // Clicked away mid-composition: wait for compositionend.
        editor.commitOnBlur = true;
        return;
      }
      commitEditor();
      render();
    });
  }

  /* ---------- init ---------- */

  buildHeader();
  canvas.style.width = TOTAL_WIDTH + 'px';
  canvas.style.height = (HEADER_H + ROW_COUNT * ROW_H) + 'px';
  emptyEl.hidden = ROW_COUNT !== 0;
  render();
})();
