/* The frozen Total is Canvas's own Total column, frozen by Canvas's own
 * "Move to Front" (the page bridge's freezeCanvasTotal - see
 * test-page-grid-bridge.js). These cover the content-script side: when it
 * asks, how often, and when it stops asking. */
'use strict';

const { suite, assert: a } = require('./harness');
const { loadGradebookDom } = require('./domharness');

function controller(CGP, answers, settings) {
  const ctrl = new CGP.FrozenTotalController({ settings: settings || { values: { frozenTotal: true } } });
  ctrl.asked = 0;
  ctrl.scheduled = [];
  ctrl._schedule = function (fn, ms) { ctrl.scheduled.push({ fn: fn, ms: ms }); };
  ctrl.request = function () {
    const answer = answers[Math.min(ctrl.asked, answers.length - 1)];
    ctrl.asked++;
    return Promise.resolve(answer);
  };
  return ctrl;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

suite('frozen Total: Canvas\'s own column, frozen by Canvas', (test) => {
  test('asks once, and stops asking once Canvas has its Total frozen', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [{ ok: true, frozen: true, changed: true }]);
    ctrl.start();
    await settle();
    ctrl.paint();
    ctrl.paint();
    await settle();
    a.eq(ctrl.asked, 1);
    a.eq(ctrl.done, true);
  });

  test('a grid Canvas has not finished building is asked again later, with backoff, then given up on', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [{ ok: false, reason: 'unavailable' }]);
    ctrl.start();
    await settle();
    ctrl.paint();
    await settle();
    a.eq(ctrl.asked, 1, 'not re-asked on the very next paint');
    for (let i = 0; i < 20; i++) {
      ctrl._nextAt = 0;
      ctrl.paint();
      await settle();
    }
    a.eq(ctrl.asked, 8, 'gives up after a bounded number of tries');
    a.eq(ctrl.done, true);
  });

  test('a failed request schedules its own retry, so an idle grid still gets one', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [{ ok: false, reason: 'timeout' }, { ok: true, frozen: true, changed: true }]);
    ctrl.start();
    await settle();
    a.eq(ctrl.scheduled.length, 1, 'a retry is timed, not left to the next paint');
    a.eq(ctrl.scheduled[0].ms, 1000);
    ctrl.scheduled[0].fn();   // even with the clock a hair short of the backoff
    await settle();
    a.eq(ctrl.asked, 2);
    a.eq(ctrl.done, true);
  });

  test('a Total Canvas is not showing yet is asked about again, not given up on at once', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [{ ok: true, frozen: false, reason: 'notShown' }, { ok: true, frozen: true, changed: true }]);
    ctrl.start();
    await settle();
    a.eq(ctrl.done, false);
    ctrl._nextAt = 0;
    ctrl.paint();
    await settle();
    a.eq(ctrl.asked, 2);
    a.eq(ctrl.done, true);
  });

  test('turning the setting off and on again asks Canvas again, even after it gave up', async () => {
    const CGP = loadGradebookDom();
    const settings = { values: { frozenTotal: true } };
    const ctrl = controller(CGP, [{ ok: false, reason: 'unavailable' }], settings);
    ctrl._attempts = 7;   // one try from giving up
    ctrl.start();
    await settle();
    a.eq(ctrl.done, true, 'gave up');
    settings.values.frozenTotal = false;
    ctrl.paint();
    settings.values.frozenTotal = true;
    ctrl.paint();
    await settle();
    a.eq(ctrl.asked, 2, 'asked again after the turn-on');
  });

  test('an answer that arrives after the setting was turned off is not recorded', async () => {
    const CGP = loadGradebookDom();
    const settings = { values: { frozenTotal: true } };
    const ctrl = controller(CGP, [{ ok: true, frozen: true, changed: true }], settings);
    ctrl.start();
    settings.values.frozenTotal = false;
    ctrl.paint();
    await settle();
    a.eq(ctrl.done, false);
  });

  test('with the setting off, Canvas is never asked', async () => {
    const CGP = loadGradebookDom();
    const ctrl = controller(CGP, [{ ok: true, frozen: true }], { values: { frozenTotal: false } });
    ctrl.start();
    ctrl.paint();
    await settle();
    a.eq(ctrl.asked, 0);
    a.eq(ctrl.enabled, false);
  });
});
