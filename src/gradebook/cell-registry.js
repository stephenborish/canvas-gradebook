/* Canvas Gradebook+ - registry of rendered cells.
 *
 * Keeps the most recent identity for every rendered cell element and the paint
 * signature already applied to it, so repainting after a Canvas rerender only
 * touches cells whose visible state actually changed. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.CellRegistry) return;

  function CellRegistry() {
    this.byElement = new WeakMap();  // element -> info
    this.byKey = new Map();          // "assignmentId:userId" -> element
    this.signatures = new WeakMap(); // element -> last painted signature
    this.lastCells = [];
  }

  CellRegistry.prototype.sync = function (cells) {
    this.byKey.clear();
    this.lastCells = cells || [];
    var self = this;
    this.lastCells.forEach(function (info) {
      self.byElement.set(info.el, info);
      if (info.assignmentId && info.studentId) {
        self.byKey.set(CGP.gridMap.cellKey(info.assignmentId, info.studentId), info.el);
      }
    });
    return this.lastCells;
  };

  CellRegistry.prototype.info = function (el) {
    return this.byElement.get(el) || null;
  };

  CellRegistry.prototype.elementFor = function (assignmentId, userId) {
    return this.byKey.get(CGP.gridMap.cellKey(assignmentId, userId)) || null;
  };

  CellRegistry.prototype.needsPaint = function (el, signature) {
    return this.signatures.get(el) !== signature;
  };

  CellRegistry.prototype.markPainted = function (el, signature) {
    this.signatures.set(el, signature);
  };

  CellRegistry.prototype.invalidate = function (el) {
    this.signatures.delete(el);
  };

  CellRegistry.prototype.invalidateAll = function () {
    this.signatures = new WeakMap();
  };

  CGP.CellRegistry = CellRegistry;
})();
