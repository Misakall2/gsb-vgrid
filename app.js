/* app.js - composition root.
 *
 * Wires the four previously entangled concerns into explicit layers:
 *
 *   viewport.js       which slice is rendered + DOM recycling (scroll loop)
 *      ^ notifications rowsRecycled(rowIds) / rowsMounted(rowEls)
 *      |
 *   selection-layer.js   selection as data (anchor/focus/rowIds); paints rows
 *   editor.js            open editor + its own IME composition session
 *
 *   composition.js   pure IME state machine (no scroll flag near it)
 *   freeze.js        one column coordinate system: header/frozen col/editor
 *   grid-core.js     unchanged pure data/selection/layout math
 *
 * Nothing reaches for recycled DOM: recycling is pushed by the viewport.
 */
/* global GridCore, VGridViewport, VGridSelection, VGridFreeze, VGridEditor, VGridComposition */
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
  let currentRowLayout = null;
  const rowHeights = {};

  const freeze = window.VGridFreeze.createFreezeLayer({
    columns: COLUMNS,
    headerEl: headerEl,
    onResize: function () { relayoutVisibleRows(); },
  });

  const selection = window.VGridSelection.createSelectionLayer({
    colCount: function () { return COL_COUNT; },
    getVisibleRowIds: function () { return visibleRowIds; },
    initialSelection: ROW_COUNT ? Core.createDataSelection(0, 0) : undefined,
    onChange: function () {},
  });

  function visibleDataHeight() {
    const measured = Object.keys(rowHeights).filter(function (id) {
      return filteredRowIds.indexOf(Number(id)) !== -1;
    }).reduce(function (sum, id) {
      return sum + (rowHeights[id] - ROW_H);
    }, 0);
    return filteredRowIds.length * ROW_H + measured;
  }

  function ungroupedLayout(scrollTop) {
    return Core.variableRowLayout({
      rowIds: filteredRowIds,
      rowHeights: rowHeights,
      scrollTop: scrollTop == null ? grid.scrollTop : scrollTop,
      viewportHeight: grid.clientHeight,
    });
  }

  function resetScrollToStart() {
    grid.scrollTop = 0;
    grid.scrollLeft = 0;
  }

  function clampScrollPosition() {
    const maxScrollTop = Math.max(0, canvas.offsetHeight - grid.clientHeight);
    const maxScrollLeft = Math.max(0, canvas.offsetWidth - grid.clientWidth);
    if (grid.scrollTop > maxScrollTop) grid.scrollTop = maxScrollTop;
    if (grid.scrollLeft > maxScrollLeft) grid.scrollLeft = maxScrollLeft;
  }

  function findRowInGroups(rowId) {
    if (!groupedView) return null;
    for (const group of groupedView.groups) {
      const rowIndex = group.rowIds.indexOf(rowId);
      if (rowIndex !== -1) return { group: group, rowIndex: rowIndex };
    }
    return null;
  }

  function rowTopForId(rowId) {
    if (groupColumn != null) {
      const found = findRowInGroups(rowId);
      return found ? found.group.rowTop(found.rowIndex) : 0;
    }
    if (currentRowLayout) {
      const index = filteredRowIds.indexOf(rowId);
      if (index !== -1 && currentRowLayout.tops[index] != null) {
        return currentRowLayout.tops[index];
      }
    }
    const index = filteredRowIds.indexOf(rowId);
    return index === -1 ? 0 : index * ROW_H;
  }

  function layoutCanvas() {
    canvas.style.width = freeze.totalWidth() + 'px';
    canvas.style.height = (HEADER_H + visibleDataHeight()) + 'px';
    headerEl.style.width = freeze.totalWidth() + 'px';
  }

  /* ================= cell editor ================= */

  const editor = window.VGridEditor.createCellEditor({
    grid: grid,
    geometry: function (cell) {
      const top = rowTopForId(cell.r);
      const height = Core.rowHeightAt(rowHeights, cell.r, ROW_H);
      return freeze.editorBox(cell.c, grid, HEADER_H + top, height);
    },
    hooks: {
      onCommit: function (result, action, shiftKey) {
        data[result.r][result.c] = result.value;
        if (action === 'commit-tab') selection.tab(shiftKey);
        else if (action === 'commit-up') selection.move(-1, 0, false);
        else if (action === 'commit-down') selection.move(1, 0, false);
        else if (action === 'commit-left') selection.move(0, -1, false);
        else if (action === 'commit-right') selection.move(0, 1, false);
        afterMove();
      },
      onCancel: function () {
        renderAll();
        grid.focus();
      },
      onBlurCommit: function (result) {
        data[result.r][result.c] = result.value;
        renderAll();
      },
    },
  });

  /* ================= viewport node builders ================= */

  function buildCell(rowId, c) {
    const cell = document.createElement('div');
    cell.className = 'cell' + (c === 0 ? ' sticky' : '');
    cell.dataset.r = rowId;
    cell.dataset.c = c;
    freeze.applyCellLayout(cell, c);
    return cell;
  }

  function paintCellContent(cell, rowId, c) {
    cell.dataset.r = rowId;
    cell.dataset.c = c;
    cell.textContent = data[rowId][c];
    const sel = selection.get();
    cell.classList.toggle('selected', Core.isSelected(sel, rowId, c));
    cell.classList.toggle('active', sel.focus.r === rowId && sel.focus.c === c);
  }

  function buildRowElement(item) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    for (let c = 0; c < COL_COUNT; c++) rowEl.appendChild(buildCell(item.key, c));
    return rowEl;
  }

  function updateRowElement(rowEl, item) {
    const rowId = item.key;
    const isUnmeasured = !Object.prototype.hasOwnProperty.call(rowHeights, rowId);
    const height = isUnmeasured ? ROW_H : Core.rowHeightAt(rowHeights, rowId, ROW_H);
    rowEl.style.top = (HEADER_H + item.top) + 'px';
    rowEl.style.width = freeze.totalWidth() + 'px';
    rowEl.style.height = height + 'px';
    rowEl.dataset.rowHeight = String(height);
    if (isUnmeasured) rowEl.dataset.measuring = '1';
    for (let c = 0; c < rowEl.children.length; c++) {
      freeze.applyCellLayout(rowEl.children[c], c);
      paintCellContent(rowEl.children[c], rowId, c);
    }
  }

  function appendGroupToggle(el, key) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'group-toggle';
    button.textContent = collapsed.has(key) ? '▶' : '▼';
    button.addEventListener('mousedown', function (e) { e.preventDefault(); });
    button.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleGroup(key);
    });
    el.appendChild(button);
  }

  function buildGroupElement(item) {
    const group = groupedView.groups[item.groupIndex];
    const el = document.createElement('div');
    el.className = 'group-header';
    el.style.top = (HEADER_H + item.top) + 'px';
    el.style.width = 'max(' + freeze.totalWidth() + 'px, 100%)';
    el.dataset.key = group.key;
    appendGroupToggle(el, group.key);
    const label = document.createElement('span');
    label.textContent = group.key + ' · ' + group.count + ' 行';
    el.appendChild(label);
    return el;
  }

  /* Persisted group headers must refresh collapse state/count/width. */
  function updateGroupElement(el, item) {
    const group = groupedView.groups[item.groupIndex];
    el.style.top = (HEADER_H + item.top) + 'px';
    el.style.width = 'max(' + freeze.totalWidth() + 'px, 100%)';
    const button = el.querySelector('.group-toggle');
    if (button) button.textContent = group.collapsed ? '▶' : '▼';
    const label = el.querySelector('span');
    if (label) label.textContent = group.key + ' · ' + group.count + ' 行';
  }

  /* ================= virtual viewport ================= */

  const viewport = window.VGridViewport.createViewport({
    grid: grid,
    canvas: canvas,
    computeLayout: computeWindowItems,
    buildRow: buildRowElement,
    updateRow: updateRowElement,
    buildGroup: buildGroupElement,
    updateGroup: updateGroupElement,
    onMeasuredHeights: function (rowId, measuredHeight) {
      if (rowHeights[rowId] === measuredHeight) return false;
      rowHeights[rowId] = measuredHeight;
      return true;
    },
    onMeasurementsChanged: function () { layoutCanvas(); },
    /* Runs after every viewport render, including the rAF-driven one after a
     * scroll event: this is the same point at which the old single render()
     * did its scroll clamping / empty-state bookkeeping. */
    afterRender: afterViewportRender,
  });
  /* Recycling is pushed, never pulled: selection state survives destroyed
   * ids untouched; the editor relocates from the geometry callback. */
  viewport.subscribe(selection);
  viewport.subscribe(editor);

  /* Translate the current model into viewport items. The viewport stays
   * ignorant of filtering/grouping/data semantics. */
  function computeWindowItems() {
    const items = [];
    if (groupColumn == null) {
      currentRowLayout = ungroupedLayout();
      for (let r = currentRowLayout.start; r < currentRowLayout.end; r++) {
        const rowId = filteredRowIds[r];
        items.push({ kind: 'row', key: rowId, top: currentRowLayout.tops[r] });
      }
      return { items: items };
    }
    groupedView = Core.visibleGroupedRows({
      groups: groups,
      collapsed: collapsed,
      rowHeights: rowHeights,
      scrollTop: grid.scrollTop,
      viewportHeight: grid.clientHeight,
    });
    for (const item of groupedView.items) {
      if (item.type === 'group') {
        items.push({
          kind: 'group',
          key: 'group:' + item.key,
          groupIndex: item.group,
          top: item.top,
        });
      } else {
        items.push({ kind: 'row', key: item.rowId, top: item.top });
      }
    }
    return { items: items };
  }

  function renderGroupBar() {
    if (!groupedView || !groupedView.currentGroup) {
      groupBar.hidden = true;
      groupBar.replaceChildren();
      return;
    }
    const group = groupedView.currentGroup;
    groupBar.hidden = false;
    groupBar.style.width = Math.max(freeze.totalWidth(), grid.clientWidth) + 'px';
    groupBar.replaceChildren();
    appendGroupToggle(groupBar, group.key);
    const label = document.createElement('span');
    label.textContent = group.key + ' · ' + group.count + ' 行';
    groupBar.appendChild(label);
  }

  function updateStatus() {
    const n = Core.normalizeSelection(selection.get());
    const sel = selection.get();
    const rows = (sel.rowIds || []).length || (visibleRowIds.length ? 1 : 0);
    const cols = n.c2 - n.c1 + 1;
    statusEl.textContent = visibleRowIds.length.toLocaleString() + ' / ' +
      ROW_COUNT.toLocaleString() + ' 行' +
      (visibleRowIds.length ? ' · 选区 ' + rows + ' 行 × ' + cols + ' 列' : '');
  }

  /* Full render after structural changes (filter/group/measurement loop). */
  function renderAll() {
    layoutCanvas();
    viewport.render();
    /* group bar / editor / scroll clamping / empty state are all handled in
     * afterViewportRender, so scroll-driven renders get the same treatment. */
  }

  function afterViewportRender() {
    renderGroupBar();
    if (editor.isOpen()) editor.reposition();
    clampScrollPosition();
    /* No data at all: both scrollbars must collapse to zero even if the
     * canvas still carries the fixed column width. */
    if (!visibleRowIds.length) {
      grid.scrollTop = 0;
      grid.scrollLeft = 0;
    }
    emptyEl.hidden = visibleRowIds.length !== 0;
    emptyEl.textContent = ROW_COUNT === 0 ? '暂无成交数据' : '没有符合筛选条件的数据';
    updateStatus();
  }

  /* Width-only relayout while dragging a column resize handle. */
  function relayoutVisibleRows() {
    layoutCanvas();
    freeze.relayoutHeaderCells();
    viewport.rowNodes.forEach(function (rowEl) {
      rowEl.style.width = freeze.totalWidth() + 'px';
    });
    viewport.render();
    if (groupedView) renderGroupBar();
    if (editor.isOpen()) editor.reposition();
  }

  /* ================= model changes ================= */

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
    selection.reconcile(visibleRowIds);
    if (!preserveScroll) resetScrollToStart();
    renderAll();
  }

  function toggleGroup(key) {
    if (editor.isComposing()) return;
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    rebuildModel({ preserveScroll: true });
  }

  function populateControls() {
    COLUMNS.forEach(function (col, i) {
      filterColumnEl.appendChild(new Option(col.title, String(i)));
      groupColumnEl.appendChild(new Option(col.title, String(i)));
    });
    filterColumnEl.value = String(filterColumn);
  }

  /* Filter input uses its own composition session: provisional pinyin never
   * filters; only compositionend (and non-IME input) rebuilds the model. */
  const filterIme = window.VGridComposition.createCompositionSession();
  window.VGridComposition.bindComposition(filterInput, filterIme, function () {
    filterKeyword = filterInput.value.trim();
    rebuildModel();
  });

  filterColumnEl.addEventListener('change', function () {
    if (editor.isComposing()) return;
    filterColumn = Number(filterColumnEl.value);
    filterKeyword = filterInput.value.trim();
    rebuildModel();
  });
  filterInput.addEventListener('input', function () {
    if (filterIme.isComposing()) return;
    filterKeyword = filterInput.value.trim();
    rebuildModel();
  });
  clearFilterEl.addEventListener('click', function () {
    if (editor.isComposing()) return;
    filterInput.value = '';
    filterKeyword = '';
    filterInput.focus();
    rebuildModel();
  });
  groupColumnEl.addEventListener('change', function () {
    if (editor.isComposing()) return;
    if (editor.isOpen()) {
      const result = editor.close(true);
      if (result) data[result.r][result.c] = result.value;
    }
    groupColumn = groupColumnEl.value === '' ? null : Number(groupColumnEl.value);
    rebuildModel();
  });
  clearGroupEl.addEventListener('click', function () {
    if (editor.isComposing()) return;
    if (editor.isOpen()) {
      const result = editor.close(true);
      if (result) data[result.r][result.c] = result.value;
    }
    groupColumn = null;
    groupColumnEl.value = '';
    rebuildModel();
  });

  /* ================= navigation ================= */

  function ensureVisible(rowId, c) {
    let top = 0;
    let height = ROW_H;
    if (groupColumn != null) {
      const found = findRowInGroups(rowId);
      if (!found) return;
      top = found.group.rowTop(found.rowIndex);
      height = found.group.rowHeightAt(found.rowIndex);
    } else {
      if (filteredRowIds.indexOf(rowId) === -1) return;
      top = rowTopForId(rowId);
      height = Core.rowHeightAt(rowHeights, rowId, ROW_H);
    }
    const bottom = top + height;
    const viewTop = grid.scrollTop;
    const viewBottom = grid.scrollTop + grid.clientHeight - HEADER_H;
    if (top < viewTop) grid.scrollTop = top - GROUP_H;
    else if (bottom > viewBottom) grid.scrollTop = bottom - (grid.clientHeight - HEADER_H);
    freeze.ensureColumnVisible(c, grid);
  }

  function afterMove() {
    const focus = selection.get().focus;
    ensureVisible(focus.r, focus.c);
    renderAll();
    grid.focus();
  }

  function move(dr, dc, extend) {
    selection.move(dr, dc, extend);
    afterMove();
  }

  function openEditor() {
    if (!visibleRowIds.length || editor.isOpen()) return;
    const focus = selection.get().focus;
    ensureVisible(focus.r, focus.c);
    renderAll();
    editor.open(focus.r, focus.c, data[focus.r][focus.c]);
  }

  grid.addEventListener('keydown', function (e) {
    if (editor.isOpen()) return;
    switch (e.key) {
      case 'ArrowUp': move(-1, 0, e.shiftKey); e.preventDefault(); break;
      case 'ArrowDown': move(1, 0, e.shiftKey); e.preventDefault(); break;
      case 'ArrowLeft': move(0, -1, e.shiftKey); e.preventDefault(); break;
      case 'ArrowRight': move(0, 1, e.shiftKey); e.preventDefault(); break;
      case 'Tab':
        selection.tab(e.shiftKey);
        afterMove();
        e.preventDefault();
        break;
      case 'Enter':
        openEditor();
        e.preventDefault();
        break;
      case 'Escape':
        selection.collapseToFocus();
        renderAll();
        break;
    }
  });

  canvas.addEventListener('click', function (e) {
    if (e.target.closest('.group-header') || e.target.closest('.resize-handle')) return;
    if (editor.isComposing()) return;
    const cell = e.target.closest('.cell');
    if (!cell || headerEl.contains(cell)) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (isNaN(r) || isNaN(c)) return;
    if (editor.isOpen() && editor.cell().r === r && editor.cell().c === c) return;
    selection.select(r, c);
    renderAll();
    grid.focus();
  });

  canvas.addEventListener('dblclick', function (e) {
    if (editor.isComposing()) return;
    const cell = e.target.closest('.cell');
    if (!cell || headerEl.contains(cell)) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (isNaN(r) || isNaN(c)) return;
    selection.select(r, c);
    openEditor();
  });

  document.addEventListener('copy', function (e) {
    if (editor.isOpen() || document.activeElement !== grid) return;
    e.clipboardData.setData('text/plain', Core.toTSV(data, selection.get()));
    e.preventDefault();
  });

  /* IME guard: pointer elsewhere during composition is swallowed and focus
   * is returned to the composing input. */
  document.addEventListener('mousedown', function (e) {
    editor.guardExternalPointer(e);
  }, true);

  freeze.bindColumnResize(grid);

  window.addEventListener('resize', function () {
    if (groupedView) renderGroupBar();
  });

  populateControls();
  freeze.buildHeader();
  layoutCanvas();
  emptyEl.hidden = ROW_COUNT !== 0;
  renderAll();
})();
