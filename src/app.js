(() => {
  'use strict';

  const core = window.VGridCore;
  const gridEl = document.getElementById('grid');
  const statusEl = document.getElementById('status');
  const noteEl = document.getElementById('scenario-note');

  const columns = [
    { key: 'id', title: '订单号', width: core.FROZEN_COLUMN_WIDTH },
    { key: 'customer', title: '客户', width: 180 },
    { key: 'product', title: '商品', width: 230 },
    { key: 'category', title: '类目', width: 140 },
    { key: 'city', title: '城市', width: 130 },
    { key: 'owner', title: '销售员', width: 130 },
    { key: 'amount', title: '金额', width: 120 },
    { key: 'status', title: '状态', width: 100 },
    { key: 'time', title: '下单时间', width: 190 },
    { key: 'remark', title: '备注', width: 320 },
  ];

  const state = {
    model: core.createModel([], { columns }),
    selection: null,
    edit: null,
    pendingCellAfterComposition: null,
    scrollFrame: 0,
  };

  const canvasEl = document.createElement('div');
  canvasEl.className = 'canvas';
  gridEl.append(canvasEl);

  function makeRows(count) {
    const customers = ['青岚贸易', '北辰门店', '见山科技', '潮声零售', '木禾供应链', '星河电商'];
    const products = ['手冲咖啡豆', '办公椅', '冷链纸箱', '收银打印机', '陶瓷杯', '门店灯箱'];
    const categories = ['饮品', '家具', '包装', '设备', '日用', '陈列'];
    const cities = ['上海', '杭州', '深圳', '成都', '武汉', '西安'];
    const owners = ['林一', '周禾', '陈策', '许南', '高源', '唐宁'];
    const statuses = ['已付款', '待发货', '已完成', '退款中'];

    return Array.from({ length: count }, (_, row) => {
      const index = row + 1;
      const amount = ((row * 137.37) % 9000 + 199).toFixed(2);
      const day = String((row % 27) + 1).padStart(2, '0');
      const hour = String((row * 7) % 24).padStart(2, '0');
      const minute = String((row * 13) % 60).padStart(2, '0');
      return [
        `SO-${String(index).padStart(6, '0')}`,
        customers[row % customers.length],
        products[(row * 5) % products.length],
        categories[(row * 3) % categories.length],
        cities[(row * 11) % cities.length],
        owners[(row * 7) % owners.length],
        `¥${amount}`,
        statuses[row % statuses.length],
        `2026-09-${day} ${hour}:${minute}`,
        row % 23 === 0 ? '需要合并开票，仓库周六前送达' : '',
      ];
    });
  }

  function makeLongRows() {
    const longText = '这是一段用于验证横向裁切和长文本承载的成交备注。'.repeat(12);
    return [
      ['SO-LONG-000001', '超长客户名称' + '甲乙丙丁'.repeat(10), longText, '长文本', '上海', '林一', '¥99,999.00', '已完成', '2026-09-20 10:30', longText],
      makeRows(1)[0],
    ];
  }

  function loadScenario(name) {
    commitEditIfNeeded();
    let rows;
    let note;
    if (name === 'empty') {
      rows = [];
      note = '空表状态：没有数据行，横向表头仍可渲染，键盘动作不会产生越界焦点。';
    } else if (name === 'single') {
      rows = makeRows(1);
      note = '只有一行：上下方向键会停在边界，Tab 和选区不会越界。';
    } else if (name === 'long') {
      rows = makeLongRows();
      note = '超长单元格：文本在格内裁切，行高固定，横向滚动可继续查看后续列。';
    } else if (name === 'ime') {
      rows = makeRows(200);
      note = '已启动输入法复现：组字中的 Enter 和方向键不会提交，compositionend 后才落值。';
    } else if (name === 'fast') {
      rows = makeRows(10000);
      note = '快速连滚：渲染由 requestAnimationFrame 合并，滚动条尺寸始终等于完整数据尺寸。';
    } else {
      rows = makeRows(10000);
      note = '一万行状态：纵向和横向都使用虚拟窗口，回收的节点不影响数据层选区。';
    }

    state.model = core.createModel(rows, { columns });
    state.selection = state.model.rowCount
      ? core.normalizeSelection({ row: 0, col: 0 }, { row: 0, col: 0 })
      : null;
    state.edit = null;
    state.pendingCellAfterComposition = null;
    gridEl.scrollTop = 0;
    gridEl.scrollLeft = 0;
    gridEl.focus();
    render();
    noteEl.textContent = note;
    if (name === 'ime') window.setTimeout(runImeRepro, 50);
    if (name === 'fast') window.setTimeout(runFastScrollRepro, 50);
  }

  document.querySelectorAll('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => loadScenario(button.dataset.scenario));
  });

  function scheduleRender() {
    if (state.scrollFrame) return;
    state.scrollFrame = window.requestAnimationFrame(() => {
      state.scrollFrame = 0;
      render();
    });
  }

  gridEl.addEventListener('scroll', scheduleRender, { passive: true });

  function render() {
    const { model, selection, edit } = state;
    const viewportWidth = gridEl.clientWidth;
    const viewportHeight = gridEl.clientHeight;
    const totalWidth = core.getColumnTotalSize(model.widths);
    const totalHeight = model.rowCount * core.ROW_HEIGHT + core.HEADER_HEIGHT;
    canvasEl.style.width = `${Math.max(totalWidth, viewportWidth)}px`;
    canvasEl.style.height = `${Math.max(totalHeight, viewportHeight)}px`;

    const rowRange = core.getVisibleRange(
      gridEl.scrollTop - core.HEADER_HEIGHT,
      viewportHeight - core.HEADER_HEIGHT,
      model.rowCount * core.ROW_HEIGHT
    );
    const colRange = core.getColumnRange(gridEl.scrollLeft, viewportWidth, model.widths);

    renderHeader(model, colRange, totalWidth);
    renderBody(model, selection, rowRange, colRange, totalWidth);
    renderEmptyState(model, viewportHeight);
    positionEditor(edit);
    updateStatus();
  }

  function renderHeader(model, colRange, totalWidth) {
    let header = canvasEl.querySelector('.header-row');
    if (!header) {
      header = document.createElement('div');
      header.className = 'header-row';
      canvasEl.append(header);
    }
    header.style.width = `${totalWidth}px`;
    reconcileCells(header, getColumnsToRender(colRange), (cellEl, col) => {
      cellEl.className = `cell header-cell${col === 0 ? ' frozen' : ''}`;
      cellEl.style.width = `${model.widths[col]}px`;
      cellEl.style.transform = `translateX(${colRange.offsets[col]}px)`;
      cellEl.textContent = model.columns[col].title;
    });
  }

  function renderBody(model, selection, rowRange, colRange, totalWidth) {
    const rowIndexes = [];
    if (model.rowCount > 0 && rowRange.end >= rowRange.start) {
      for (let row = rowRange.start; row <= rowRange.end; row += 1) rowIndexes.push(row);
    }

    const columnIndexes = getColumnsToRender(colRange);
    const existingRows = new Map();
    canvasEl.querySelectorAll('.body-row').forEach((rowEl) => {
      existingRows.set(Number(rowEl.dataset.row), rowEl);
    });

    const wantedRows = new Set(rowIndexes);
    existingRows.forEach((rowEl, row) => {
      if (!wantedRows.has(row)) rowEl.remove();
    });

    rowIndexes.forEach((row) => {
      let rowEl = existingRows.get(row);
      if (!rowEl) {
        rowEl = document.createElement('div');
        rowEl.className = 'body-row';
        rowEl.dataset.row = String(row);
        canvasEl.append(rowEl);
      }
      rowEl.style.width = `${totalWidth}px`;
      rowEl.style.transform = `translateY(${core.HEADER_HEIGHT + row * core.ROW_HEIGHT}px)`;

      reconcileCells(rowEl, columnIndexes, (cellEl, col) => {
        const selected = core.isCellSelected(selection, row, col);
        const active = core.isActiveCell(selection, row, col);
        cellEl.className = [
          'cell',
          col === 0 ? 'frozen' : '',
          selected ? 'selected' : '',
          active ? 'active' : '',
        ].filter(Boolean).join(' ');
        cellEl.dataset.row = String(row);
        cellEl.dataset.col = String(col);
        cellEl.style.width = `${model.widths[col]}px`;
        cellEl.style.transform = `translateX(${colRange.offsets[col]}px)`;
        const value = core.getCellValue(model, row, col);
        cellEl.textContent = value;
        cellEl.title = value;
      });
    });
  }

  function getColumnsToRender(colRange) {
    if (colRange.end < colRange.start) return [0];
    const cols = [];
    if (colRange.start > 0) cols.push(0);
    for (let col = colRange.start; col <= colRange.end; col += 1) cols.push(col);
    return cols;
  }

  function reconcileCells(container, indexes, apply) {
    const existing = new Map();
    container.querySelectorAll('.cell').forEach((cellEl) => {
      existing.set(Number(cellEl.dataset.col), cellEl);
    });
    const wanted = new Set(indexes);
    existing.forEach((cellEl, col) => {
      if (!wanted.has(col)) cellEl.remove();
    });
    indexes.forEach((col) => {
      let cellEl = existing.get(col);
      if (!cellEl) {
        cellEl = document.createElement('div');
        cellEl.dataset.col = String(col);
        container.append(cellEl);
      }
      apply(cellEl, col);
    });
  }

  function renderEmptyState(model, viewportHeight) {
    let emptyEl = canvasEl.querySelector('.empty-state');
    if (model.rowCount === 0) {
      if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'empty-state';
        canvasEl.append(emptyEl);
      }
      emptyEl.style.height = `${Math.max(240, viewportHeight - core.HEADER_HEIGHT)}px`;
      emptyEl.textContent = '暂无成交数据';
    } else if (emptyEl) {
      emptyEl.remove();
    }
  }

  function cellFromEventTarget(target) {
    const cellEl = target.closest?.('.body-row .cell');
    if (!cellEl) return null;
    return { row: Number(cellEl.dataset.row), col: Number(cellEl.dataset.col) };
  }

  gridEl.addEventListener('mousedown', (event) => {
    const cell = cellFromEventTarget(event.target);
    if (!cell) return;
    event.preventDefault();
    gridEl.focus();

    if (state.edit?.isComposing) {
      state.pendingCellAfterComposition = cell;
      return;
    }
    if (state.edit && !core.sameCell(state.edit.cell, cell)) {
      commitEditAndClose();
    }

    setSelection(cell, event.shiftKey);
  });

  gridEl.addEventListener('click', (event) => {
    const cell = cellFromEventTarget(event.target);
    if (!cell || event.shiftKey || state.edit?.isComposing) return;
    startEdit(cell);
  });

  gridEl.addEventListener('dblclick', (event) => {
    const cell = cellFromEventTarget(event.target);
    if (cell && !state.edit?.isComposing) startEdit(cell);
  });

  gridEl.addEventListener('keydown', (event) => {
    if (state.edit) return;
    if (state.model.rowCount === 0) return;

    const key = event.key;
    const current = state.selection?.active || { row: 0, col: 0 };
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'c') {
      copySelection();
      event.preventDefault();
      return;
    }

    if (key === 'Tab') {
      const next = core.moveTab(current, state.model.rowCount, state.model.columnCount, event.shiftKey);
      setSelection(next, false);
      event.preventDefault();
      return;
    }

    if (key === 'Enter' || key === 'F2') {
      startEdit(current);
      event.preventDefault();
      return;
    }

    if (key.startsWith('Arrow') || key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown') {
      const next = core.moveClamped(current, key, state.model.rowCount, state.model.columnCount);
      setSelection(next, event.shiftKey);
      event.preventDefault();
      return;
    }

    if (isPrintableKey(event)) {
      startEdit(current, event.key);
      event.preventDefault();
    }
  });

  gridEl.addEventListener('copy', (event) => {
    if (state.edit) return;
    event.preventDefault();
    copySelection(event.clipboardData);
  });

  function isPrintableKey(event) {
    return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  }

  function copySelection(clipboardData = null) {
    const text = core.selectionToTSV(state.model, state.selection);
    if (clipboardData) {
      clipboardData.setData('text/plain', text);
      clipboardData.setData('text/tab-separated-values', text);
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    } else {
      legacyCopy(text);
    }
    noteEl.textContent = `已复制 ${state.selection ? state.selection.bottom - state.selection.top + 1 : 0} 行 TSV`;
  }

  function legacyCopy(text) {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }

  function setSelection(cell, extend = false) {
    if (!cell) return;
    state.selection = extend && state.selection
      ? core.normalizeSelection(state.selection.anchor, cell)
      : core.normalizeSelection(cell, cell);
    ensureCellVisible(cell);
    render();
  }

  function ensureCellVisible(cell) {
    const bodyTop = Math.max(0, gridEl.scrollTop - core.HEADER_HEIGHT);
    const bodyHeight = gridEl.clientHeight - core.HEADER_HEIGHT;
    gridEl.scrollTop = core.scrollIndexIntoView(
      cell.row,
      bodyTop,
      bodyHeight,
      state.model.rowCount * core.ROW_HEIGHT,
      core.ROW_HEIGHT
    ) + core.HEADER_HEIGHT;

    if (cell.col !== 0) {
      gridEl.scrollLeft = core.scrollColumnIntoView(
        cell.col,
        gridEl.scrollLeft,
        gridEl.clientWidth,
        state.model.widths
      );
    }
  }

  function startEdit(cell, initialText) {
    if (!cell) return;
    ensureCellVisible(cell);
    const currentValue = core.getCellValue(state.model, cell.row, cell.col);
    const draft = initialText === undefined ? currentValue : String(initialText);
    state.edit = core.startEdit(cell, draft);
    state.selection = core.normalizeSelection(cell, cell);
    render();

    const input = getEditorInput(true);
    input.value = draft;
    input.focus();
    if (initialText === undefined) {
      input.select();
    } else {
      input.setSelectionRange(input.value.length, input.value.length);
    }
    positionEditor(state.edit);
  }

  function getEditorInput(create = false) {
    let input = document.querySelector('.editor');
    if (!input && create) {
      input = document.createElement('input');
      input.className = 'editor';
      input.type = 'text';
      input.setAttribute('aria-label', '单元格编辑器');
      input.addEventListener('input', handleEditorInput);
      input.addEventListener('compositionstart', handleCompositionStart);
      input.addEventListener('compositionend', handleCompositionEnd);
      input.addEventListener('keydown', handleEditorKeyDown);
      input.addEventListener('blur', handleEditorBlur);
      document.body.append(input);
    }
    return input;
  }

  function handleEditorInput(event) {
    if (!state.edit) return;
    if (state.edit.isComposing || event.isComposing) {
      state.edit = core.updateComposition(state.edit, event.target.value);
    } else {
      state.edit = { ...state.edit, draft: event.target.value };
    }
  }

  function handleCompositionStart(event) {
    state.edit = core.beginComposition(state.edit);
    event.target.select?.();
  }

  function handleCompositionEnd(event) {
    const wasComposing = Boolean(state.edit?.isComposing);
    state.edit = core.endComposition(state.edit, event.target.value);
    if (wasComposing) {
      commitEditAndClose(false);
      const target = state.pendingCellAfterComposition;
      state.pendingCellAfterComposition = null;
      if (target) setSelection(target);
    }
  }

  function handleEditorKeyDown(event) {
    if (core.shouldIgnoreEditorKey(event, state.edit)) return;
    if (event.key === 'Enter') {
      commitEditAndClose();
      event.preventDefault();
    } else if (event.key === 'Escape') {
      cancelEditAndClose();
      event.preventDefault();
    } else if (event.key === 'Tab') {
      const cell = commitEditAndClose();
      if (cell) {
        setSelection(core.moveTab(
          cell,
          state.model.rowCount,
          state.model.columnCount,
          event.shiftKey
        ));
      }
      event.preventDefault();
    }
  }

  function handleEditorBlur(event) {
    const blurredInput = event.target;
    window.setTimeout(() => {
      if (blurredInput.isConnected && state.edit && !state.edit.isComposing) {
        commitEditAndClose();
      }
    }, 0);
  }

  function commitEditIfNeeded() {
    if (!state.edit) return;
    if (state.edit.isComposing) {
      const input = document.querySelector('.editor');
      state.edit = core.endComposition(state.edit, input ? input.value : state.edit.draft);
    }
    commitEditAndClose();
  }

  function commitEditAndClose(refocus = true) {
    const edit = state.edit;
    if (!edit) return null;
    const result = core.commitEdit(state.model, edit);
    state.model = result.model;
    state.edit = null;
    const input = document.querySelector('.editor');
    if (input) input.remove();
    render();
    if (refocus) gridEl.focus();
    return edit.cell;
  }

  function cancelEditAndClose() {
    state.edit = null;
    const input = document.querySelector('.editor');
    if (input) input.remove();
    render();
    gridEl.focus();
  }

  function positionEditor(edit) {
    const input = getEditorInput(false);
    if (!input) return;
    if (!edit) {
      input.remove();
      return;
    }

    const { cell } = edit;
    const rect = gridEl.getBoundingClientRect();
    const bodyLeft = cell.col === 0
      ? rect.left
      : rect.left + core.getColumnOffsets(state.model.widths)[cell.col] - gridEl.scrollLeft;
    const top = rect.top + core.HEADER_HEIGHT + cell.row * core.ROW_HEIGHT - gridEl.scrollTop;
    const visibleHorizontally = bodyLeft + state.model.widths[cell.col] > rect.left &&
      bodyLeft < rect.right;
    const visibleVertically = top + core.ROW_HEIGHT > rect.top + core.HEADER_HEIGHT &&
      top < rect.bottom;
    input.style.display = visibleHorizontally && visibleVertically ? 'block' : 'none';
    input.style.left = `${bodyLeft}px`;
    input.style.top = `${top}px`;
    input.style.width = `${state.model.widths[cell.col]}px`;
  }

  function runImeRepro() {
    const start = { row: 2, col: 1 };
    setSelection(start);
    startEdit(start, '');
    window.setTimeout(() => {
      const input = document.querySelector('.editor');
      if (!input) return;
      input.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
      input.value = 'ni';
      input.dispatchEvent(new InputEvent('input', { data: 'ni', isComposing: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true,
      }));
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
      }));
      const targetCell = document.querySelector('[data-row="3"][data-col="2"]');
      if (targetCell) {
        targetCell.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          detail: 1,
          shiftKey: false,
        }));
      }
      input.value = '你好';
      input.dispatchEvent(new CompositionEvent('compositionend', { data: '你好' }));
      const saved = core.getCellValue(state.model, start.row, start.col);
      const moved = core.sameCell(state.selection?.active, { row: 3, col: 2 });
      noteEl.textContent = saved === '你好'
        && moved
        ? '输入法复现通过：拼音阶段点另一格、方向键/回车均未落值；compositionend 后保存为“你好”并移动选区。'
        : `输入法复现异常，当前值：${saved}，移动：${moved}`;
    }, 30);
  }

  function runFastScrollRepro() {
    const positions = [120000, 0, 245000, 319960, 800, 180000];
    positions.forEach((position, index) => {
      window.setTimeout(() => {
        gridEl.scrollTop = position;
        gridEl.scrollLeft = (index % 2) * 420;
        if (index === positions.length - 1) {
          window.setTimeout(() => {
            noteEl.textContent += ' 连滚结束后窗口行号已重新校准。';
          }, 80);
        }
      }, index * 18);
    });
  }

  window.addEventListener('resize', render);

  loadScenario('full');

  function updateStatus() {
    const rendered = canvasEl.querySelectorAll('.body-row').length;
    statusEl.textContent = `${state.model.rowCount.toLocaleString('zh-CN')} 行 × ${state.model.columnCount} 列，当前 DOM 数据行 ${rendered} 个`;
  }

  window.vgrid = { state, loadScenario, render: () => render() };
})();
