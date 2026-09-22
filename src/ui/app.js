/* src/ui/app.js - application wiring: DOM collaborates through explicit state. */
/* global GridCore, GridView */
(function () {
  'use strict';

  const Core = window.GridCore;
  const View = window.GridView;
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
  const rowHeights = {};

  const selection = Core.createDataSelectionController(COL_COUNT);
  if (ROW_COUNT) selection.reset(0, 0);

  const planner = View.createViewportPlanner();
  planner.configureUngrouped(filteredRowIds, rowHeights);

  function getWidths() { return widths; }
  function getMetrics() { return metrics; }
  const frozenLayout = View.createFrozenLayout({
    getWidths: getWidths,
    getMetrics: getMetrics,
    getScrollLeft: function () { return grid.scrollLeft; },
  });
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

  const groupControls = {
    buildHeader: function (item, currentGroupedView, totalWidth) {
      const group = currentGroupedView.groups[item.group];
      const el = document.createElement('div');
      el.className = 'group-header';
      el.style.top = (HEADER_H + item.top) + 'px';
      el.style.width = 'max(' + totalWidth + 'px, 100%)';
      el.dataset.key = group.key;
      appendGroupToggle(el, group, group.key);
      const label = document.createElement('span');
      label.textContent = group.key + ' · ' + group.count + ' 行';
      el.appendChild(label);
      return el;
    },
  };

  const body = View.createBodyRenderer({
    canvas: canvas,
    columns: COLUMNS,
    data: data,
    rowHeights: rowHeights,
    selection: selection,
    frozenLayout: frozenLayout,
    beforeRowsRecycle: function (rowIds) {
      selection.rowsWillRecycle(rowIds);
      editor.rowsWillRecycle(rowIds);
    },
  });

  const header = View.createHeaderView({
    headerEl: headerEl,
    columns: COLUMNS,
    frozenLayout: frozenLayout,
  });

  const editor = View.createCellEditor({
    grid: grid,
    data: data,
    planner: planner,
    frozenLayout: frozenLayout,
    onCommitAction: handleEditorAction,
  });

  function colLeft(c) { return metrics.lefts[c]; }

  function visibleDataHeight() {
    const measured = Object.keys(rowHeights).filter(function (id) {
      return filteredRowIds.indexOf(Number(id)) !== -1;
    }).reduce(function (sum, id) {
      return sum + (rowHeights[id] - ROW_H);
    }, 0);
    return filteredRowIds.length * ROW_H + measured;
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

  function configurePlanner() {
    if (groups) planner.configureGrouped(groups, collapsed, rowHeights);
    else planner.configureUngrouped(filteredRowIds, rowHeights);
  }

  function visibleIdsFromGrouped(view) {
    return view.groups.reduce(function (ids, group) {
      return group.collapsed ? ids : ids.concat(group.rowIds);
    }, []);
  }

  function rebuildModel(options) {
    const preserveScroll = options && options.preserveScroll;
    filteredRowIds = Core.filterRows(data, [{ column: filterColumn, keyword: filterKeyword }]);
    groups = groupColumn == null ? null : Core.groupRows(data, filteredRowIds, groupColumn);
    if (groups) {
      const nextCollapsed = new Set();
      groups.forEach(function (group) {
        if (collapsed.has(group.key)) nextCollapsed.add(group.key);
      });
      collapsed = nextCollapsed;
      visibleRowIds = groups.reduce(function (ids, group) {
        return collapsed.has(group.key) ? ids : ids.concat(group.rowIds);
      }, []);
    } else {
      visibleRowIds = filteredRowIds;
    }
    configurePlanner();
    selection.reconcile(visibleRowIds);
    if (!preserveScroll) resetScrollToStart();
    layoutCanvas();
    render();
  }

  function toggleGroup(key) {
    if (editor.isComposing) return;
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

  filterColumnEl.addEventListener('change', function () {
    if (editor.isComposing) return;
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
    if (editor.isComposing) return;
    filterInput.value = '';
    filterKeyword = '';
    filterInput.focus();
    rebuildModel();
  });
  groupColumnEl.addEventListener('change', function () {
    if (editor.isComposing) return;
    if (editor.isOpen) editor.commit();
    groupColumn = groupColumnEl.value === '' ? null : Number(groupColumnEl.value);
    rebuildModel();
  });
  clearGroupEl.addEventListener('click', function () {
    if (editor.isComposing) return;
    if (editor.isOpen) editor.commit();
    groupColumn = null;
    groupColumnEl.value = '';
    rebuildModel();
  });

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
    const plan = planner.calculate(grid.scrollTop, grid.clientHeight);
    groupedView = plan.groupedView;
    if (groups) visibleRowIds = visibleIdsFromGrouped(groupedView);
    body.render(plan, groupControls);
    if (groupedView) renderGroupBar();
    const measured = body.measureRows();
    if (measured) {
      layoutCanvas();
      render();
      return;
    }
    if (editor.isOpen) editor.updatePosition();
    clampScrollPosition();
    if (!visibleRowIds.length) resetScrollToStart();
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
    header.layout();
    canvas.style.width = metrics.totalWidth + 'px';
    canvas.style.height = (HEADER_H + visibleDataHeight()) + 'px';
    body.layout();
    if (groupedView) renderGroupBar();
    const measured = body.measureRows();
    if (measured) render();
    else if (editor.isOpen) editor.updatePosition();
  }

  function updateStatus() {
    const current = selection.state;
    const n = Core.normalizeSelection(current);
    const rows = (current.rowIds || []).length || (visibleRowIds.length ? 1 : 0);
    const cols = n.c2 - n.c1 + 1;
    statusEl.textContent = visibleRowIds.length.toLocaleString() + ' / ' +
      ROW_COUNT.toLocaleString() + ' 行' +
      (visibleRowIds.length ? ' · 选区 ' + rows + ' 行 × ' + cols + ' 列' : '');
  }

  let ticking = false;
  grid.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      if (editor.isOpen) editor.handleViewportScroll();
      render();
    });
  });

  function ensureVisible(rowId, c) {
    let top = 0;
    let height = ROW_H;
    if (groupColumn != null) {
      const found = planner.findRowInGroups(rowId);
      if (!found) return;
      top = found.group.rowTop(found.rowIndex);
      height = found.group.rowHeightAt(found.rowIndex);
    } else {
      if (filteredRowIds.indexOf(rowId) === -1) return;
      top = planner.rowTopForId(rowId);
      height = Core.rowHeightAt(rowHeights, rowId, ROW_H);
    }
    const bottom = top + height;
    const viewTop = grid.scrollTop;
    const viewBottom = grid.scrollTop + grid.clientHeight - HEADER_H;
    if (top < viewTop) grid.scrollTop = top - GROUP_H;
    else if (bottom > viewBottom) {
      grid.scrollTop = bottom - (grid.clientHeight - HEADER_H);
    }

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
    const current = selection.state;
    ensureVisible(current.focus.r, current.focus.c);
    render();
    grid.focus();
  }

  function move(dr, dc, extend) {
    selection.move(dr, dc, visibleRowIds, extend);
    afterMove();
  }

  function openEditor() {
    if (!visibleRowIds.length) return;
    const current = selection.state;
    ensureVisible(current.focus.r, current.focus.c);
    render();
    editor.open(current.focus.r, current.focus.c);
  }

  function handleEditorAction(action, shiftKey) {
    if (action === 'cancel' || action === 'blur') {
      render();
      grid.focus();
      return;
    }
    if (action === 'commit-tab') selection.tab(visibleRowIds, shiftKey);
    else if (action === 'commit-up') selection.move(-1, 0, visibleRowIds, false);
    else if (action === 'commit-down') selection.move(1, 0, visibleRowIds, false);
    else if (action === 'commit-left') selection.move(0, -1, visibleRowIds, false);
    else if (action === 'commit-right') selection.move(0, 1, visibleRowIds, false);
    afterMove();
  }

  grid.addEventListener('keydown', function (e) {
    if (editor.isOpen) return;
    switch (e.key) {
      case 'ArrowUp': move(-1, 0, e.shiftKey); e.preventDefault(); break;
      case 'ArrowDown': move(1, 0, e.shiftKey); e.preventDefault(); break;
      case 'ArrowLeft': move(0, -1, e.shiftKey); e.preventDefault(); break;
      case 'ArrowRight': move(0, 1, e.shiftKey); e.preventDefault(); break;
      case 'Tab':
        selection.tab(visibleRowIds, e.shiftKey);
        afterMove();
        e.preventDefault();
        break;
      case 'Enter':
        openEditor();
        e.preventDefault();
        break;
      case 'Escape':
        selection.collapse();
        render();
        break;
    }
  });

  canvas.addEventListener('click', function (e) {
    if (e.target.closest('.group-header') || e.target.closest('.resize-handle')) return;
    if (editor.isComposing) return;
    const cell = e.target.closest('.cell');
    if (!cell || headerEl.contains(cell)) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (isNaN(r) || isNaN(c)) return;
    if (editor.isOpen && editor.rowId === r && editor.column === c) return;
    selection.reset(r, c);
    render();
    grid.focus();
  });

  canvas.addEventListener('dblclick', function (e) {
    if (editor.isComposing) return;
    const cell = e.target.closest('.cell');
    if (!cell || headerEl.contains(cell)) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (isNaN(r) || isNaN(c)) return;
    selection.reset(r, c);
    openEditor();
  });

  document.addEventListener('copy', function (e) {
    if (editor.isOpen || document.activeElement !== grid) return;
    e.clipboardData.setData('text/plain', selection.toTSV(data));
    e.preventDefault();
  });

  document.addEventListener('mousedown', function (e) {
    if (editor.shouldCaptureMousedown(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      editor.refocus();
    }
  }, true);

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
  header.build();
  layoutCanvas();
  emptyEl.hidden = ROW_COUNT !== 0;
  render();
})();
