/* editor.js - cell editor (double-click / Enter) with its own IME session.
 *
 * Dependency direction:
 *   editor -> VGridComposition (IME state machine), GridCore.editorKeyAction
 *   editor is notified BY viewport when rows recycle; it never searches the
 *   canvas for its cell (that node may already be gone). The new box geometry
 *   is computed by callers and handed into reposition(box).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../grid-core.js'),
      require('./composition.js'),
    );
  }
  if (root) root.VGridEditor = factory(root.GridCore, root.VGridComposition);
})(typeof self !== 'undefined' ? self : globalThis, function (Core, Composition) {
  'use strict';

  function createCellEditor(opts) {
    const grid = opts.grid;
    const hooks = opts.hooks || {};
    /* geometry: ({r, c}) => { top, left, width, height } in scrollport
 * coordinates, computed by app from freeze + current row layout. */
    const geometry = opts.geometry;

    const state = {
      open: false,
      r: 0,
      c: 0,
      input: null,
    };
    /* IME state lives in its own state machine; it is not a scroll flag and
 * scroll state never touches it. */
    const ime = Composition.createCompositionSession();

    function isOpen() { return state.open; }
    function isComposing() { return ime.isComposing(); }
    function cell() { return { r: state.r, c: state.c }; }

    function open(r, c, initialValue) {
      if (state.open) return;
      state.open = true;
      state.r = r;
      state.c = c;
      const input = document.createElement('input');
      input.className = 'editor';
      input.value = initialValue == null ? '' : initialValue;
      state.input = input;
      Composition.bindComposition(input, ime, function () {
        /* compositionend: keep the same data coordinate; just realign. */
        reposition();
      });
      bindInputEvents(input);
      grid.appendChild(input);
      reposition();
      input.focus();
      input.select();
    }

    function close(commit) {
      if (!state.open) return null;
      const result = {
        r: state.r,
        c: state.c,
        value: state.input.value,
        commit: !!commit,
      };
      state.open = false;
      ime.end();
      state.input.remove();
      state.input = null;
      return result;
    }

    /* Viewport recycling hook: rows were destroyed. The editor does not look
 * anything up; it relocates itself from the delivered geometry for the
 * still-open data coordinate, and stays attached during composition. */
    function rowsRecycled() {
      if (state.open) reposition();
    }

    function reposition() {
      if (!state.open || !state.input) return;
      const box = geometry({ r: state.r, c: state.c });
      state.input.style.top = box.top + 'px';
      state.input.style.left = box.left + 'px';
      state.input.style.width = box.width + 'px';
      state.input.style.height = box.height + 'px';
    }

    /* While composing, clicks/keys that would move or commit are swallowed by
 * callers; this guard centralises the check. */
    function guardExternalPointer(e) {
      if (ime.isComposing() && e.target !== state.input) {
        e.preventDefault();
        e.stopPropagation();
        if (state.input) state.input.focus();
        return true;
      }
      return false;
    }

    function bindInputEvents(input) {
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        const composing = ime.isComposing() || e.isComposing;
        const action = Core.editorKeyAction(e.key, composing);
        if (action === 'none') return;
        e.preventDefault();
        if (action === 'cancel') {
          close(false);
          if (hooks.onCancel) hooks.onCancel();
          return;
        }
        const result = close(true);
        if (hooks.onCommit) hooks.onCommit(result, action, e.shiftKey);
      });
      input.addEventListener('blur', function () {
        if (!state.open) return;
        const result = close(true);
        if (hooks.onBlurCommit) hooks.onBlurCommit(result);
      });
    }

    return {
      open: open,
      close: close,
      reposition: reposition,
      rowsRecycled: rowsRecycled,
      isOpen: isOpen,
      isComposing: isComposing,
      cell: cell,
      guardExternalPointer: guardExternalPointer,
      inputEl: function () { return state.input; },
    };
  }

  return { createCellEditor: createCellEditor };
});
