/* What the teacher is told after pressing a column's Post button.
 *
 * The bug this pins down: Canvas posts grades in a background job, and its
 * submissions endpoint can still answer from a moment earlier once that job
 * reports done. The confirmation used to be measured against that single
 * lagging read, so a post that had in fact succeeded announced itself as
 * "0 of N grades posted" - and a page refresh seconds later showed the
 * grades posted exactly as they should be. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

// post-grades.js is a gradebook module, but nothing it does at load time
// touches the DOM, and the paths under test here work on the model alone.
vm.runInThisContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'gradebook', 'post-grades.js'), 'utf8'),
  { filename: 'src/gradebook/post-grades.js' });

const said = [];
CGP.ui = {
  toast: (m) => said.push({ level: 'info', text: String(m) }),
  error: (m) => said.push({ level: 'error', text: String(m) })
};

/* A model stand-in holding one column of two hidden, graded submissions.
 * `reads` is the queue of what each successive re-read of the column reports:
 * true = still hidden, false = posted. */
function fakeModel(reads) {
  const users = ['1', '2'];
  const state = { hidden: new Map(users.map((u) => [u, true])), failRead: false };
  return {
    courseId: '7',
    loadedAssignments: new Set(['99']),
    cells: new Map(users.map((u) => [`99:${u}`, { userId: u, postedAt: null, postedAtKnown: true }])),
    reloads: 0,
    reloadOpts: [],
    key: (aid, uid) => `${aid}:${uid}`,
    assignment: () => ({ name: 'Lab 4' }),
    cell(aid, uid) { return this.loadedAssignments.has(String(aid)) ? this.cells.get(this.key(aid, uid)) : null; },
    patchCell(aid, uid, patch) { Object.assign(this.cells.get(this.key(aid, uid)), patch); },
    pendingPosts(aid) {
      if (!this.loadedAssignments.has(String(aid))) return [];
      return users.filter((u) => state.hidden.get(u));
    },
    reloadAssignment(aid, opts) {
      this.reloads++;
      this.reloadOpts.push(opts);
      const next = reads.length ? reads.shift() : null;
      if (next === 'fail') { this.loadedAssignments.delete(String(aid)); return Promise.resolve(null); }
      this.loadedAssignments.add(String(aid));
      if (Array.isArray(next)) users.forEach((u, i) => state.hidden.set(u, !!next[i]));
      return Promise.resolve(null);
    }
  };
}

function controller(model, api, recheckBaseDelayMs) {
  return new CGP.PostGradesController({
    model, api,
    adapter: { colIndexToColumn: new Map() },
    settings: { values: { postGradesButton: true } },
    requestPaint: () => {},
    recheckBaseDelayMs
  });
}

const okApi = (progressDone = true) => ({
  postAssignmentGrades: () => Promise.resolve({ _id: 'p1' }),
  waitForProgress: () => Promise.resolve({ done: progressDone })
});

suite('what the teacher is told after posting a column', (test) => {
  const last = () => said[said.length - 1];

  test('a re-read that has caught up reports every grade posted', async () => {
    said.length = 0;
    // pre-post read, then the post-post read showing both posted
    const model = fakeModel([[true, true], [false, false]]);
    await controller(model, okApi()).post('99', null);
    a.eq(last().level, 'info');
    a.eq(last().text, '2 grades posted to students');
  });

  test('a genuinely partial post still reports the partial count', async () => {
    said.length = 0;
    const model = fakeModel([[true, true], [false, true]]);
    await controller(model, okApi()).post('99', null);
    a.eq(last().text, '1 of 2 grades posted in Lab 4');
  });

  test('a lagging re-read is retried rather than reported as a failed post', async () => {
    said.length = 0;
    // The column still looks untouched on the first re-read, and has caught
    // up by the second - the exact shape of the "0 of N grades posted" bug.
    const model = fakeModel([[true, true], [true, true], [false, false]]);
    await controller(model, okApi()).post('99', null);
    a.eq(model.reloads, 3, 'the unchanged read was not taken at face value');
    a.eq(last().text, '2 grades posted to students');
  });

  test('a re-read that never catches up reports what Canvas said, not "0 of N"', async () => {
    said.length = 0;
    const model = fakeModel([[true, true], [true, true], [true, true], [true, true]]);
    await controller(model, okApi()).post('99', null);
    a.eq(last().level, 'info');
    a.ok(/^Canvas posted 2 grades in Lab 4\b/.test(last().text), 'got: ' + last().text);
    a.ok(!/\b0 of 2\b/.test(last().text), 'never the old failure-shaped report');
  });

  test('a re-read that says "still hidden" is left standing, not overwritten', async () => {
    // Another instructor hiding the column during the post/re-read window is
    // indistinguishable from Canvas's endpoint lagging its own job, so a read
    // that DID land wins: stamping posted_at on the job's completion alone
    // would drop the bars and the button on grades that really are hidden.
    said.length = 0;
    const model = fakeModel([[true, true], [true, true], [true, true], [true, true]]);
    await controller(model, okApi()).post('99', null);
    a.eq(model.cells.get('99:1').postedAt, null, 'the successful read is not overwritten');
  });

  test('a posting job we stopped waiting for is reported as still running, not as posted', async () => {
    said.length = 0;
    const model = fakeModel([[true, true], [true, true], [true, true], [true, true]]);
    await controller(model, okApi(false)).post('99', null);
    a.ok(/still posting/i.test(last().text), 'says what is actually true: ' + last().text);
    a.eq(model.cells.get('99:1').postedAt, null, 'and nothing is marked posted on a guess');
  });

  test('a failed re-read after a confirmed post is not read as "nothing left to post"', async () => {
    said.length = 0;
    const model = fakeModel([[true, true], 'fail', 'fail', 'fail']);
    await controller(model, okApi()).post('99', null);
    a.eq(last().text, '2 grades posted to students');
    // No read landed at all, so there is no current picture of the column to
    // defer to - only our own confirmed post.
    a.ok(model.cells.get('99:1').postedAt, 'the confirmed post is still reflected locally');
  });

  test('a Canvas refusal is still reported as an error, not smoothed over', async () => {
    said.length = 0;
    const model = fakeModel([[true, true]]);
    const api = {
      postAssignmentGrades: () => Promise.reject(Object.assign(new Error('nope'), { status: 403 })),
      waitForProgress: () => Promise.resolve({ done: true })
    };
    await controller(model, api).post('99', null);
    a.eq(last().level, 'error');
  });

  test('a job we stopped waiting for keeps checking in the background until it catches up - no refresh needed', async () => {
    said.length = 0;
    // 3 reads for settleAfterPost's own attempts (all still hidden, so the
    // job reads as "still running"), then recheckLater's own background
    // attempts: still hidden once more, then finally caught up.
    const model = fakeModel([[true, true], [true, true], [true, true], [true, true], [false, false]]);
    await controller(model, okApi(false), 2 /* tiny base delay: this test does not wait minutes */).post('99', null);
    a.ok(/still posting/i.test(last().text), 'got: ' + last().text);
    a.ok(!/refresh/i.test(last().text), 'must not ask the teacher to refresh - the grid corrects itself');
    a.eq(model.pendingPosts('99').length, 2, 'not caught up yet - the background recheck has not run');

    await new Promise((resolve) => setTimeout(resolve, 200));
    a.eq(model.pendingPosts('99').length, 0, 'the background recheck(s) caught the column up with no user action');
  });

  test('a swallowed fetch failure during the background recheck is retried, not mistaken for caught up', async () => {
    said.length = 0;
    // 1 pre-post read + 3 settleAfterPost attempts (all still hidden) before
    // recheckLater even starts, then recheckLater's own attempts: a fetch
    // failure reloadAssignment() swallows internally (the column drops out
    // of loadedAssignments, same as the 'fail' reads used elsewhere in this
    // file), then still hidden, then finally caught up. pendingPosts()
    // answers [] for an assignment that is not loaded - indistinguishable,
    // by length alone, from "nothing left to post" - so a naive read of that
    // length used to end the retry chain right there instead of recognising
    // the column was never actually re-read.
    const model = fakeModel([
      [true, true], [true, true], [true, true], [true, true],
      'fail', [true, true], [false, false]
    ]);
    await controller(model, okApi(false), 2 /* tiny base delay */).post('99', null);
    a.ok(/still posting/i.test(last().text), 'got: ' + last().text);

    await new Promise((resolve) => setTimeout(resolve, 200));
    a.eq(model.reloads, 7, 'the swallowed failure did not silently end the retry chain');
    a.eq(model.loadedAssignments.has('99'), true, 'the column is not left stuck unloaded after one failed attempt');
    a.eq(model.pendingPosts('99').length, 0, 'and it actually caught up, not merely stopped retrying');
  });

  test('every re-read a post triggers skips fetching comments it will never use', async () => {
    // Posting can re-read the same column up to four times (the pre-post
    // check, plus up to three settle-after-post attempts); none of them look
    // at a comment, so none of them should ask Canvas to serialize every
    // submission's comment thread along with the grades.
    said.length = 0;
    const model = fakeModel([[true, true], [true, true], [false, false]]);
    await controller(model, okApi()).post('99', null);
    a.ok(model.reloadOpts.length >= 3, 'more than one re-read happened in this run');
    model.reloadOpts.forEach((opts) => a.eq(opts && opts.includeComments, false));
  });
});
