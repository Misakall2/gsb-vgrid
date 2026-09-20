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
  let columns = COLUMNS.map(function (col) { return { title: col.title, width: col.width }; });
  let layout = Core.columnLayout(columns);
  const TOTAL_WIDTH = layout.totalWidth;

  // ?rows=0 / ?rows=1 give reproducible empty / single-row states.
  const params = new URLSearchParams(location.search);
  const parsed = parseInt(params.get('rows') || '10000', 10);
  const ROW_COUNT = isNaN(parsed) || parsed < 0 ? 0 : parsed;

  const data = Core.generateData(ROW_COUNT);

  const grid = document.getElementById('grid');
  const canvas = document.getElementById('canvas');
  const headerEl = document.getElementById('header');
  const emptyEl = document.getElementById('empty');
  const statusEl = document.getElementById('status');
  const groupColumnEl = document.getElementById('group-column');
  const filterColumnEl = document.getElementById('filter-column');
  const filterKeywordEl = document.getElementById('filter-keyword');
  const clearFilterEl = document.getElementById('clear-filter');
  const groupBandEl = document.getElementById('group-band');
  const groupToggleEl = document.getElementById('group-toggle');
  const groupTitleEl = document.getElementById('group-title');
  const groupCountEl = document.getElementById('group-count');
  const groupPickerEl = document.getElementById('group-picker');

  let sel = Core.createSelection(0, 0);
  const rowEls = new Map(); // rowIndex -> element, only for rendered rows
  let filteredRowIds = data.map(function (_, r) { return r; });
  let groupColumn = -1;
  let groups = [];
  let groupIndexByRowId = new Map();
  let visibleRowIds = filteredRowIds.slice();
  const collapsedGroups = new Set();
  let filterActive = false;

  const editor = {
    open: false,
    r: 0,
    c: 0,
    input: null,
    composing: false,
    commitOnBlur: false,
    suspended: false,
  };

  function colLeft(c) {
    return layout.lefts[c];
  }

  function buildHeader() {
    headerEl.style.width = layout.totalWidth + 'px';
    headerEl.innerHTML = '';
    columns.forEach(function (col, i) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (i === 0 ? ' sticky' : '');
      cell.style.width = col.width + 'px';
      cell.textContent = col.title;
      cell.dataset.c = i;
      if (i < COL_COUNT - 1) {
        const handle = document.createElement('span');
        handle.className = 'col-resizer';
        handle.dataset.col = i;
        handle.title = '拖动调整列宽';
        cell.appendChild(handle);
      }
      headerEl.appendChild(cell);
    });
  }

  function buildRow(r) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    const viewIndex = visibleRowIds.indexOf(r);
    rowEl.style.top = (groupedTopOffset() + viewIndex * ROW_H) + 'px';
    rowEl.style.width = layout.totalWidth + 'px';
    rowEl.dataset.dataRow = r;
    for (let c = 0; c < COL_COUNT; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (c === 0 ? ' sticky' : '');
      cell.style.width = columns[c].width + 'px';
      cell.textContent = data[r][c];
      cell.dataset.r = r;
      cell.dataset.c = c;
      if (Core.isSelected(sel, r, c)) cell.classList.add('selected');
      if (sel.focus.r === r && sel.focus.c === c) cell.classList.add('active');
      rowEl.appendChild(cell);
    }
    return rowEl;
  }

  function groupedTopOffset() {
    return groups.length ? Core.GROUP_H : 0;
  }

  function updateGroupHeader() {
    if (!groups.length || ROW_COUNT === 0) {
      groupBandEl.hidden = true;
      return;
    }
    let idx = Core.currentGroupIndex({
      rowIds: visibleRowIds,
      groupIndexByRowId: groupIndexByRowId,
      scrollTop: grid.scrollTop,
      topOffset: Core.GROUP_H,
    });
    if (idx < 0) idx = Number(groupPickerEl.value) || 0;
    const group = groups[idx];
    groupBandEl.hidden = false;
    groupBandEl.style.width = layout.totalWidth + 'px';
    groupToggleEl.textContent = collapsedGroups.has(group.key) ? '+' : '−';
    groupToggleEl.dataset.groupIndex = idx;
    groupTitleEl.textContent = columns[groupColumn].title + ': ' + group.key;
    groupCountEl.textContent = group.count + ' 条';
    groupPickerEl.innerHTML = '';
    groups.forEach(function (g, i) {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = (collapsedGroups.has(g.key) ? '+ ' : '- ') + g.key + ' (' + g.count + ')';
      groupPickerEl.appendChild(option);
    });
    groupPickerEl.value = String(idx);
  }

  function render() {
    const range = Core.visibleRange({
      scrollTop: grid.scrollTop,
      viewportHeight: grid.clientHeight,
      rowCount: visibleRowIds.length,
      topOffset: groupedTopOffset(),
    });
    // Recycle: drop every rendered row, rebuild only the visible window.
    // The selection is pure data, so highlights reappear on rebuild.
    if (editor.open && !editor.suspended) suspendEditor();
    rowEls.forEach(function (el) { el.remove(); });
    rowEls.clear();
    for (let i = range.start; i < range.end; i++) {
      const dataRow = visibleRowIds[i];
      const rowEl = buildRow(dataRow);
      canvas.appendChild(rowEl);
      rowEls.set(dataRow, rowEl);
    }
    if (editor.open) {
      const rowEl = rowEls.get(editor.r);
      if (rowEl) {
        restoreEditor(rowEl);
      } else {
        editor.suspended = true;
      }
    }
    canvas.style.height = (Core.HEADER_H + groupedTopOffset() + visibleRowIds.length * ROW_H) + 'px';
    updateGroupHeader();
    emptyEl.hidden = visibleRowIds.length !== 0;
    emptyEl.textContent = ROW_COUNT === 0 ? '暂无成交数据' : '没有匹配的数据';
    updateStatus();
  }

  function clampScrollToContent() {
    const maxScrollTop = Math.max(0, canvas.offsetHeight - grid.clientHeight);
    if (grid.scrollTop > maxScrollTop) grid.scrollTop = maxScrollTop;
    const maxScrollLeft = Math.max(0, layout.totalWidth - grid.clientWidth);
    if (grid.scrollLeft > maxScrollLeft) grid.scrollLeft = maxScrollLeft;
  }

  function applyView() {
    const keyword = filterKeywordEl.value.trim();
    const filters = keyword ? [{ columnIndex: Number(filterColumnEl.value), keyword: keyword }] : [];
    filteredRowIds = Core.filterRows(data, filters);
    filterActive = Boolean(keyword);
    groupColumn = Number(groupColumnEl.value);
    const grouped = Core.groupRows(filteredRowIds, data, groupColumn, collapsedGroups);
    groups = grouped.groups;
    groupIndexByRowId = grouped.groupIndexByRowId;
    visibleRowIds = grouped.visibleRowIds;
    clampScrollToContent();
    if (editor.open && visibleRowIds.indexOf(editor.r) !== -1) ensureVisible(editor.r, editor.c);
    render();
  }

  function updateStatus() {
    const n = Core.normalizeSelection(sel);
    const rows = n.r2 - n.r1 + 1;
    const cols = n.c2 - n.c1 + 1;
    const parts = [visibleRowIds.length.toLocaleString() + ' / ' + ROW_COUNT.toLocaleString() + ' 行'];
    if (groups.length) parts.push(groups.length + ' 组');
    if (filterActive) parts.push('已筛选');
    if (visibleRowIds.length) parts.push('选区 ' + rows + ' 行 × ' + cols + ' 列');
    statusEl.textContent = parts.join(' · ');
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
    const viewIndex = visibleRowIds.indexOf(r);
    if (viewIndex === -1) return;
    const top = HEADER_H + groupedTopOffset() + viewIndex * ROW_H;
    const bottom = top + ROW_H;
    const viewTop = grid.scrollTop + HEADER_H + groupedTopOffset();
    const viewBottom = grid.scrollTop + grid.clientHeight;
    if (top < viewTop) grid.scrollTop = top - HEADER_H - groupedTopOffset();
    else if (bottom > viewBottom) grid.scrollTop = bottom - grid.clientHeight;

    if (c > 0) { // column 0 is frozen, always visible
      const left = colLeft(c);
      const right = left + columns[c].width;
      const frozenW = columns[0].width;
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
    sel = Core.moveVisibleFocus(sel, dr, dc, visibleRowIds, COL_COUNT, extend);
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
        sel = Core.tabNextVisible(sel, visibleRowIds, COL_COUNT, e.shiftKey);
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
    e.clipboardData.setData('text/plain', Core.toTSV(data, sel, visibleRowIds));
    e.preventDefault();
  });

  /* ---------- cell editor ---------- */

  function mountEditor(rowEl) {
    if (!rowEl || !editor.input) return;
    const cell = rowEl.children[editor.c];
    cell.classList.add('editing');
    cell.appendChild(editor.input);
  }

  function suspendEditor() {
    if (!editor.open || editor.suspended || !editor.input) return;
    editor.suspended = true;
    if (editor.input.parentElement) editor.input.parentElement.classList.remove('editing');
    document.body.appendChild(editor.input);
  }

  function restoreEditor(rowEl) {
    mountEditor(rowEl);
    editor.suspended = false;
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
    editor.suspended = false;
    const input = document.createElement('input');
    input.className = 'editor';
    input.value = data[r][c];
    editor.input = input;
    bindEditorEvents(input);
    restoreEditor(rowEls.get(r));
    input.focus();
    input.select();
  }

  function commitEditor() {
    if (!editor.open) return;
    data[editor.r][editor.c] = editor.input.value;
    editor.open = false;
    editor.composing = false;
    editor.commitOnBlur = false;
    editor.suspended = false;
    editor.input.remove();
    editor.input = null;
  }

  function cancelEditor() {
    if (!editor.open) return;
    editor.open = false;
    editor.composing = false;
    editor.commitOnBlur = false;
    editor.suspended = false;
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
      if (action === 'commit-tab') sel = Core.tabNextVisible(sel, visibleRowIds, COL_COUNT, e.shiftKey);
      else if (action === 'commit-up') sel = Core.moveVisibleFocus(sel, -1, 0, visibleRowIds, COL_COUNT, false);
      else if (action === 'commit-down') sel = Core.moveVisibleFocus(sel, 1, 0, visibleRowIds, COL_COUNT, false);
      else if (action === 'commit-left') sel = Core.moveVisibleFocus(sel, 0, -1, visibleRowIds, COL_COUNT, false);
      else if (action === 'commit-right') sel = Core.moveVisibleFocus(sel, 0, 1, visibleRowIds, COL_COUNT, false);
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

  function buildToolbar() {
    columns.forEach(function (col, i) {
      const groupOption = document.createElement('option');
      groupOption.value = i;
      groupOption.textContent = col.title;
      groupColumnEl.appendChild(groupOption);

      const filterOption = document.createElement('option');
      filterOption.value = i;
      filterOption.textContent = col.title;
      filterColumnEl.appendChild(filterOption);
    });
    filterColumnEl.value = '2';
  }

  function finishEditingBeforeViewChange() {
    if (editor.open) {
      commitEditor();
      grid.focus();
    }
  }

  groupColumnEl.addEventListener('change', function () {
    applyView();
  });

  filterColumnEl.addEventListener('change', function () {
    if (!filterKeywordEl.value) return;
    finishEditingBeforeViewChange();
    applyView();
  });

  filterKeywordEl.addEventListener('compositionstart', function () {
    filterKeywordEl.dataset.composing = '1';
  });
  filterKeywordEl.addEventListener('compositionend', function () {
    filterKeywordEl.dataset.composing = '0';
    finishEditingBeforeViewChange();
    applyView();
  });
  filterKeywordEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && filterKeywordEl.dataset.composing !== '1') {
      finishEditingBeforeViewChange();
      applyView();
      e.preventDefault();
    }
  });
  filterKeywordEl.addEventListener('change', function () {
    if (filterKeywordEl.dataset.composing === '1') return;
    finishEditingBeforeViewChange();
    applyView();
  });

  clearFilterEl.addEventListener('click', function () {
    filterKeywordEl.value = '';
    finishEditingBeforeViewChange();
    applyView();
    filterKeywordEl.focus();
  });

  groupToggleEl.addEventListener('mousedown', function (e) {
    e.preventDefault();
  });
  function toggleGroup(idx) {
    const group = groups[idx];
    if (!group) return;
    if (collapsedGroups.has(group.key)) collapsedGroups.delete(group.key);
    else collapsedGroups.add(group.key);
    applyView();
  }
  groupToggleEl.addEventListener('click', function () {
    toggleGroup(Number(groupToggleEl.dataset.groupIndex));
    grid.focus();
  });
  groupPickerEl.addEventListener('change', function () {
    toggleGroup(Number(groupPickerEl.value));
    grid.focus();
  });

  function applyColumnWidths() {
    layout = Core.columnLayout(columns);
    canvas.style.width = layout.totalWidth + 'px';
    headerEl.style.width = layout.totalWidth + 'px';
    groupBandEl.style.width = layout.totalWidth + 'px';
    Array.prototype.forEach.call(headerEl.children, function (cell) {
      if (cell.classList && cell.classList.contains('cell')) {
        const c = Number(cell.dataset.c);
        if (!Number.isNaN(c)) cell.style.width = columns[c].width + 'px';
      }
    });
    Array.from(rowEls.values()).forEach(function (row) {
      row.style.width = layout.totalWidth + 'px';
      for (let c = 0; c < COL_COUNT; c++) {
        if (row.children[c]) row.children[c].style.width = columns[c].width + 'px';
      }
    });
  }

  headerEl.addEventListener('pointerdown', function (e) {
    const handle = e.target.closest('.col-resizer');
    if (!handle) return;
    const colIndex = Number(handle.dataset.col);
    const startX = e.clientX;
    const startWidth = columns[colIndex].width;
    const activeCell = document.activeElement;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();

    function onMove(ev) {
      columns = Core.resizeColumn(columns, colIndex, startWidth + ev.clientX - startX);
      applyColumnWidths();
      updateGroupHeader();
    }
    function onUp() {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.releasePointerCapture(e.pointerId);
      clampScrollToContent();
      if (activeCell && typeof activeCell.focus === 'function') activeCell.focus();
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });

  buildToolbar();
  buildHeader();
  canvas.style.width = TOTAL_WIDTH + 'px';
  canvas.style.height = (HEADER_H + ROW_COUNT * ROW_H) + 'px';
  emptyEl.hidden = ROW_COUNT !== 0;
  render();
})();
