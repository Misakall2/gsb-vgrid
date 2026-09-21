/* viewport.js - "which slice of rows lives in the window" + DOM recycling.
 *
 * Dependency direction (this is the lowest DOM layer):
 *   viewport -> GridCore constants only (ROW_H for measurement fallback)
 *   viewport knows NOTHING about selection, IME, columns or data semantics.
 *
 * The host supplies a layout provider:
 *   computeLayout() => {
 *     items: [{ key, kind: 'row'|'group', top, height?, group? }],
 *   }
 * and node builders for each kind. The viewport:
 *   1. keeps one DOM node per currently mounted item key (keyed pool),
 *   2. diffs against the new window and recycles only vanished nodes,
 *   3. notifies subscribers with the destroyed row ids / mounted row map.
 * Subscribers (selection layer, editor) never query removed nodes; the
 * viewport delivers whatever state they need at recycling time.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../grid-core.js'));
  }
  if (root) root.VGridViewport = factory(root.GridCore);
})(typeof self !== 'undefined' ? self : globalThis, function (Core) {
  'use strict';

  const ROW_H = Core.ROW_H;

  function createViewport(opts) {
    const grid = opts.grid;
    const canvas = opts.canvas;
    const computeLayout = opts.computeLayout;
    const buildRow = opts.buildRow;     // (item) => row element
    const updateRow = opts.updateRow;   // (el, item) => void
    const buildGroup = opts.buildGroup; // (item) => group element
    const updateGroup = opts.updateGroup; // (el, item) => void
    const onMeasurementsChanged = opts.onMeasurementsChanged || function () {};
    const afterRender = opts.afterRender || function () {};
    const onMeasuredHeights = opts.onMeasuredHeights || function () {};

    /* Keyed pools: item key -> live element. Row key is the data row id,
 * which is why scroll recycling never disturbs data-keyed state. */
    const rowNodes = new Map();
    const groupNodes = new Map();
    const rowPool = [];
    const subscribers = [];
    let rendering = false;

    function subscribe(sub) {
      subscribers.push(sub);
      return function () {
        const i = subscribers.indexOf(sub);
        if (i !== -1) subscribers.splice(i, 1);
      };
    }

    function notifyRowsRecycled(rowIds) {
      if (!rowIds.length) return;
      for (const sub of subscribers) {
        if (sub.rowsRecycled) sub.rowsRecycled(rowIds);
      }
    }

    function notifyRowsMounted(rowsMap) {
      if (!rowsMap.size) return;
      for (const sub of subscribers) {
        if (sub.rowsMounted) sub.rowsMounted(rowsMap);
      }
    }

    function obtainRow(item) {
      let el = rowNodes.get(item.key);
      if (el) return el;
      el = rowPool.pop() || buildRow(item);
      canvas.appendChild(el);
      rowNodes.set(item.key, el);
      return el;
    }

    function recycleRows(activeKeys) {
      const recycled = [];
      rowNodes.forEach(function (el, key) {
        if (activeKeys.has(key)) return;
        el.remove();
        rowNodes.delete(key);
        rowPool.push(el);
        recycled.push(key);
      });
      notifyRowsRecycled(recycled);
    }

    function syncGroups(items) {
      const active = new Set();
      for (const item of items) {
        if (item.kind !== 'group') continue;
        active.add(item.key);
        let el = groupNodes.get(item.key);
        if (!el) {
          el = buildGroup(item);
          canvas.appendChild(el);
          groupNodes.set(item.key, el);
        } else if (updateGroup) {
          updateGroup(el, item);
        }
      }
      groupNodes.forEach(function (el, key) {
        if (!active.has(key)) {
          el.remove();
          groupNodes.delete(key);
        }
      });
    }

    /* Groups render before rows so rows stay on top at overlaps; within the
 * row list, absolute positioning makes order irrelevant, but we keep the
 * DOM ordered by key for stable inspection/tests. */
    function syncRows(items) {
      const rows = [];
      const activeKeys = new Set();
      for (const item of items) {
        if (item.kind !== 'row') continue;
        rows.push(item);
        activeKeys.add(item.key);
      }
      rows.sort(function (a, b) { return a.top - b.top; });

      /* Upsert/update first, recycle after: subscribers still see a coherent
 * window inside their rowsRecycled callback. */
      const mounted = new Map();
      for (const item of rows) {
        const el = obtainRow(item);
        updateRow(el, item);
        mounted.set(item.key, el);
      }
      recycleRows(activeKeys);
      return mounted;
    }

    /* First render pass with fresh nodes uses the ROW_H estimate; nodes that
 * end up taller report their measured height exactly once, then layout is
 * recomputed. Mirrors the old measure -> layout -> rerender loop. */
    function measureHeights(rowsMap) {
      let changed = false;
      rowsMap.forEach(function (rowEl, rowId) {
        if (rowEl.dataset.measuring !== '1') return;
        rowEl.removeAttribute('data-measuring');
        rowEl.style.height = '';
        rowEl.style.minHeight = ROW_H + 'px';
        const measuredHeight = rowEl.offsetHeight;
        rowEl.style.minHeight = '';
        rowEl.style.height = measuredHeight + 'px';
        if (measuredHeight && onMeasuredHeights(rowId, measuredHeight)) {
          changed = true;
        }
      });
      return changed;
    }

    function render() {
      if (rendering) return;
      rendering = true;
      try {
        renderPass();
      } finally {
        rendering = false;
      }
    }

    function renderPass() {
      const layout = computeLayout();
      const items = layout.items || [];
      syncGroups(items);
      const mounted = syncRows(items);
      if (measureHeights(mounted)) {
        onMeasurementsChanged();
        renderPass();
        return;
      }
      notifyRowsMounted(mounted);
      afterRender();
    }

    function clear() {
      const all = [];
      rowNodes.forEach(function (_el, key) { all.push(key); });
      rowNodes.forEach(function (el) {
        el.remove();
        rowPool.push(el);
      });
      rowNodes.clear();
      groupNodes.forEach(function (el) { el.remove(); });
      groupNodes.clear();
      notifyRowsRecycled(all);
    }

    function mountedRowCount() { return rowNodes.size; }

    /* rAF-coalesced scroll handling, same timing contract as the old
 * single scroll listener. */
    let ticking = false;
    grid.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        render();
      });
    });

    return {
      subscribe: subscribe,
      render: render,
      clear: clear,
      mountedRowCount: mountedRowCount,
      rowNodes: rowNodes,
    };
  }

  return { createViewport: createViewport };
});
