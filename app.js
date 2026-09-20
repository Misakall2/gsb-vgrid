/* app.js - DOM layer: virtualized rendering, frozen panes, editing, keyboard. */
/* global GridCore */
(function () {
  'use strict';

  const Core = window.GridCore;
  const ROW_H = Core.ROW_H;
  const HEADER_H = Core.HEADER_H;
  const GROUP_H = Core.GROUP_H;

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
  const params = new URLSearchParams(location.search);
  const parsed = parseInt(params.get('rows') || '10000', 10);
  const ROW_COUNT = isNaN(parsed) || parsed < 0 ? 0 : parsed;

  const data = Core.generateData(ROW_COUNT);
  let widths = COLUMNS.map(function (col) { return col.width; });
  let metrics = Core.columnMetrics(widths);

  const filterColumnEl = document.getElementById('filterColumn');
  const filterInput = document.getElementById('filterInput');
  const clearFilterEl = document.getElementById('clearFilter');
  const groupColumnEl = document.getElementById('groupColumn');
  const clearGroupEl = document.getElementById('clearGroup');
  const grid = document.getElementById('grid');
  const canvas = document.getElementById('canvas');
  const headerEl = document.getElementById('header');
  const groupBar = document.getElementById('groupBar');
  const emptyEl = document.getElementById('empty');
  const statusEl = document.getElementById('status');

  let filterColumn = 2;
  let filterKeyword = '';
  let groupColumn = null;
  let collapsed = new Set();
  let filteredRowIds = data.map(function (_, i) { return i; });
  let groups = null;
  let groupedView = null;
  let visibleRowIds = filteredRowIds;
  let sel = ROW_COUNT ? Core.createDataSelection(0, 0) : {
    anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 }, rowIds: [],
  };
  const rowEls = new Map();
  const groupEls = new Map();
  const editor = {
    open: false, r: 0, c: 0, input: null, composing: false, commitOnBlur: false,
  };

  function colLeft(c) { return metrics.lefts[c]; }
  function visibleDataHeight() {
    if (groupColumn == null) return filteredRowIds.length * ROW_H;
    return groupedView ? groupedView.totalHeight : 0;
  }

  function rebuildModel(options) {
    const preserveScroll = options && options.preserveScroll;
    const top = grid.scrollTop;
    filteredRowIds = Core.filterRows(data, [{ column: filterColumn, keyword: filterKeyword }]);
    groups = groupColumn == null ? null : Core.groupRows(data, filteredRowIds, groupColumn);
    if (groups) {
      const nextCollapsed = new Set();
      groups.forEach(function (group) {
        if (collapsed.has(group.key)) nextCollapsed.add(group.key);
      });
      collapsed = nextCollapsed;
      groupedView = Core.visibleGroupedRows({
        groups: groups,
        collapsed: collapsed,
        scrollTop: preserveScroll ? top : 0,
        viewportHeight: grid.clientHeight,
      });
      visibleRowIds = groupedView.groups.reduce(function (ids, group) {
        return group.collapsed ? ids : ids.concat(group.rowIds);
      }, []);
    } else {
      groupedView = null;
      visibleRowIds = filteredRowIds;
    }
    reconcileSelection();
    if (!preserveScroll) grid.scrollTop = 0;
    layoutCanvas();
    render();
  }

  function reconcileSelection() {
    if (!sel || !sel.rowIds) return;
    const visibleSet = new Set(visibleRowIds);
    const rowIds = (sel.rowIds || []).filter(function (id) { return visibleSet.has(id); });
    sel = {
      anchor: { r: sel.anchor.r, c: sel.anchor.c },
      focus: { r: sel.focus.r, c: sel.focus.c },
      rowIds: rowIds,
    };
  }

  function findRowInGroups(rowId) {
    if (!groupedView) return null;
    for (const group of groupedView.groups) {
      const rowIndex = group.rowIds.indexOf(rowId);
      if (rowIndex !== -1) return { group: group, rowIndex: rowIndex };
    }
    return null;
  }

  function toggleGroup(key) {
    if (editor.composing) return;
    editor.preserveHidden = editor.open;
    editor.suspendBlur = editor.open;
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    rebuildModel({ preserveScroll: true });
    editor.suspendBlur = false;
    if (editor.open && rowEls.has(editor.r)) {
      mountEditor(rowEls.get(editor.r));
      editor.input.focus();
    }
  }

  function populateControls() {
    COLUMNS.forEach(function (col, i) {
      filterColumnEl.appendChild(new Option(col.title, String(i)));
      groupColumnEl.appendChild(new Option(col.title, String(i)));
    });
    filterColumnEl.value = String(filterColumn);
  }

  filterColumnEl.addEventListener('change', function () {
    filterColumn = Number(filterColumnEl.value);
    filterKeyword = filterInput.value.trim();
    rebuildModel();
  });
  filterInput.addEventListener('compositionstart', function () {
    filterInput.dataset.composing = '1';
  });
  filterInput.addEventListener('compositionend', function () {
    filterInput.dataset.composing = '0';
    filterKeyword = filterInput.value.trim();
    rebuildModel();
  });
  filterInput.addEventListener('input', function () {
    if (filterInput.dataset.composing === '1') return;
    filterKeyword = filterInput.value.trim();
    rebuildModel();
  });
  clearFilterEl.addEventListener('click', function () {
    filterInput.value = '';
    filterKeyword = '';
    filterInput.focus();
    rebuildModel();
  });
  groupColumnEl.addEventListener('change', function () {
    if (editor.composing) {
      groupColumnEl.value = groupColumn == null ? '' : String(groupColumn);
      return;
    }
    if (editor.open) commitEditor();
    groupColumn = groupColumnEl.value === '' ? null : Number(groupColumnEl.value);
    rebuildModel();
  });
  clearGroupEl.addEventListener('click', function () {
    if (editor.composing) return;
    if (editor.open) commitEditor();
    groupColumn = null;
    groupColumnEl.value = '';
    rebuildModel();
  });

  function buildHeader() {
    headerEl.replaceChildren();
    headerEl.style.width = metrics.totalWidth + 'px';
    COLUMNS.forEach(function (col, i) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (i === 0 ? ' sticky' : '');
      applyCellLayout(cell, i);
      cell.textContent = col.title;
      const handle = document.createElement('span');
      handle.className = 'resize-handle';
      handle.title = '拖动调整列宽';
      handle.dataset.c = String(i);
      cell.appendChild(handle);
      headerEl.appendChild(cell);
    });
  }

  function applyCellLayout(cell, c) {
    cell.style.width = widths[c] + 'px';
    cell.style.minWidth = widths[c] + 'px';
    cell.style.maxWidth = widths[c] + 'px';
  }

  function buildCell(rowId, c) {
    const cell = document.createElement('div');
    cell.className = 'cell' + (c === 0 ? ' sticky' : '');
    cell.textContent = data[rowId][c];
    cell.dataset.r = rowId;
    cell.dataset.c = c;
    applyCellLayout(cell, c);
    if (Core.isSelected(sel, rowId, c)) cell.classList.add('selected');
    if (sel.focus.r === rowId && sel.focus.c === c) cell.classList.add('active');
    return cell;
  }

  function buildRow(item) {
    const rowId = item.rowId;
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    rowEl.style.top = (HEADER_H + item.top) + 'px';
    rowEl.style.width = metrics.totalWidth + 'px';
    for (let c = 0; c < COL_COUNT; c++) rowEl.appendChild(buildCell(rowId, c));
    return rowEl;
  }

  function appendGroupToggle(el, group, key) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'group-toggle';
    button.textContent = group.collapsed ? '▶' : '▼';
    button.addEventListener('mousedown', function (e) { e.preventDefault(); });
    button.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleGroup(key);
    });
    el.appendChild(button);
  }

  function buildGroupHeader(item) {
    const group = groupedView.groups[item.group];
    const el = document.createElement('div');
    el.className = 'group-header';
    el.style.top = (HEADER_H + item.top) + 'px';
    el.style.width = 'max(' + metrics.totalWidth + 'px, 100%)';
    el.dataset.key = group.key;
    appendGroupToggle(el, group, group.key);
    const label = document.createElement('span');
    label.textContent = group.key + ' · ' + group.count + ' 行';
    el.appendChild(label);
    return el;
  }

  function clearRows() {
    rowEls.forEach(function (el) { el.remove(); });
    groupEls.forEach(function (el) { el.remove(); });
    rowEls.clear();
    groupEls.clear();
  }

  function renderUngrouped(range) {
    for (let r = range.start; r < range.end; r++) {
      const rowId = filteredRowIds[r];
      const rowEl = buildRow({ rowId: rowId, top: r * ROW_H });
      canvas.appendChild(rowEl);
      rowEls.set(rowId, rowEl);
    }
  }

  function renderGrouped() {
    for (const item of groupedView.items) {
      if (item.type === 'group') {
        const el = buildGroupHeader(item);
        canvas.appendChild(el);
        groupEls.set(item.key, el);
      } else {
        const rowEl = buildRow(item);
        canvas.appendChild(rowEl);
        rowEls.set(item.rowId, rowEl);
      }
    }
  }

  function renderGroupBar() {
    if (!groupedView || !groupedView.currentGroup) {
      groupBar.hidden = true;
      groupBar.replaceChildren();
      return;
    }
    const group = groupedView.currentGroup;
    groupBar.hidden = false;
    groupBar.style.width = Math.max(metrics.totalWidth, grid.clientWidth) + 'px';
    groupBar.replaceChildren();
    appendGroupToggle(groupBar, group, group.key);
    const label = document.createElement('span');
    label.textContent = group.key + ' · ' + group.count + ' 行';
    groupBar.appendChild(label);
  }

  function render() {
    clearRows();
    if (groupColumn == null) {
      const range = Core.visibleRange({
        scrollTop: grid.scrollTop,
        viewportHeight: grid.clientHeight,
        rowCount: filteredRowIds.length,
      });
      renderUngrouped(range);
      groupBar.hidden = true;
      groupBar.replaceChildren();
    } else {
      groupedView = Core.visibleGroupedRows({
        groups: groups,
        collapsed: collapsed,
        scrollTop: grid.scrollTop,
        viewportHeight: grid.clientHeight,
      });
      renderGrouped();
      renderGroupBar();
    }
    if (editor.open) {
      if (rowEls.has(editor.r)) mountEditor(rowEls.get(editor.r));
      else if (!editor.preserveHidden) commitEditor();
    }
    editor.preserveHidden = false;
    emptyEl.hidden = visibleRowIds.length !== 0;
    emptyEl.textContent = ROW_COUNT === 0 ? '暂无成交数据' : '没有符合筛选条件的数据';
    updateStatus();
  }

  function layoutCanvas() {
    metrics = Core.columnMetrics(widths);
    canvas.style.width = metrics.totalWidth + 'px';
    canvas.style.height = (HEADER_H + visibleDataHeight()) + 'px';
    headerEl.style.width = metrics.totalWidth + 'px';
  }

  function relayoutVisibleRows() {
    metrics = Core.columnMetrics(widths);
    headerEl.style.width = metrics.totalWidth + 'px';
    canvas.style.width = metrics.totalWidth + 'px';
    canvas.style.height = (HEADER_H + visibleDataHeight()) + 'px';
    for (let c = 0; c < headerEl.children.length; c++) {
      applyCellLayout(headerEl.children[c], c);
    }
    rowEls.forEach(function (rowEl) {
      rowEl.style.width = metrics.totalWidth + 'px';
      for (let c = 0; c < rowEl.children.length; c++) applyCellLayout(rowEl.children[c], c);
    });
    groupEls.forEach(function (el) {
      el.style.width = 'max(' + metrics.totalWidth + 'px, 100%)';
    });
    if (groupedView) renderGroupBar();
  }

  function updateStatus() {
    const n = Core.normalizeSelection(sel);
    const rows = (sel.rowIds || []).length || (visibleRowIds.length ? 1 : 0);
    const cols = n.c2 - n.c1 + 1;
    statusEl.textContent = visibleRowIds.length.toLocaleString() + ' / ' + ROW_COUNT.toLocaleString() + ' 行' +
      (visibleRowIds.length ? ' · 选区 ' + rows + ' 行 × ' + cols + ' 列' : '');
  }

  let ticking = false;
  grid.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      render();
    });
  });

  function ensureVisible(rowId, c) {
    let top = 0;
    if (groupColumn != null) {
      const found = findRowInGroups(rowId);
      if (!found) return;
      top = found.group.rowTop(found.rowIndex);
    } else {
      const idx = filteredRowIds.indexOf(rowId);
      if (idx === -1) return;
      top = idx * ROW_H;
    }
    const bottom = top + ROW_H;
    const viewTop = grid.scrollTop;
    const viewBottom = grid.scrollTop + grid.clientHeight - HEADER_H;
    if (top < viewTop) grid.scrollTop = top - GROUP_H;
    else if (bottom > viewBottom) grid.scrollTop = bottom - (grid.clientHeight - HEADER_H);

    if (c > 0) {
      const left = colLeft(c);
      const right = left + widths[c];
      const frozenW = widths[0];
      const viewL = grid.scrollLeft + frozenW;
      const viewR = grid.scrollLeft + grid.clientWidth;
      if (left < viewL) grid.scrollLeft = left - frozenW;
      else if (right > viewR) grid.scrollLeft = right - grid.clientWidth;
    }
  }

  function afterMove() {
    ensureVisible(sel.focus.r, sel.focus.c);
    render();
    grid.focus();
  }

  function move(dr, dc, extend) {
    sel = Core.moveDataSelection(sel, dr, dc, visibleRowIds, COL_COUNT, extend);
    afterMove();
  }

  grid.addEventListener('keydown', function (e) {
    if (editor.open) return;
    switch (e.key) {
      case 'ArrowUp': move(-1, 0, e.shiftKey); e.preventDefault(); break;
      case 'ArrowDown': move(1, 0, e.shiftKey); e.preventDefault(); break;
      case 'ArrowLeft': move(0, -1, e.shiftKey); e.preventDefault(); break;
      case 'ArrowRight': move(0, 1, e.shiftKey); e.preventDefault(); break;
      case 'Tab':
        sel = Core.tabNextData(sel, visibleRowIds, COL_COUNT, e.shiftKey);
        afterMove();
        e.preventDefault();
        break;
      case 'Enter':
        openEditor();
        e.preventDefault();
        break;
      case 'Escape':
        sel = Core.createDataSelection(sel.focus.r, sel.focus.c);
        render();
        break;
    }
  });

  canvas.addEventListener('click', function (e) {
    if (e.target.closest('.group-header') || e.target.closest('.resize-handle')) return;
    const cell = e.target.closest('.cell');
    if (!cell || headerEl.contains(cell)) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (isNaN(r) || isNaN(c)) return;
    if (editor.open && editor.r === r && editor.c === c) return;
    sel = Core.createDataSelection(r, c);
    render();
    grid.focus();
  });

  canvas.addEventListener('dblclick', function (e) {
    const cell = e.target.closest('.cell');
    if (!cell || headerEl.contains(cell)) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (isNaN(r) || isNaN(c)) return;
    sel = Core.createDataSelection(r, c);
    openEditor();
  });

  document.addEventListener('copy', function (e) {
    if (editor.open || document.activeElement !== grid) return;
    e.clipboardData.setData('text/plain', Core.toTSV(data, sel));
    e.preventDefault();
  });

  function mountEditor(rowEl) {
    if (!rowEl || !editor.input) return;
    const cell = rowEl.children[editor.c];
    cell.classList.add('editing');
    cell.appendChild(editor.input);
  }

  function openEditor() {
    if (!visibleRowIds.length || editor.open) return;
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
      if (editor.commitOnBlur) {
        editor.commitOnBlur = false;
        commitEditor();
        render();
        grid.focus();
      }
    });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      const composing = editor.composing || e.isComposing;
      const action = Core.editorKeyAction(e.key, composing);
      if (action === 'none') return;
      e.preventDefault();
      if (action === 'cancel') {
        cancelEditor();
        render();
        grid.focus();
        return;
      }
      commitEditor();
      if (action === 'commit-tab') sel = Core.tabNextData(sel, visibleRowIds, COL_COUNT, e.shiftKey);
      else if (action === 'commit-up') sel = Core.moveDataSelection(sel, -1, 0, visibleRowIds, COL_COUNT, false);
      else if (action === 'commit-down') sel = Core.moveDataSelection(sel, 1, 0, visibleRowIds, COL_COUNT, false);
      else if (action === 'commit-left') sel = Core.moveDataSelection(sel, 0, -1, visibleRowIds, COL_COUNT, false);
      else if (action === 'commit-right') sel = Core.moveDataSelection(sel, 0, 1, visibleRowIds, COL_COUNT, false);
      afterMove();
    });
    input.addEventListener('blur', function () {
      if (!editor.open) return;
      if (editor.suspendBlur) return;
      if (editor.composing) {
        editor.commitOnBlur = true;
        return;
      }
      commitEditor();
      render();
    });
  }

  /* Column resizing changes CSS dimensions only. Rows are not rebuilt, which
     keeps a cell input mounted and lets an IME composition continue. */
  headerEl.addEventListener('pointerdown', function (e) {
    const handle = e.target.closest('.resize-handle');
    if (!handle) return;
    e.preventDefault();
    const c = Number(handle.dataset.c);
    const startX = e.clientX;
    const startWidth = widths[c];
    document.body.classList.add('resizing-columns');

    function onMove(ev) {
      widths = Core.resizeColumn(widths, c, ev.clientX - startX, Core.MIN_COL_WIDTH);
      if (widths[c] === startWidth) return;
      relayoutVisibleRows();
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.classList.remove('resizing-columns');
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  window.addEventListener('resize', function () {
    if (groupedView) renderGroupBar();
  });

  populateControls();
  buildHeader();
  layoutCanvas();
  emptyEl.hidden = ROW_COUNT !== 0;
  render();
})();
