/* The frozen Total is Canvas's own Total column, moved by Canvas's own
 * "Move to Front" / "Move to End" (the page bridge's placeCanvasTotal - see
 * test-page-grid-bridge.js). These cover the content-script side: the
 * setting decides where Total sits, checked on every paint. */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom } = require('./domharness');

/* where: what the page shows - true (Total in the frozen pane), false, or
 * null (grid not split yet). A successful move updates it, as Canvas's
 * redraw would. */
function controller(CGP, answers, opts) {
  opts = opts || {};
  const page = { where: opts.where === undefined ? false : opts.where };
  const settings = opts.settings || { values: { frozenTotal: true } };
  const ctrl = new CGP.FrozenTotalController({
    adapter: { totalInFrozenPane: () => page.where },
    settings: settings
  });
  ctrl.page = page;
  ctrl.asked = [];
  ctrl.scheduled = [];
  ctrl._schedule = function (fn, ms) { ctrl.scheduled.push({ fn: fn, ms: ms }); return ctrl.scheduled.length; };
  ctrl.request = function (front) {
    const answer = answers[Math.min(ctrl.asked.length, answers.length - 1)];
    ctrl.asked.push(front);
    if (answer && answer.ok && answer.placed && answer.changed) page.where = front;
    return Promise.resolve(answer);
  };
  return ctrl;
}

const MOVED = { ok: true, placed: true, changed: true };
const settle = () => new Promise((resolve) => setImmediate(resolve));

suite('frozen Total: the setting decides where Canvas\'s own Total sits', (test) => {
  test('on: Total is moved beside the names, and nothing more is asked once it is there', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [MOVED]);
    ctrl.start();
    await settle();
    a.deep(ctrl.asked, [true], 'asked Canvas to move it to the front');
    ctrl._nextAt = 0;
    ctrl.paint();
    ctrl.paint();
    await settle();
    a.eq(ctrl.asked.length, 1, 'in place: no further requests');
  });

  test('on: a Total already beside the names is left alone', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [MOVED], { where: true });
    ctrl.start();
    await settle();
    a.eq(ctrl.asked.length, 0);
  });

  test('on: a Total moved away later (Canvas\'s "Move to End") is moved straight back', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [MOVED], { where: true });
    ctrl.start();
    ctrl.page.where = false;   // the teacher picked "Move to End"
    ctrl.paint();              // Canvas's redraw triggers a paint
    await settle();
    a.deep(ctrl.asked, [true]);
    a.eq(ctrl.page.where, true);
  });

  test('off: a frozen Total is moved back to the far right', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [MOVED], { where: true, settings: { values: { frozenTotal: false } } });
    ctrl.start();
    await settle();
    a.deep(ctrl.asked, [false], 'asked Canvas to move it to the end');
    a.eq(ctrl.page.where, false);
  });

  test('off: a Total already at the far right is left alone', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [MOVED], { settings: { values: { frozenTotal: false } } });
    ctrl.start();
    await settle();
    a.eq(ctrl.asked.length, 0);
  });

  test('switching the setting acts at once, even mid-backoff', async () => {
    const CGP = loadGradebookDom();
    const settings = { values: { frozenTotal: true } };
    const ctrl = controller(CGP, [{ ok: false, reason: 'unavailable' }, MOVED], { settings: settings });
    ctrl.start();
    await settle();
    a.deep(ctrl.asked, [true]);
    a.ok(ctrl._nextAt > Date.now(), 'backing off after the failure');
    settings.values.frozenTotal = false;
    ctrl.paint();               // already at the far right: nothing to do
    settings.values.frozenTotal = true;
    ctrl.paint();
    await settle();
    a.deep(ctrl.asked, [true, true], 'the turn-on is not held back by the old backoff');
    a.eq(ctrl.page.where, true);
  });

  test('an answer that arrives after the setting changed is ignored', async () => {
    const CGP = loadGradebookDom();
    const settings = { values: { frozenTotal: true } };
    const ctrl = controller(CGP, [{ ok: false, reason: 'unavailable' }], { settings: settings });
    ctrl.start();
    settings.values.frozenTotal = false;
    await settle();
    a.eq(ctrl._attempts, 0, 'not counted');
    a.eq(ctrl.scheduled.length, 0, 'no retry scheduled for the old setting');
  });

  test('a grid that has not split into panes yet is not asked about', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [MOVED], { where: null });
    ctrl.start();
    await settle();
    a.eq(ctrl.asked.length, 0);
  });

  test('a failed request backs off and schedules its own retry, so an idle grid still gets one', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [{ ok: false, reason: 'timeout' }, { ok: false, reason: 'unavailable' }, MOVED]);
    ctrl.start();
    await settle();
    ctrl.paint();
    await settle();
    a.eq(ctrl.asked.length, 1, 'not re-asked on the very next paint');
    a.eq(ctrl.scheduled.length, 1, 'a retry is timed, not left to the next paint');
    a.ok(ctrl.scheduled[0].ms > 900 && ctrl.scheduled[0].ms <= 1000);
    ctrl.scheduled[0].fn();   // even with the clock a hair short of the backoff
    await settle();
    a.eq(ctrl.asked.length, 2);
    a.ok(ctrl.scheduled[1].ms > 1900 && ctrl.scheduled[1].ms <= 2000, 'the wait doubles');
    ctrl.scheduled[1].fn();
    await settle();
    a.eq(ctrl.asked.length, 3);
    a.eq(ctrl.page.where, true);
  });

  test('a Total Canvas is not showing keeps being checked, at most every 30s', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [{ ok: true, placed: false, reason: 'notShown' }]);
    ctrl.start();
    for (let i = 0; i < 12; i++) {
      await settle();
      ctrl.scheduled[ctrl.scheduled.length - 1].fn();
    }
    await settle();
    a.eq(ctrl.asked.length, 13, 'never given up for good');
    a.ok(ctrl.scheduled[ctrl.scheduled.length - 1].ms <= 30000);
  });
});
