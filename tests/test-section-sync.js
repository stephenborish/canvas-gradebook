/* Copy to sections: the decisions (core/section-sync.js) and the copy runner
 * (sections/sync-runner.js) against a fake Canvas that answers the way the
 * real endpoints do (content_migrations, asset_id_mapping, date_details). */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');

function S() { return globalThis.CGP.sectionSync; }

let runnerLoaded = false;
function loadRunner() {
  if (runnerLoaded) return;
  runnerLoaded = true;
  const rel = 'src/sections/sync-runner.js';
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), { filename: rel });
}

const TZ = 'America/New_York';

suite('copy to sections: requests and Canvas answers', (test) => {
  test('a copy is Canvas’s own selective course copy of one item', () => {
    const body = S().copyRequest('11', { type: 'assignment', id: 5 });
    a.deep(body, { migration_type: 'course_copy_importer', select: { assignments: ['5'] }, settings: { source_course_id: '11' } });
  });

  test('module placement always names the insert type; modules and announcements are never placed', () => {
    const b = S().copyRequest('11', { type: 'page', id: 7 }, { module: { id: 90, position: 3 }, assignmentGroupId: 4 });
    a.deep(b.select, { pages: ['7'] });
    a.eq(b.settings.insert_into_module_id, '90');
    a.eq(b.settings.insert_into_module_type, 'pages');
    a.eq(b.settings.insert_into_module_position, 3);
    a.eq(b.settings.move_to_assignment_group_id, '4');
    const m = S().copyRequest('11', { type: 'module', id: 2 }, { module: { id: 90 } });
    a.deep(m.select, { modules: ['2'] });
    a.lacksKey(m.settings, 'insert_into_module_id');
    const ann = S().copyRequest('11', { type: 'announcement', id: 3 }, { module: { id: 90 } });
    a.deep(ann.select, { announcements: ['3'] });
    a.lacksKey(ann.settings, 'insert_into_module_id');
  });

  test('migration states follow Canvas’s API names', () => {
    a.eq(S().migrationState({ workflow_state: 'completed' }), 'completed');
    a.eq(S().migrationState({ workflow_state: 'failed' }), 'failed');
    ['running', 'queued', 'pre_processing', 'pre_processed', 'exporting'].forEach((w) => a.eq(S().migrationState({ workflow_state: w }), 'running', w));
    a.eq(S().migrationState({ workflow_state: 'waiting_for_select' }), 'stuck');
  });

  test('the mapping comes from the newest completed copy from THIS source', () => {
    const migs = [
      { id: 50, migration_type: 'course_copy_importer', workflow_state: 'running', settings: { source_course_id: 11 } },
      { id: 40, migration_type: 'course_copy_importer', workflow_state: 'completed', settings: { source_course_id: 12 } },
      { id: 30, migration_type: 'common_cartridge_importer', workflow_state: 'completed' },
      { id: 20, migration_type: 'course_copy_importer', workflow_state: 'completed', settings: { source_course_id: 11 } },
      { id: 25, migration_type: 'course_copy_importer', workflow_state: 'completed', settings: { source_course_id: 11 } }
    ];
    a.eq(S().latestCopyFrom(migs, '11').id, 25);
    a.eq(S().latestCopyFrom(migs, '99'), null);
  });

  test('asset_id_mapping: only plain source->destination ids count', () => {
    const mapping = {
      assignments: { '5': '705', g1234abcd: { source: { id: '6' }, destination: { id: '706' } } },
      pages: { '7': '807' }
    };
    a.eq(S().destIdFor(mapping, 'assignment', 5), '705');
    a.eq(S().destIdFor(mapping, 'assignment', 6), null, 'never read from a migration_id entry');
    a.eq(S().destIdFor(mapping, 'page', '7'), '807');
    a.eq(S().destIdFor(mapping, 'quiz', '7'), null);
    a.eq(S().destIdFor(null, 'quiz', '7'), null);
  });

  test('pages are addressed by page_id:, everything else by id', () => {
    a.eq(S().itemApiPath('3', 'page', '807'), '/api/v1/courses/3/pages/page_id:807');
    a.eq(S().itemApiPath('3', 'announcement', '9'), '/api/v1/courses/3/discussion_topics/9');
    a.eq(S().itemHtmlPath('3', 'quiz', '9'), '/courses/3/quizzes/9');
  });

  test('the item on the current page is read from its URL', () => {
    a.deep(S().itemFromPath('/courses/1/assignments/22'), { courseId: '1', type: 'assignment', id: '22' });
    a.deep(S().itemFromPath('/courses/1/assignments/22/edit'), { courseId: '1', type: 'assignment', id: '22' });
    a.deep(S().itemFromPath('/courses/1/quizzes/4'), { courseId: '1', type: 'quiz', id: '4' });
    a.deep(S().itemFromPath('/courses/1/announcements/5'), { courseId: '1', type: 'announcement', id: '5' });
    a.deep(S().itemFromPath('/courses/1/pages/unit-1%20intro'), { courseId: '1', type: 'page', slug: 'unit-1 intro' });
    a.eq(S().itemFromPath('/courses/1/pages/new'), null);
    a.eq(S().itemFromPath('/courses/1/assignments'), null);
    a.eq(S().itemFromPath('/courses/1/assignments/new'), null);
    a.eq(S().itemFromPath('/courses/1/gradebook'), null);
  });

  test('an assignment that is really a quiz or a discussion is offered as that, not twice', () => {
    a.eq(S().toItem('assignment', { id: 1, quiz_id: 4, submission_types: ['online_quiz'] }), null);
    a.eq(S().toItem('assignment', { id: 1, submission_types: ['discussion_topic'] }), null);
    const nq = S().toItem('assignment', { id: 1, name: 'NQ', is_quiz_lti_assignment: true, submission_types: ['external_tool'], due_at: '2026-01-01T00:00:00Z' });
    a.ok(nq.newQuiz);
    a.eq(nq.dates.due_at, '2026-01-01T00:00:00Z');
    const graded = S().toItem('discussion', { id: 3, title: 'D', assignment_id: 9, assignment: { due_at: 'x', unlock_at: null, lock_at: null, assignment_group_id: 2 } });
    a.ok(graded.graded);
    a.deep(S().dateFields(graded), ['due_at', 'unlock_at', 'lock_at']);
    const plain = S().toItem('discussion', { id: 3, title: 'D', delayed_post_at: 'y' });
    a.deep(S().dateFields(plain), ['unlock_at', 'lock_at'], 'no due date on an ungraded discussion');
    a.eq(plain.dates.unlock_at, 'y');
    const ann = S().toItem('discussion', { id: 3, title: 'A', is_announcement: true, delayed_post_at: 'z' });
    a.eq(ann.type, 'announcement');
    a.deep(S().dateFields(ann), ['delayed_post_at', 'lock_at']);
  });
});

suite('copy to sections: dates', (test) => {
  test('wall time in the teacher’s Canvas time zone, both ways, across DST', () => {
    a.eq(S().isoToLocal('2026-03-02T16:55:00Z', TZ), '2026-03-02T11:55');
    a.eq(S().isoToLocal('2026-07-02T15:55:00Z', TZ), '2026-07-02T11:55');
    a.eq(S().localToIso('2026-03-02T11:55', TZ), '2026-03-02T16:55:00.000Z');
    a.eq(S().localToIso('2026-07-02T11:55', TZ), '2026-07-02T15:55:00.000Z');
    a.eq(S().localToIso('2026-11-01T01:30', 'America/Los_Angeles').slice(0, 13), '2026-11-01T08', 'ambiguous hour resolves to one instant');
    a.eq(S().isoToLocal(S().localToIso('2026-03-08T03:30', TZ), TZ), '2026-03-08T03:30');
    a.eq(S().localToIso('', TZ), null, 'blank is no date');
    a.eq(S().localToIso('2026-02-30T10:00', TZ), undefined, 'Feb 30 is not a date');
    a.eq(S().localToIso('soon', TZ), undefined);
    a.eq(S().isoToLocal(null, TZ), '');
  });

  test('shifting by days keeps the clock time, even across a DST change and month ends', () => {
    a.eq(S().shiftLocal('2026-03-07T08:55', 2), '2026-03-09T08:55');
    a.eq(S().shiftLocal('2026-01-31T23:59', 1), '2026-02-01T23:59');
    a.eq(S().shiftLocal('2026-03-01T10:00', -1), '2026-02-28T10:00');
    a.eq(S().shiftLocal('', 3), '');
    a.eq(S().withTime('2026-03-07T08:55', '13:45'), '2026-03-07T13:45');
  });

  test('a section time can be a period shortcut, a 24-hour or a 12-hour time', () => {
    const cuts = [{ key: '1', time: '08:55' }, { key: '3', time: '12:30' }];
    a.eq(S().parseClock('3', cuts), '12:30');
    a.eq(S().parseClock('13:45', cuts), '13:45');
    a.eq(S().parseClock('1:45 pm', cuts), '13:45');
    a.eq(S().parseClock('12am', cuts), '00:00');
    a.eq(S().parseClock('12:15 PM', cuts), '12:15');
    a.eq(S().parseClock('9a', cuts), '09:00');
    a.eq(S().parseClock('7', cuts), null, 'not a shortcut, not a time');
    a.eq(S().parseClock('13 pm', cuts), null);
  });

  test('dates are checked in the order Canvas enforces', () => {
    const ok = S().checkDates({ unlock_at: '2026-03-01T08:00', due_at: '2026-03-02T08:00', lock_at: '2026-03-03T08:00' }, TZ);
    a.eq(ok.errors.length, 0);
    a.eq(ok.iso.due_at, '2026-03-02T13:00:00.000Z');
    a.ok(S().checkDates({ unlock_at: '2026-03-03T08:00', due_at: '2026-03-02T08:00' }, TZ).errors[0].indexOf('after Due') > 0);
    a.ok(S().checkDates({ due_at: '2026-03-04T08:00', lock_at: '2026-03-03T08:00' }, TZ).errors[0].indexOf('after Until') > 0);
    a.ok(S().checkDates({ unlock_at: '2026-03-04T08:00', lock_at: '2026-03-03T08:00' }, TZ).errors.length === 1);
    a.ok(S().checkDates({ due_at: 'tomorrow' }, TZ).errors[0].indexOf('not a date') > 0);
    a.eq(S().checkDates({ due_at: '', lock_at: '' }, TZ).iso.due_at, null);
  });

  test('a section’s dates go through date_details, never touching overrides', () => {
    const item = { type: 'assignment' };
    const w = S().datesWrite(item, { due_at: '2026-03-02T13:00:00.000Z', unlock_at: null, lock_at: null },
      { due_at: '2026-03-01T13:00:00Z', unlock_at: null, lock_at: null, only_visible_to_overrides: false, overrides: [{ id: 1 }] });
    a.eq(w.via, 'details');
    a.deep(w.body, { due_at: '2026-03-02T13:00:00.000Z', unlock_at: null, lock_at: null, only_visible_to_overrides: false });
    a.lacksKey(w.body, 'assignment_overrides', 'overrides stay exactly as they are');
  });

  test('nothing is written when the copy already has those dates', () => {
    const w = S().datesWrite({ type: 'quiz' }, { due_at: '2026-03-02T13:00:00.000Z', unlock_at: null, lock_at: null },
      { due_at: '2026-03-02T13:00:10Z', unlock_at: null, lock_at: null });
    a.ok(w.unchanged);
  });

  test('an item assigned only to some students there, or with checkpoints, is left alone', () => {
    const only = S().datesWrite({ type: 'assignment' }, { due_at: 'x' }, { only_visible_to_overrides: true });
    a.ok(only.skip && /assigned only/.test(only.skip));
    const cp = S().datesWrite({ type: 'discussion', graded: true }, { due_at: 'x' }, { checkpoints: [{ tag: 'reply_to_topic' }] });
    a.ok(cp.skip && /checkpoint/.test(cp.skip));
  });

  test('announcements go through the topic, modules through module[unlock_at]; no due date on ungraded discussions', () => {
    const t = S().datesWrite({ type: 'announcement' }, { delayed_post_at: 'p', lock_at: null }, null);
    a.eq(t.via, 'topic');
    a.deep(t.body, { delayed_post_at: 'p', lock_at: null });
    const m = S().datesWrite({ type: 'module' }, { unlock_at: 'u' }, { unlock_at: null });
    a.deep(m, { via: 'module', body: { module: { unlock_at: 'u' } } });
    const d = S().datesWrite({ type: 'discussion', graded: false }, { due_at: 'ignored', unlock_at: 'u', lock_at: null }, {});
    a.lacksKey(d.body, 'due_at');
  });
});

suite('copy to sections: section notes and change tracking', (test) => {
  test('a note is escaped, kept as paragraphs, and found again', () => {
    const html = S().noteHtml('Period 3: bring <calculators>\n\nDue in class');
    a.ok(html.indexOf('data-cgp-section-note') > 0);
    a.ok(html.indexOf('&lt;calculators&gt;') > 0, 'escaped');
    const back = S().splitNote(html + '<p>Body</p>');
    a.eq(back.note, 'Period 3: bring <calculators>\n\nDue in class');
    a.eq(back.html, '<p>Body</p>');
    a.eq(S().noteHtml('   '), '');
  });

  test('replacing a note leaves exactly one; a blank note removes it; nested divs are handled', () => {
    const one = S().withNote('<p>Body</p>', 'A');
    const two = S().withNote(one, 'B');
    a.eq((two.match(/data-cgp-section-note/g) || []).length, 1);
    a.eq(S().splitNote(two).note, 'B');
    a.eq(S().withNote(two, ''), '<p>Body</p>');
    const edited = '<div style="x" data-cgp-section-note="1"><div><p>Edited <b>there</b></p></div></div><p>Body</p>';
    a.eq(S().splitNote(edited).html, '<p>Body</p>');
    a.eq(S().splitNote(edited).note, 'Edited there');
    a.eq(S().withNote('<p>Body</p>', 'A'), S().withNote(S().withNote('<p>Body</p>', 'A'), 'A'), 'idempotent');
  });

  test('fingerprints compare text: links to other ids and notes do not count', () => {
    const src = '<p>Read <a href="/courses/1/files/5/preview">the lab</a> first.</p>';
    const dest = S().noteHtml('P3 only') + '<p>Read <a href="https://x.instructure.com/courses/2/files/88/preview?verifier=z">the lab</a>  first.</p>';
    a.eq(S().fingerprint(src), S().fingerprint(dest));
    a.ok(S().fingerprint(src) !== S().fingerprint('<p>Read the lab second.</p>'));
    a.eq(S().fingerprint('<p>a&nbsp;&amp;&#39;b</p>'), S().fingerprint("<p>a &'b</p>"));
  });

  test('a section’s copy is same, stale, edited, or differs (no record here)', () => {
    const v1 = '<p>Version one</p>';
    const v2 = '<p>Version two</p>';
    const edited = '<p>Version one, changed for Period 3</p>';
    a.eq(S().compareCopy(v1, v1, null), 'same');
    a.eq(S().compareCopy(v2, v1, S().fingerprint(v1)), 'stale');
    a.eq(S().compareCopy(v2, edited, S().fingerprint(v1)), 'edited');
    a.eq(S().compareCopy(v2, edited, null), 'differs');
    a.ok(S().defaultReplace('stale') && S().defaultReplace('same') && S().defaultReplace('new'));
    a.not(S().defaultReplace('edited'), 'edited there: kept unless the teacher says');
    a.not(S().defaultReplace('differs'), 'unknown: kept unless the teacher says');
  });

  test('a same-titled item from elsewhere is spotted', () => {
    a.eq(S().lookalike([{ id: '1', title: 'Lab 4 ' }], 'lab 4').id, '1');
    a.eq(S().lookalike([{ id: '1', title: 'Lab 4b' }], 'Lab 4'), null);
  });
});

suite('copy to sections: linked sections and modules', (test) => {
  const O = 'https://school.instructure.com';
  test('linking puts every course in one group and takes it out of any other', () => {
    let g = S().setGroup([], O, ['1', '2', '3']);
    a.deep(g.map((x) => x.courseIds), [['1', '2', '3']]);
    a.deep(S().siblings(g, O, '2'), ['1', '3']);
    a.deep(S().siblings(g, 'https://other.instructure.com', '2'), [], 'another Canvas is another world');
    g = S().setGroup(g, O, ['3', '4']);
    a.deep(g.map((x) => x.courseIds), [['3', '4'], ['1', '2']], 'newest first');
    g = S().setGroup(g, O, ['2']);
    a.deep(g.map((x) => x.courseIds), [['3', '4']], 'a group left with one course goes away');
  });

  test('linked sections are a sanitized setting that saves as its own sync item', () => {
    const v = globalThis.CGP.sanitizeSettings({ sectionGroups: [
      { origin: 'https://School.instructure.com/', courseIds: [1, '2', 2, 'x'], names: { 1: 'Bio P1', 9: 'stray' } },
      { origin: 'javascript:alert(1)', courseIds: [3, 4] },
      { origin: O, courseIds: ['2', '5'] }
    ] });
    a.deep(v.sectionGroups, [{ origin: O, courseIds: ['1', '2'], names: { 1: 'Bio P1' } }], 'a course is in one group; bad origins dropped');
    a.deep(globalThis.CGP.sanitizeSettings({ sectionGroups: 'nope' }).sectionGroups, []);
    const base = globalThis.CGP.sanitizeSettings({});
    const next = globalThis.CGP.sanitizeSettings({ sectionGroups: [{ origin: O, courseIds: [1, 2] }] });
    const plan = globalThis.CGP.settingsStorage.plan({}, base, next);
    a.deep(Object.keys(plan.set), ['cgp.setting.sectionGroups']);
  });

  test('other sections are suggested by name in the same term', () => {
    const courses = [
      { id: 1, name: 'AP Chemistry - Period 2', term: { name: 'Fall 2026' } },
      { id: 2, name: 'AP Chemistry (P4)', term: { name: 'Fall 2026' } },
      { id: 3, name: 'AP Chemistry - Period 6', term: { name: 'Fall 2025' } },
      { id: 4, name: 'Honors Chemistry - Period 3', term: { name: 'Fall 2026' } },
      { id: 5, name: 'AP Chemistry Section 7', term: { name: 'Fall 2026' } }
    ];
    a.deep(S().suggestSiblings(courses, courses[0]), ['2', '5']);
    a.eq(S().baseName('Biology - 3'), S().baseName('Biology (Block 5)'));
    a.ok(S().baseName('Algebra 1 - Block 3') !== S().baseName('Algebra 2 - Block 3'), 'a level number is not a section');
  });

  test('a copy goes in the module that is the copy of its module, else the one with that name', () => {
    const idx = S().moduleIndex([
      { id: 10, name: 'Unit 1', items: [{ type: 'SubHeader' }, { type: 'Assignment', content_id: 5 }, { type: 'Page', content_id: 7, page_url: 'intro' }] }
    ]);
    a.deep(idx['assignment:5'], [{ moduleId: '10', moduleName: 'Unit 1', position: 2 }]);
    a.ok(idx['pageurl:intro'] && idx['page:7']);
    const place = idx['assignment:5'][0];
    a.deep(S().destModuleFor(place, { modules: { '10': '110' } }, [{ id: 110, name: 'Renamed' }, { id: 111, name: 'Unit 1' }]),
      { id: '110', name: 'Renamed', position: 2 }, 'the mapped copy wins over a name');
    a.deep(S().destModuleFor(place, {}, [{ id: 111, name: 'unit 1' }]), { id: '111', name: 'unit 1', position: 2 });
    a.eq(S().destModuleFor(place, {}, [{ id: 111, name: 'Unit 1' }, { id: 112, name: 'Unit 1' }]), null, 'two candidates: guess neither');
    a.eq(S().destModuleFor(place, {}, []), null);
  });

  test('a module’s dated items are its assignments, quizzes and discussions', () => {
    const kids = S().moduleChildren([{ type: 'SubHeader' }, { type: 'Assignment', content_id: 1, title: 'A' }, { type: 'Quiz', content_id: 2 },
      { type: 'Discussion', content_id: 3 }, { type: 'ExternalUrl' }, { type: 'File', content_id: 4 }, { type: 'Page', content_id: 5 }]);
    a.deep(kids.map((k) => k.type + k.id), ['assignment1', 'quiz2', 'discussion3']);
  });
});

/* ----------------------------------------------------------- fake Canvas */

function fakeCanvas(opts) {
  opts = opts || {};
  const calls = [];
  const db = {
    migrations: {},          // dest -> [migration]
    mappings: {},            // dest -> mapping
    items: {},               // 'course:type:id' -> object
    details: {},             // 'course:type:id' -> date_details
    pollsUntilDone: opts.pollsUntilDone === undefined ? 1 : opts.pollsUntilDone,
    nextMig: 500
  };
  const key = (c, t, id) => `${c}:${t === 'announcement' ? 'discussion' : t}:${id}`;
  function err(status, extra) { return Object.assign(new globalThis.CGP.CanvasApiError('Canvas ' + status, {}), { status }, extra || {}); }
  const api = {
    calls,
    db,
    startCourseCopy(dest, body) {
      calls.push(['copy', dest, body]);
      if (opts.refuseCopy) return Promise.reject(err(401, { canvasStatus: 'unauthorized' }));
      const id = String(db.nextMig++);
      const m = { id, migration_type: 'course_copy_importer', workflow_state: 'queued', settings: { source_course_id: body.settings.source_course_id }, polls: 0, body };
      (db.migrations[dest] = db.migrations[dest] || []).unshift(m);
      return Promise.resolve({ id, workflow_state: 'pre_processing' });
    },
    contentMigration(dest, id) {
      calls.push(['poll', dest, id]);
      const m = (db.migrations[dest] || []).find((x) => x.id === String(id));
      m.polls++;
      if (m.polls > db.pollsUntilDone && m.workflow_state !== 'completed') {
        m.workflow_state = opts.failCopy ? 'failed' : 'completed';
        if (!opts.failCopy && opts.onComplete) opts.onComplete(dest, m);
      }
      return Promise.resolve({ id: m.id, workflow_state: m.workflow_state === 'queued' ? 'queued' : m.workflow_state });
    },
    contentMigrations(dest) { return Promise.resolve((db.migrations[dest] || []).slice()); },
    assetIdMapping(dest) { calls.push(['mapping', dest]); return Promise.resolve(db.mappings[dest] || {}); },
    migrationIssues() { return Promise.resolve(opts.issues || []); },
    dateDetails(c, t, id) {
      calls.push(['getDates', c, t, id]);
      const d = db.details[key(c, t, id)];
      return d ? Promise.resolve(Object.assign({}, d)) : Promise.reject(err(404));
    },
    putDateDetails(c, t, id, body) {
      calls.push(['putDates', c, t, id, body]);
      if (opts.datesStatus) return Promise.reject(err(opts.datesStatus));
      Object.assign(db.details[key(c, t, id)], body);
      return Promise.resolve(null);
    },
    sectionItem(c, t, id) {
      calls.push(['get', c, t, id]);
      const o = db.items[key(c, t, id)];
      return o ? Promise.resolve(JSON.parse(JSON.stringify(o))) : Promise.reject(err(404));
    },
    updateSectionItem(c, t, id, body) {
      calls.push(['put', c, t, id, body]);
      Object.assign(db.items[key(c, t, id)], body.module || body.assignment || body.quiz || body.wiki_page || body);
      return Promise.resolve(db.items[key(c, t, id)]);
    },
    setItemHtml(c, t, id, html) {
      calls.push(['html', c, t, id, html]);
      const o = db.items[key(c, t, id)];
      if (t === 'assignment' || t === 'quiz') o.description = html; else if (t === 'page') o.body = html; else o.message = html;
      return Promise.resolve(o);
    },
    setItemPublished(c, t, id, on) {
      calls.push(['publish', c, t, id, on]);
      if (opts.refuseUnpublish && !on) return Promise.reject(err(400, { canvasMessage: "Can't unpublish if there are student submissions" }));
      db.items[key(c, t, id)].published = on;
      return Promise.resolve(null);
    },
    courseItems(c, t) { return Promise.resolve((opts.lists && opts.lists[c + ':' + t]) || []); },
    modulesWithItems(c) { return Promise.resolve((opts.modules && opts.modules[c]) || []); },
    assignmentGroups(c) { return Promise.resolve((opts.groups && opts.groups[c]) || []); }
  };
  return api;
}

function memStore() {
  const mem = {};
  return {
    mem,
    get: (k) => {
      if (k === null) return Promise.resolve(Object.assign({}, mem));
      const out = {};
      [].concat(k).forEach((x) => { if (x in mem) out[x] = mem[x]; });
      return Promise.resolve(out);
    },
    set: (o) => { Object.assign(mem, o); return Promise.resolve(); },
    remove: (ks) => { [].concat(ks).forEach((x) => delete mem[x]); return Promise.resolve(); }
  };
}

function copier(api, store) {
  loadRunner();
  return new globalThis.CGP.SectionCopier({
    api, store: store || memStore(), origin: 'https://school.instructure.com',
    sleep: () => Promise.resolve(), pollMs: 1
  });
}

const ASSIGNMENT = { type: 'assignment', id: '5', title: 'Lab 4', published: true, html: '<p>Do the lab.</p>' };

/* What Canvas's copy leaves in the destination for the item: the source's
 * HTML (with its own note, if it had one) and the source's dates. */
function landCopy(api, dest, destId, srcHtml, extra) {
  api.db.mappings[dest] = Object.assign({ assignments: { '5': destId } }, extra && extra.mapping);
  api.db.items[`${dest}:assignment:${destId}`] = { id: destId, name: 'Lab 4', description: srcHtml, published: true, workflow_state: 'published' };
  api.db.details[`${dest}:assignment:${destId}`] = Object.assign({ due_at: '2026-03-02T13:00:00Z', unlock_at: null, lock_at: null, only_visible_to_overrides: false }, extra && extra.details);
}

suite('copy to sections: the copy runner', (test) => {
  test('a first copy: Canvas copies, the copy is found by mapping, then gets this section’s dates and note', async () => {
    let api;
    api = fakeCanvas({ onComplete: (dest) => landCopy(api, dest, '705', S().noteHtml('Period 2 only') + '<p>Do the lab.</p>') });
    const store = memStore();
    const c = copier(api, store);
    const steps = [];
    const r = await c.run({
      srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'copy',
      dates: { due_at: '2026-03-03T17:45:00.000Z', unlock_at: null, lock_at: null },
      note: 'Period 4: lab is Thursday', publish: 'match', module: { id: '90', position: 2 }, assignmentGroupId: '7'
    }, (s) => steps.push(s));
    a.ok(r.ok, r.error);
    a.eq(r.destId, '705');
    a.eq(r.url, '/courses/22/assignments/705');
    const copy = api.calls.find((x) => x[0] === 'copy');
    a.eq(copy[1], '22');
    a.eq(copy[2].settings.insert_into_module_id, '90');
    a.eq(copy[2].settings.move_to_assignment_group_id, '7');
    const put = api.calls.find((x) => x[0] === 'putDates');
    a.deep(put[4], { due_at: '2026-03-03T17:45:00.000Z', unlock_at: null, lock_at: null, only_visible_to_overrides: false });
    const html = api.calls.find((x) => x[0] === 'html')[4];
    a.eq(S().splitNote(html).note, 'Period 4: lab is Thursday', 'this section’s note, not the source section’s');
    a.eq((html.match(/data-cgp-section-note/g) || []).length, 1);
    a.not(api.calls.some((x) => x[0] === 'publish'), 'already published like the source');
    a.eq(Object.keys(store.mem).filter((k) => k.indexOf('cgp.sections.job.') === 0).length, 0, 'job done and cleared');
    const fp = Object.keys(store.mem).filter((k) => k.indexOf('cgp.sections.fp.') === 0);
    a.eq(fp.length, 1, 'the copy is remembered');
    a.eq(store.mem[fp[0]].fp, S().fingerprint('<p>Do the lab.</p>'));
    a.ok(steps.indexOf('Canvas is copying') >= 0);
  });

  test('a copy Canvas fails is reported with Canvas’s reason, and nothing else is written', async () => {
    const api = fakeCanvas({ failCopy: true, issues: [{ description: 'Could not copy rubric', workflow_state: 'active' }] });
    const store = memStore();
    const r = await copier(api, store).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'copy', dates: {}, publish: 'match' });
    a.not(r.ok);
    a.ok(/Could not copy rubric/.test(r.error));
    a.not(api.calls.some((x) => x[0] === 'putDates' || x[0] === 'html'));
    a.eq(Object.keys(store.mem).length, 0);
  });

  test('a refused copy (no rights in that course) says so', async () => {
    const api = fakeCanvas({ refuseCopy: true });
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'copy', dates: {}, publish: 'match' });
    a.not(r.ok);
    a.ok(/permission/.test(r.error), r.error);
  });

  test('Canvas finishing without reporting the copy is an error, not a guess', async () => {
    const api = fakeCanvas({ onComplete: () => {} });
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'copy', dates: {}, publish: 'match' });
    a.not(r.ok);
    a.ok(/did not report where the copy is/.test(r.error));
    a.not(api.calls.some((x) => x[0] === 'putDates'));
  });

  test('a copy still running when the tab gives up is finished by the next page', async () => {
    let api;
    api = fakeCanvas({ pollsUntilDone: 1000, onComplete: (dest) => landCopy(api, dest, '705', '<p>Do the lab.</p>') });
    const store = memStore();
    const c = copier(api, store);
    c.maxWaitMs = 0;
    const r = await c.run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'copy',
      dates: { due_at: '2026-03-04T13:00:00.000Z', unlock_at: null, lock_at: null }, note: '', publish: 'match' });
    a.ok(r.pending && !r.ok);
    a.eq(Object.keys(store.mem).filter((k) => k.indexOf('cgp.sections.job.') === 0).length, 1, 'kept to finish later');
    a.not(api.calls.some((x) => x[0] === 'putDates'));
    // Later, on another page: Canvas has finished.
    api.db.pollsUntilDone = 0;
    const later = copier(api, store);
    a.eq((await later.resumePending()).length, 0, 'the first tab’s claim is still fresh');
    later.now = () => Date.now() + 3 * 60 * 1000;
    const done = await later.resumePending();
    a.eq(done.length, 1);
    a.ok(done[0].result.ok, done[0].result.error);
    a.eq(api.calls.filter((x) => x[0] === 'putDates').pop()[4].due_at, '2026-03-04T13:00:00.000Z');
    a.eq(Object.keys(store.mem).filter((k) => k.indexOf('cgp.sections.job.') === 0).length, 0);
  });

  test('another Canvas’s jobs are left alone, and old ones are dropped', async () => {
    const api = fakeCanvas();
    const store = memStore();
    store.mem['cgp.sections.job.a'] = { id: 'a', origin: 'https://other.instructure.com', startedAt: Date.now(), migrationId: '1', task: { item: {} } };
    store.mem['cgp.sections.job.b'] = { id: 'b', origin: 'https://school.instructure.com', startedAt: Date.now() - 5 * 86400000, migrationId: '1', task: { item: {} } };
    const done = await copier(api, store).resumePending();
    a.eq(done.length, 0);
    a.ok(store.mem['cgp.sections.job.a']);
    a.not(store.mem['cgp.sections.job.b']);
  });

  test('dates are not forced onto a copy assigned only to some students there', async () => {
    let api;
    api = fakeCanvas({ onComplete: (dest) => landCopy(api, dest, '705', '<p>Do the lab.</p>', { details: { only_visible_to_overrides: true } }) });
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'copy',
      dates: { due_at: '2026-03-04T13:00:00.000Z', unlock_at: null, lock_at: null }, publish: 'match' });
    a.ok(r.ok);
    a.not(api.calls.some((x) => x[0] === 'putDates'));
    a.ok(r.warnings.some((w) => /assigned only/.test(w)));
  });

  test('a closed grading period (403) is a warning on that section, not a failed copy', async () => {
    let api;
    api = fakeCanvas({ datesStatus: 403, onComplete: (dest) => landCopy(api, dest, '705', '<p>Do the lab.</p>') });
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'copy',
      dates: { due_at: '2026-03-04T13:00:00.000Z', unlock_at: null, lock_at: null }, publish: 'match' });
    a.ok(r.ok);
    a.ok(r.warnings.some((w) => /closed grading period/.test(w)));
  });

  test('publishing follows the choice; a refusal is a warning', async () => {
    let api;
    api = fakeCanvas({ refuseUnpublish: true, onComplete: (dest) => landCopy(api, dest, '705', '<p>Do the lab.</p>') });
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'copy', dates: {}, publish: 'unpublished' });
    a.ok(r.ok);
    a.deep(api.calls.find((x) => x[0] === 'publish').slice(1), ['22', 'assignment', '705', false]);
    a.ok(r.warnings.some((w) => /Still published/.test(w)));
  });

  test('keeping a section’s own version copies nothing; only dates (and its note) change', async () => {
    const api = fakeCanvas();
    landCopy(api, '22', '705', S().noteHtml('Mine') + '<p>Period 4 rewrite.</p>');
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'keep', destId: '705',
      dates: { due_at: '2026-03-05T13:00:00.000Z', unlock_at: null, lock_at: null }, note: 'Mine', publish: 'match' });
    a.ok(r.ok, r.error);
    a.not(api.calls.some((x) => x[0] === 'copy'), 'no Canvas copy');
    a.ok(api.calls.some((x) => x[0] === 'putDates'));
    a.not(api.calls.some((x) => x[0] === 'html'), 'same note: instructions untouched');
  });

  test('a module copy dates its items through the same mapping', async () => {
    let api;
    api = fakeCanvas({ onComplete: (dest) => {
      api.db.mappings[dest] = { modules: { '3': '303' }, assignments: { '5': '705' }, quizzes: { '6': '706' } };
      api.db.items[`${dest}:module:303`] = { id: '303', name: 'Unit 1', unlock_at: null };
      landCopy(api, dest, '705', '<p>Do the lab.</p>', { mapping: { modules: { '3': '303' }, quizzes: { '6': '706' } } });
      api.db.items[`${dest}:quiz:706`] = { id: '706', title: 'Q', description: '', published: true };
      api.db.details[`${dest}:quiz:706`] = { due_at: null, unlock_at: null, lock_at: null };
    } });
    const r = await copier(api).run({
      srcCourseId: '11', destCourseId: '22', item: { type: 'module', id: '3', title: 'Unit 1', published: true }, mode: 'copy',
      dates: { unlock_at: '2026-03-01T13:00:00.000Z' }, publish: 'match',
      children: [
        { type: 'assignment', id: '5', title: 'Lab 4', dates: { due_at: '2026-03-06T13:00:00.000Z', unlock_at: null, lock_at: null } },
        { type: 'quiz', id: '6', title: 'Q', dates: { due_at: '2026-03-07T13:00:00.000Z', unlock_at: null, lock_at: null } },
        { type: 'assignment', id: '99', title: 'Gone', dates: {} }
      ]
    });
    a.ok(r.ok, r.error);
    a.deep(api.calls.find((x) => x[0] === 'put')[4], { module: { unlock_at: '2026-03-01T13:00:00.000Z' } });
    const puts = api.calls.filter((x) => x[0] === 'putDates').map((x) => x[2] + ':' + x[3] + '=' + x[4].due_at);
    a.deep(puts, ['assignment:705=2026-03-06T13:00:00.000Z', 'quiz:706=2026-03-07T13:00:00.000Z']);
    a.ok(r.warnings.some((w) => /“Gone” was not found/.test(w)));
  });
});

suite('copy to sections: looking before copying', (test) => {
  test('new, already there (same / edited there), deleted there, and a lookalike', async () => {
    const api = fakeCanvas({
      lists: { '33:assignment': [{ id: 900, name: 'Lab 4', submission_types: ['online_upload'] }] },
      groups: { '11': [{ id: 7, name: 'Labs' }], '22': [{ id: 70, name: 'labs' }], '33': [{ id: 71, name: 'Homework' }], '44': [], '55': [] }
    });
    const src = Object.assign({}, ASSIGNMENT, { assignmentGroupId: '7', htmlLoaded: true });
    // 22: copied before, unchanged since.  44: copied, then edited there.
    // 55: copied, then deleted there.  33: never copied, has its own "Lab 4".
    ['22', '44', '55'].forEach((d) => { api.db.migrations[d] = [{ id: '1', migration_type: 'course_copy_importer', workflow_state: 'completed', settings: { source_course_id: '11' } }]; });
    landCopy(api, '22', '705', '<p>Do the lab.</p>');
    landCopy(api, '44', '805', '<p>Do the lab, Period 6 version.</p>');
    api.db.mappings['55'] = { assignments: { '5': '905' } };
    const store = memStore();
    const c = copier(api, store);
    await c.remember('11', src, '44', '805', '<p>Do the lab.</p>');
    const out = await c.survey('11', [src], ['22', '33', '44', '55'], { placeInModules: false });
    const by = {};
    out.dests.forEach((d) => { by[d.courseId] = d.items['assignment:5']; });
    a.eq(by['22'].status, 'same');
    a.eq(by['22'].destId, '705');
    a.eq(by['33'].status, 'new');
    a.eq(by['33'].lookalike.id, '900');
    a.eq(by['33'].groupMissing, 'Labs');
    a.eq(by['44'].status, 'edited');
    a.eq(by['55'].status, 'restore');
    a.eq(by['22'].assignmentGroupId, '70', 'matched by name');
    a.not(api.calls.some((x) => ['copy', 'putDates', 'html', 'publish', 'put'].indexOf(x[0]) >= 0), 'a survey writes nothing');
  });

  test('a section Canvas will not let this teacher read is reported, not skipped silently', async () => {
    const api = fakeCanvas();
    api.contentMigrations = () => Promise.reject(Object.assign(new globalThis.CGP.CanvasApiError('x', {}), { status: 401, canvasStatus: 'unauthorized' }));
    const out = await copier(api).survey('11', [Object.assign({}, ASSIGNMENT, { htmlLoaded: true })], ['22'], {});
    a.ok(/can’t add content/.test(out.dests[0].error));
  });
});

suite('copy to sections: review fixes', (test) => {
  test('a time a DST change skips moves forward by the gap, in every zone', () => {
    a.eq(S().isoToLocal(S().localToIso('2026-03-08T02:30', TZ), TZ), '2026-03-08T03:30');
    a.eq(S().isoToLocal(S().localToIso('2026-03-29T01:30', 'Europe/London'), 'Europe/London'), '2026-03-29T02:30');
    a.eq(S().isoToLocal(S().localToIso('2026-10-04T02:15', 'Australia/Lord_Howe'), 'Australia/Lord_Howe'), '2026-10-04T02:45', 'a 30-minute gap');
    a.eq(S().localToIso('2026-11-01T01:30', TZ), '2026-11-01T05:30:00.000Z', 'a repeated time is its first occurrence');
    a.eq(S().localToIso('2026-07-01T09:00', 'Asia/Kolkata'), '2026-07-01T03:30:00.000Z');
  });

  test('an 11:59:59 PM deadline keeps its seconds when moved to another day', () => {
    a.eq(S().localToIsoKeeping('2026-03-04T23:59', TZ, '2026-03-04T04:59:59Z'), '2026-03-05T04:59:59.000Z');
    a.eq(S().localToIsoKeeping('2026-03-04T22:00', TZ, '2026-03-04T04:59:59Z'), '2026-03-05T03:00:00.000Z', 'another time: whole minutes');
    a.eq(S().localToIsoKeeping('', TZ, '2026-03-04T04:59:59Z'), null);
  });

  test('an older section-specific discussion is not given dates (that would open it to everyone)', () => {
    const w = S().datesWrite({ type: 'discussion', graded: false }, { unlock_at: 'u', lock_at: null },
      { unlock_at: null, lock_at: null, visible_to_everyone: false, only_visible_to_overrides: false });
    a.ok(w.skip && /particular sections/.test(w.skip));
  });

  test('linked sections stay inside one sync item: names go first, then the oldest groups', () => {
    const O = 'https://school.instructure.com';
    const long = 'x'.repeat(80);
    const groups = [];
    for (let g = 0; g < 30; g++) {
      const ids = []; const names = {};
      for (let c = 0; c < 12; c++) { const id = String(g * 100 + c + 1); ids.push(id); names[id] = long; }
      groups.push({ origin: O, courseIds: ids, names });
    }
    const out = globalThis.CGP.cleanSectionGroups(groups);
    a.ok(globalThis.CGP.util.byteLength(JSON.stringify(out)) <= 6500);
    a.ok(out.length >= 10, 'ids alone fit many groups');
    a.eq(Object.keys(out[0].names).length, 12, 'the newest group keeps its names');
    a.eq(Object.keys(out[out.length - 1].names).length, 0);
  });

  test('a Canvas call failing mid-run resolves with the job kept, never rejects', async () => {
    let api;
    api = fakeCanvas({ onComplete: (dest) => landCopy(api, dest, '705', '<p>x</p>') });
    api.assetIdMapping = () => Promise.reject(Object.assign(new globalThis.CGP.CanvasApiError('x', {}), { status: 400 }));
    const store = memStore();
    const r = await copier(api, store).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'copy', dates: {}, publish: 'match' });
    a.not(r.ok);
    a.ok(r.pending);
    a.eq(Object.keys(store.mem).filter((k) => k.indexOf('cgp.sections.job.') === 0).length, 1);
  });

  test('no dates are written when the copy’s assignment can’t be read', async () => {
    let api;
    api = fakeCanvas({ onComplete: (dest) => landCopy(api, dest, '705', '<p>x</p>') });
    api.dateDetails = () => Promise.reject(Object.assign(new globalThis.CGP.CanvasApiError('x', {}), { status: 503 }));
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'copy',
      dates: { due_at: '2026-03-04T13:00:00.000Z', unlock_at: null, lock_at: null }, publish: 'match' });
    a.ok(r.ok);
    a.not(api.calls.some((x) => x[0] === 'putDates'));
    a.ok(r.warnings.some((w) => /did not say how it is assigned/.test(w)));
  });

  test('keeping a section’s version leaves its publishing alone on “Same as this section”', async () => {
    const api = fakeCanvas();
    landCopy(api, '22', '705', '<p>Mine</p>');
    api.db.items['22:assignment:705'].published = false;
    await copier(api).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'keep', destId: '705', dates: {}, note: '', publish: 'match' });
    a.not(api.calls.some((x) => x[0] === 'publish'));
    await copier(api).run({ srcCourseId: '11', destCourseId: '22', item: ASSIGNMENT, mode: 'keep', destId: '705', dates: {}, note: '', publish: 'published' });
    a.ok(api.calls.some((x) => x[0] === 'publish' && x[4] === true), 'an explicit choice still applies');
  });

  test('keeping a module dates its items through the mapping the survey found', async () => {
    const api = fakeCanvas();
    api.db.items['22:module:303'] = { id: '303', name: 'Unit 1', unlock_at: null, published: true };
    landCopy(api, '22', '705', '<p>x</p>');
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', mode: 'keep', destId: '303',
      item: { type: 'module', id: '3', title: 'Unit 1' }, dates: { unlock_at: null }, publish: 'match',
      mapping: { modules: { '3': '303' }, assignments: { '5': '705' } },
      children: [{ type: 'assignment', id: '5', title: 'Lab 4', dates: { due_at: '2026-03-09T13:00:00.000Z', unlock_at: null, lock_at: null } }] });
    a.ok(r.ok, r.error);
    a.eq(r.warnings.length, 0, r.warnings.join(' | '));
    a.eq(api.calls.find((x) => x[0] === 'putDates')[3], '705');
  });

  test('“Leave copies unpublished” unpublishes a copied module', async () => {
    let api;
    api = fakeCanvas({ onComplete: (dest) => {
      api.db.mappings[dest] = { modules: { '3': '303' } };
      api.db.items[`${dest}:module:303`] = { id: '303', name: 'Unit 1', unlock_at: null, published: true };
    } });
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', mode: 'copy', item: { type: 'module', id: '3', title: 'Unit 1', published: true },
      dates: { unlock_at: null }, publish: 'unpublished', children: [] });
    a.ok(r.ok, r.error);
    a.deep(api.calls.filter((x) => x[0] === 'put').pop()[4], { module: { published: false } });
  });

  test('a New Quiz copy is waited for until Canvas has finished importing it', async () => {
    let api;
    let gets = 0;
    api = fakeCanvas({ onComplete: (dest) => landCopy(api, dest, '705', '<p>x</p>') });
    const realGet = api.sectionItem;
    api.sectionItem = (c, t, id) => realGet(c, t, id).then((o) => {
      if (t === 'assignment' && gets++ < 2) o.workflow_state = 'importing';
      return o;
    });
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', item: Object.assign({}, ASSIGNMENT, { newQuiz: true }), mode: 'copy',
      dates: { due_at: '2026-03-04T13:00:00.000Z', unlock_at: null, lock_at: null }, publish: 'match' });
    a.ok(r.ok, r.error);
    const firstWrite = api.calls.findIndex((x) => x[0] === 'putDates');
    a.ok(gets >= 3 && firstWrite > 0, 'dates only after it left "importing"');
  });

  test('a module copy puts back the notes that section had on its items', async () => {
    let api;
    api = fakeCanvas({ onComplete: (dest) => {
      api.db.mappings[dest] = { modules: { '3': '303' }, assignments: { '5': '705' } };
      api.db.items[`${dest}:module:303`] = { id: '303', name: 'Unit 1', unlock_at: null, published: true };
      landCopy(api, dest, '705', S().noteHtml('Source section note') + '<p>Do the lab.</p>', { mapping: { modules: { '3': '303' } } });
    } });
    const r = await copier(api).run({ srcCourseId: '11', destCourseId: '22', mode: 'copy', item: { type: 'module', id: '3', title: 'Unit 1', published: true },
      dates: { unlock_at: null }, publish: 'match', childNotes: { 'assignment:5': 'P4 note' },
      children: [{ type: 'assignment', id: '5', title: 'Lab 4', dates: { due_at: null, unlock_at: null, lock_at: null } }] });
    a.ok(r.ok, r.error);
    a.eq(S().splitNote(api.db.items['22:assignment:705'].description).note, 'P4 note');
  });

  test('the survey reads an existing copy’s own dates and its items’ notes', async () => {
    const api = fakeCanvas();
    api.db.migrations['22'] = [{ id: '1', migration_type: 'course_copy_importer', workflow_state: 'completed', settings: { source_course_id: '11' } }];
    landCopy(api, '22', '705', S().noteHtml('P4 note') + '<p>Do the lab.</p>', { mapping: { modules: { '3': '303' } } });
    api.db.details['22:assignment:705'].due_at = '2026-03-10T13:00:00Z';
    api.db.items['22:module:303'] = { id: '303', name: 'Unit 1' };
    const mod = { type: 'module', id: '3', title: 'Unit 1', children: [{ type: 'assignment', id: '5', title: 'Lab 4', html: '<p>Do the lab.</p>' }] };
    const out = await copier(api).survey('11', [Object.assign({}, ASSIGNMENT, { htmlLoaded: true }), mod], ['22'], {});
    const asg = out.dests[0].items['assignment:5'];
    a.eq(asg.destDates.due_at, '2026-03-10T13:00:00Z');
    const m = out.dests[0].items['module:3'];
    a.eq(m.childNotes['assignment:5'], 'P4 note');
    a.eq(m.childDates['assignment:5'].due_at, '2026-03-10T13:00:00Z');
    a.eq(m.status, 'same', 'a note is not a change');
  });
});

suite('copy to sections: changes made in a copy', (test) => {
  test('which side changed, from the record of the copy', () => {
    a.eq(S().changeSide('x', 'x', null), 'same');
    a.eq(S().changeSide('a', 'b', null), 'unknown');
    a.eq(S().changeSide('a', 'b', 'a'), 'copy');
    a.eq(S().changeSide('a', 'b', 'b'), 'original');
    a.eq(S().changeSide('a', 'b', 'c'), 'both');
    a.eq(S().srcIdFor({ assignments: { '5': '705', g1: { source: {}, destination: { id: '705' } } } }, 'assignment', '705'), '5');
    a.eq(S().srcIdFor({ assignments: { '5': '705' } }, 'assignment', '9'), null);
  });

  test('links in the copy are turned into the original course’s; unknown ones are reported', () => {
    const inv = S().invertMapping({ files: { '10': '210' }, assignments: { '5': '705' }, modules: { '3': '303' },
      pages: { '7': '807', gx: { source: { id: '7', url: 'intro' }, destination: { id: '807', url: 'intro-2' } } } });
    const src = '<img src="https://s.instructure.com/courses/22/files/210/preview?verifier=V&amp;wrap=1" data-api-endpoint="https://s.instructure.com/api/v1/courses/22/files/210">' +
      '<a href="/courses/22/assignments/705">a</a><a href="/courses/22/pages/intro-2#t">p</a><a href="/courses/22/modules/303">m</a>' +
      '<a href="/courses/22/files/999/download">new</a><a href="/courses/22/pages/only-here">x</a><a href="/courses/22/assignments">all</a>' +
      '<a href="https://evil.example/courses/22/files/210">o</a><a href="/courses/33/files/1">c</a>';
    const t = S().translateLinks(src, '22', '11', inv, 'https://s.instructure.com');
    a.ok(t.html.indexOf('src="/courses/11/files/10/preview?wrap=1"') >= 0, 'file, verifier dropped');
    a.ok(t.html.indexOf('data-api-endpoint="/api/v1/courses/11/files/10"') >= 0);
    a.ok(t.html.indexOf('/courses/11/assignments/5"') >= 0);
    a.ok(t.html.indexOf('/courses/11/pages/intro#t"') >= 0, 'pages by url');
    a.ok(t.html.indexOf('/courses/11/modules/3"') >= 0);
    a.ok(t.html.indexOf('/courses/11/assignments"') >= 0, 'index routes move');
    a.ok(t.html.indexOf('https://evil.example/courses/22/files/210') >= 0, 'another site untouched');
    a.ok(t.html.indexOf('/courses/33/files/1') >= 0, 'another course untouched');
    a.deep(t.missingFiles, ['999']);
    a.deep(t.missingLinks, [{ type: 'pages', ref: 'only-here' }]);
  });

  test('embedded Canvas media and LTI tools come back pointing at the original course', () => {
    const inv = S().invertMapping({ files: { '10': '210' } });
    const src = '<iframe src="https://s.instructure.com/media_attachments_iframe/210?type=video&amp;embedded=true" data-media-id="m-abc"></iframe>' +
      '<iframe src="/media_attachments_iframe/555?type=audio"></iframe>' +
      '<iframe src="https://s.instructure.com/courses/22/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Ftool.example%2Flaunch"></iframe>' +
      '<a href="/courses/22/external_tools/77">tool by id</a>' +
      '<iframe src="https://www.youtube.com/embed/xyz"></iframe>';
    const t = S().translateLinks(src, '22', '11', inv, 'https://s.instructure.com');
    a.ok(t.html.indexOf('src="/media_attachments_iframe/10?type=video&amp;embedded=true" data-media-id="m-abc"') >= 0, 'player moved to the original’s file');
    a.deep(t.missingFiles, ['555'], 'a recording only the copy has is copied over');
    a.ok(t.html.indexOf('/courses/11/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Ftool.example%2Flaunch') >= 0);
    a.deep(t.missingLinks, [{ type: 'link', ref: '/external_tools/77' }], 'a course tool by id cannot be matched');
    a.ok(t.html.indexOf('https://www.youtube.com/embed/xyz') >= 0, 'outside embeds untouched');
    const again = S().translateLinks(src, '22', '11', S().invertMapping({ files: { '10': '210', '666': '555' } }), 'https://s.instructure.com');
    a.ok(again.html.indexOf('/media_attachments_iframe/666?type=audio') >= 0, 'after the copy, its player points at the new file');
  });

  function linked(api) {
    // 11 = Period 2 (original), 22 = Period 4 (copy of assignment 5 as 705).
    api.db.migrations['22'] = [{ id: '1', migration_type: 'course_copy_importer', workflow_state: 'completed', settings: { source_course_id: '11' } }];
    api.db.mappings['22'] = { assignments: { '5': '705' }, files: { '10': '210' } };
    api.db.items['11:assignment:5'] = { id: '5', name: 'Lab 4', description: S().noteHtml('P2 note') + '<p>Do the lab. <a href="/courses/11/files/10/download">Sheet</a></p>', published: true, points_possible: 10, updated_at: '2026-03-01T10:00:00Z' };
    api.db.items['22:assignment:705'] = { id: '705', name: 'Lab 4 (fixed)', description: S().noteHtml('P4 note') +
      '<p>Do the lab carefully. <a href="https://school.instructure.com/courses/22/files/210/download?verifier=abc">Sheet</a> <img src="/courses/22/files/333/preview"></p>',
      published: true, points_possible: 12, updated_at: '2026-03-05T10:00:00Z' };
  }

  function withCustomData(api) {
    const cd = {};
    api.customData = (scope) => {
      const parts = scope.split('/');
      let node = cd;
      for (const p of parts) { if (!node || typeof node !== 'object' || !(p in node)) return Promise.resolve(null); node = node[p]; }
      return Promise.resolve(JSON.parse(JSON.stringify(node)));
    };
    api.deleteCustomData = (scope) => {
      api.calls.push(['customDataDelete', scope]);
      const parts = scope.split('/');
      const last = parts.pop();
      let node = cd;
      for (const p of parts) { if (!node[p]) return Promise.resolve(null); node = node[p]; }
      delete node[last];
      return Promise.resolve(null);
    };
    api.setCustomData = (scope, data) => {
      api.calls.push(['customData', scope, data]);
      const parts = scope.split('/');
      const last = parts.pop();
      let node = cd;
      for (const p of parts) node = node[p] = node[p] || {};
      node[last] = data;
      return Promise.resolve({ data });
    };
    return cd;
  }

  test('copies are found both ways, and a record shared through Canvas tells which side changed', async () => {
    const api = fakeCanvas();
    linked(api);
    withCustomData(api);
    const c = copier(api);
    const asCopy = await c.relations('22', { type: 'assignment', id: '705' }, ['11', '33']);
    a.deep(asCopy.from, [{ courseId: '11', srcId: '5' }]);
    a.deep(asCopy.to, []);
    const asOrig = await c.relations('11', { type: 'assignment', id: '5' }, ['22']);
    a.deep(asOrig.to, [{ courseId: '22', destId: '705' }]);
    // No record yet: unknown. Record the copy as it was copied: the copy changed.
    a.eq((await c.compare('11', { type: 'assignment', id: '5' }, '22', '705')).side, 'unknown');
    await c.remember('11', { type: 'assignment', id: '5' }, '22', '705', '<p>Do the lab. <a>Sheet</a></p>');
    const other = copier(api, memStore()); // another computer: only Canvas's record
    a.eq((await other.compare('11', { type: 'assignment', id: '5' }, '22', '705')).side, 'copy');
    a.ok(api.calls.some((x) => x[0] === 'customData' && x[1] === 'fp/11/assignment_5/22'));
  });

  test('bringing a change back: links and a new file are moved over, notes stay put, backup and undo', async () => {
    let api;
    api = fakeCanvas({ onComplete: (dest, m) => {
      // Canvas copying the file only Period 4 has (333) into Period 2.
      api.db.mappings[dest] = { files: { '333': '444' } };
    } });
    linked(api);
    withCustomData(api);
    const store = memStore();
    const c = copier(api, store);
    const plan = await c.planBack('11', { type: 'assignment', id: '5' }, '22', '705');
    a.deep(plan.missingFiles, ['333']);
    a.ok(plan.titleDiffers && plan.pointsDiffer);
    a.eq(plan.origNote, 'P2 note');
    const r = await c.applyBack(plan, { title: true });
    a.ok(r.ok, r.error);
    const fileCopy = api.calls.find((x) => x[0] === 'copy');
    a.deep(fileCopy.slice(1), ['11', { migration_type: 'course_copy_importer', select: { files: ['333'] }, settings: { source_course_id: '22' } }]);
    const html = api.db.items['11:assignment:5'].description;
    a.eq(S().splitNote(html).note, 'P2 note', 'the original keeps its own note');
    a.ok(html.indexOf('P4 note') < 0, 'the copy’s note does not come along');
    a.ok(html.indexOf('carefully') > 0);
    a.ok(html.indexOf('/courses/11/files/10/download"') > 0, 'existing file mapped back');
    a.ok(html.indexOf('/courses/11/files/444/preview') > 0, 'new file copied and linked');
    a.ok(html.indexOf('/courses/22/') < 0, 'nothing points at Period 4 any more');
    a.eq(api.db.items['11:assignment:5'].name, 'Lab 4 (fixed)');
    a.eq(api.db.items['11:assignment:5'].points_possible, 10, 'points are never changed');
    a.eq((await copier(api, memStore()).compare('11', { type: 'assignment', id: '5' }, '22', '705')).side, 'same', 'in step again');
    await c.undoBack(plan);
    a.eq(api.db.items['11:assignment:5'].name, 'Lab 4');
    a.ok(api.db.items['11:assignment:5'].description.indexOf('carefully') < 0, 'undone');
    a.eq(S().splitNote(api.db.items['11:assignment:5'].description).note, 'P2 note');
    a.eq((await copier(api, memStore()).compare('11', { type: 'assignment', id: '5' }, '22', '705')).side, 'unknown',
      'the copy record is put back as it was (none), so the copy is not mistaken for the earlier version');
  });

  test('undo refuses, writing nothing, when the original was edited again after the bring-back', async () => {
    let api;
    api = fakeCanvas({ onComplete: (dest) => { api.db.mappings[dest] = { files: { '333': '444' } }; } });
    linked(api);
    withCustomData(api);
    const c = copier(api, memStore());
    const r = await c.applyBack(await c.planBack('11', { type: 'assignment', id: '5' }, '22', '705'), { title: true });
    a.ok(r.ok, r.error);
    const edited = api.db.items['11:assignment:5'].description + '<p>Added later.</p>';
    api.db.items['11:assignment:5'].description = edited;
    let err = null;
    try { await c.undoBack({ origCourse: '11', type: 'assignment', origId: '5' }); } catch (e) { err = e; }
    a.ok(err && /changed again/.test(err.message), 'refused');
    a.eq(api.db.items['11:assignment:5'].description, edited, 'the later edit is kept');
  });

  test('a file that cannot be copied leaves its link and says so; the rest still updates', async () => {
    const api = fakeCanvas({ failCopy: true });
    linked(api);
    const r = await copier(api).applyBack(await copier(api).planBack('11', { type: 'assignment', id: '5' }, '22', '705'), {});
    a.ok(r.ok, r.error);
    a.ok(r.warnings.some((w) => /not copied/.test(w)));
    a.eq(api.db.items['11:assignment:5'].name, 'Lab 4', 'title untouched unless asked');
  });
});

suite('copy to sections: second review fixes', (test) => {
  const inv = S().invertMapping({ modules: { '2': '22' }, module_items: { '3': '33' }, assignments: { '5': '705' } });
  const O = 'https://s.instructure.com';
  test('course home, syllabus, module items through the API, module anchors', () => {
    const t = S().translateLinks('<a href="/courses/22">home</a><a href="https://s.instructure.com/courses/22/">h2</a>' +
      '<a href="/courses/22/assignments/syllabus">syl</a>' +
      '<a data-api-endpoint="/api/v1/courses/22/modules/22/items/33">mi</a><a href="/courses/22/modules#module_22">anchor</a>' +
      '<a href="/api/v1/courses/22/modules/22/items/99">gone</a>', '22', '11', inv, O);
    a.ok(t.html.indexOf('href="/courses/11">home') >= 0, t.html);
    a.ok(t.html.indexOf('href="/courses/11/">h2') >= 0);
    a.ok(t.html.indexOf('/courses/11/assignments/syllabus"') >= 0);
    a.ok(t.html.indexOf('"/api/v1/courses/11/modules/2/items/3"') >= 0);
    a.ok(t.html.indexOf('/courses/11/modules#module_2"') >= 0);
    a.ok(t.html.indexOf('/api/v1/courses/22/modules/22/items/99') >= 0, 'an item only the copy has is left');
    a.deep(t.missingLinks, [{ type: 'module item', ref: '99' }]);
  });

  test('another site’s path that happens to contain /courses/N is left alone; http and https are the same Canvas', () => {
    const t = S().translateLinks('<a href="https://example.com/x/courses/22/assignments/705">x</a>' +
      '<a href="http://s.instructure.com/courses/22/assignments/705">y</a> see /courses/22/assignments/705 here', '22', '11', inv, O);
    a.ok(t.html.indexOf('https://example.com/x/courses/22/assignments/705') >= 0);
    a.ok(t.html.indexOf('href="/courses/11/assignments/5">y') >= 0);
    a.ok(t.html.indexOf('see /courses/11/assignments/5 here') >= 0);
  });

  test('the original’s own note keeps its formatting', () => {
    const block = '<div data-cgp-section-note="1" style="x"><p>Bring <a href="/x">the <b>sheet</b></a></p></div>';
    a.eq(S().withNoteBlock('<div data-cgp-section-note="1"><p>old</p></div><p>Body</p>', block), block + '<p>Body</p>');
    a.eq(S().splitNote(block + '<p>B</p>').block, block);
  });

  test('nothing is written when the original changed after the review opened', async () => {
    const api = fakeCanvas();
    api.db.mappings['22'] = { assignments: { '5': '705' } };
    api.db.migrations['22'] = [{ id: '1', migration_type: 'course_copy_importer', workflow_state: 'completed', settings: { source_course_id: '11' } }];
    api.db.items['11:assignment:5'] = { id: '5', name: 'Lab', description: '<p>v1</p>' };
    api.db.items['22:assignment:705'] = { id: '705', name: 'Lab', description: '<p>v1 edited</p>' };
    const c = copier(api);
    const plan = await c.planBack('11', { type: 'assignment', id: '5' }, '22', '705');
    api.db.items['11:assignment:5'].description = '<p>v2 from another tab</p>';
    const r = await c.applyBack(plan, {});
    a.not(r.ok);
    a.ok(/changed since this review opened/.test(r.error));
    a.eq(api.db.items['11:assignment:5'].description, '<p>v2 from another tab</p>');
  });

  test('a failure after the write still reports the update (and keeps Undo)', async () => {
    const api = fakeCanvas();
    api.db.mappings['22'] = { assignments: { '5': '705' } };
    api.db.migrations['22'] = [{ id: '1', migration_type: 'course_copy_importer', workflow_state: 'completed', settings: { source_course_id: '11' } }];
    api.db.items['11:assignment:5'] = { id: '5', name: 'Lab', description: '<p>v1</p>' };
    api.db.items['22:assignment:705'] = { id: '705', name: 'Lab', description: '<p>v1 edited</p>' };
    const store = memStore();
    const c = copier(api, store);
    const plan = await c.planBack('11', { type: 'assignment', id: '5' }, '22', '705');
    const realGet = api.sectionItem;
    let n = 0;
    api.sectionItem = (...args) => (n++ >= 1 ? Promise.reject(new Error('blip')) : realGet(...args));
    const r = await c.applyBack(plan, {});
    a.ok(r.ok, r.error);
    a.ok(r.warnings.some((w) => /confirm/.test(w)));
    a.eq((await c.backups('11', 'assignment', '5')).length, 1);
  });

  test('backups stack, newest first, and each Undo takes one off', async () => {
    const store = memStore();
    const c = copier(fakeCanvas(), store);
    const plan = { origCourse: '11', type: 'assignment', origId: '5' };
    for (let i = 0; i < 7; i++) await c.pushBackup(plan, { title: 't' + i, html: 'h' + i, at: Date.now(), from: '22' });
    const list = await c.backups('11', 'assignment', '5');
    a.eq(list.length, 5);
    a.eq(list[0].html, 'h6');
  });
});

suite('copy to sections: PR review (Codex)', (test) => {
  function linkedPair(api) {
    api.db.mappings['22'] = { assignments: { '5': '705' } };
    api.db.migrations['22'] = [{ id: '1', migration_type: 'course_copy_importer', workflow_state: 'completed', settings: { source_course_id: '11' } }];
    api.db.items['11:assignment:5'] = { id: '5', name: 'Lab', description: S().noteHtml('P2 note') + '<p>v1</p>' };
    api.db.items['22:assignment:705'] = { id: '705', name: 'Lab', description: '<p>v1 edited</p>' };
  }

  test('a module already in a section starts from that section’s own unlock date', async () => {
    const api = fakeCanvas();
    api.db.migrations['22'] = [{ id: '1', migration_type: 'course_copy_importer', workflow_state: 'completed', settings: { source_course_id: '11' } }];
    api.db.mappings['22'] = { modules: { '3': '303' } };
    api.db.items['22:module:303'] = { id: '303', name: 'Unit 1', unlock_at: '2026-03-09T13:00:00Z' };
    const out = await copier(api).survey('11', [{ type: 'module', id: '3', title: 'Unit 1', children: [], dates: { unlock_at: '2026-03-02T13:00:00Z' } }], ['22'], {});
    a.eq(out.dests[0].items['module:3'].destDates.unlock_at, '2026-03-09T13:00:00Z');
  });

  test('a change to only the original’s section note after the review opened stops the write', async () => {
    const api = fakeCanvas();
    linkedPair(api);
    const c = copier(api);
    const plan = await c.planBack('11', { type: 'assignment', id: '5' }, '22', '705');
    api.db.items['11:assignment:5'].description = S().noteHtml('P2 note, updated meanwhile') + '<p>v1</p>';
    const r = await c.applyBack(plan, {});
    a.not(r.ok);
    a.ok(S().splitNote(api.db.items['11:assignment:5'].description).note.indexOf('updated meanwhile') >= 0, 'the newer note survives');
  });

  test('Undo leaves a title it did not change alone, and refuses over a later title edit', async () => {
    const api = fakeCanvas();
    linkedPair(api);
    const store = memStore();
    const c = copier(api, store);
    let plan = await c.planBack('11', { type: 'assignment', id: '5' }, '22', '705');
    a.ok((await c.applyBack(plan, {})).ok);
    const puts = api.calls.filter((x) => x[0] === 'put').length;
    await c.undoBack(plan);
    a.eq(api.calls.filter((x) => x[0] === 'put').length, puts, 'no title write: the bring-back did not change it');
    // Again, then the teacher renames the original before undoing.
    api.db.items['22:assignment:705'].description = '<p>v1 edited again</p>';
    plan = await c.planBack('11', { type: 'assignment', id: '5' }, '22', '705');
    a.ok((await c.applyBack(plan, {})).ok);
    api.db.items['11:assignment:5'].name = 'Lab (renamed later)';
    let refused = null;
    await c.undoBack(plan).catch((e) => { refused = e; });
    a.ok(refused && /changed again/.test(refused.message));
    a.eq(api.db.items['11:assignment:5'].name, 'Lab (renamed later)');
  });
});

suite('copy to sections: from Canvas’s own editor', (test) => {
  const cuts = [{ key: '4', time: '13:45' }];
  const src = { due_at: '2026-11-03T13:55:00Z', unlock_at: null, lock_at: null };
  const F = ['due_at', 'unlock_at', 'lock_at'];

  test('the editor pages are recognised; show pages and index pages are not', () => {
    a.deep(S().editPageFromPath('/courses/1/assignments/new'), { courseId: '1', type: 'assignment', id: null });
    a.deep(S().editPageFromPath('/courses/1/assignments/9/edit'), { courseId: '1', type: 'assignment', id: '9' });
    a.deep(S().editPageFromPath('/courses/1/discussion_topics/new'), { courseId: '1', type: 'discussion', id: null });
    a.deep(S().editPageFromPath('/courses/1/quizzes/3/edit'), { courseId: '1', type: 'quiz', id: '3' });
    a.deep(S().editPageFromPath('/courses/1/pages/unit-1/edit'), { courseId: '1', type: 'page', id: null, slug: 'unit-1' });
    a.eq(S().editPageFromPath('/courses/1/assignments/9'), null);
    a.eq(S().editPageFromPath('/courses/1/assignments'), null);
  });

  test('blank is this section’s; a time alone (or a period) is this section’s day at that time', () => {
    a.deep(S().resolveInline(F, src, {}, TZ, cuts).iso, src);
    a.eq(S().resolveInline(F, src, { due_at: { time: '4' } }, TZ, cuts).iso.due_at, '2026-11-03T18:45:00.000Z');
    a.eq(S().resolveInline(F, src, { due_at: { time: '1:45 pm' } }, TZ, cuts).iso.due_at, '2026-11-03T18:45:00.000Z');
    a.eq(S().resolveInline(F, src, { due_at: { date: '2026-11-05' } }, TZ, cuts).iso.due_at, '2026-11-05T13:55:00.000Z', 'a date keeps the time of day');
    a.eq(S().resolveInline(F, src, { due_at: { date: '2026-11-05', time: '4' } }, TZ, cuts).iso.due_at, '2026-11-05T18:45:00.000Z');
    a.eq(S().resolveInline(F, {}, { due_at: { date: '2026-11-05' } }, TZ, cuts).iso.due_at, '2026-11-06T04:59:59.000Z', 'no time anywhere: end of that day');
  });

  test('what cannot be read, or cannot be placed, is said', () => {
    a.ok(/not a time/.test(S().resolveInline(F, src, { due_at: { time: '7' } }, TZ, cuts).errors[0]));
    a.ok(/no date to put that time on/.test(S().resolveInline(F, {}, { due_at: { time: '4' } }, TZ, cuts).errors[0]));
    a.ok(/after Due/.test(S().resolveInline(F, src, { unlock_at: { date: '2026-11-09' } }, TZ, cuts).errors[0]));
  });
});

suite('copy to sections: the editor’s Save', (test) => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  let loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    loadRunner();
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'sections', 'inline-copy.js'), 'utf8'), { filename: 'inline-copy.js' });
  }
  function inline(item) {
    load();
    const api = { sectionItem: async () => item, pageBySlug: async () => item };
    const ctl = { copier: {}, currentItem: async () => ({ type: 'assignment', id: String(item.id) }), courseName: (d) => d };
    return new globalThis.CGP.InlineSectionCopy({ api, courseId: '11', settings: { values: {} }, controller: ctl });
  }
  const here = { courseId: '11', type: 'assignment', id: '9' };
  const t = Date.parse('2026-11-01T12:00:00Z');

  test('an edit counts only if the item changed after the editor opened: Cancel copies nothing', async () => {
    const saved = await inline({ id: 9, updated_at: new Date(t + 60000).toISOString() }).matchSaved({ id: '9', armedAt: t }, here);
    a.ok(saved);
    const cancelled = await inline({ id: 9, updated_at: new Date(t - 3600000).toISOString() }).matchSaved({ id: '9', armedAt: t }, here);
    a.eq(cancelled, null);
    a.eq(await inline({ id: 8, updated_at: new Date(t + 60000).toISOString() }).matchSaved({ id: '9', armedAt: t }, { courseId: '11', type: 'assignment', id: '8' }), null, 'another item');
  });

  test('a new item counts only if created since, with the same title', async () => {
    const ok = await inline({ id: 12, name: 'Lab 5', created_at: new Date(t + 30000).toISOString() }).matchSaved({ isNew: true, armedAt: t, title: 'Lab 5' }, { courseId: '11', type: 'assignment', id: '12' });
    a.ok(ok);
    a.eq(await inline({ id: 12, name: 'Other', created_at: new Date(t + 30000).toISOString() }).matchSaved({ isNew: true, armedAt: t, title: 'Lab 5' }, { courseId: '11', type: 'assignment', id: '12' }), null);
    a.eq(await inline({ id: 3, name: 'Lab 5', created_at: new Date(t - 86400000).toISOString() }).matchSaved({ isNew: true, armedAt: t, title: 'Lab 5' }, { courseId: '11', type: 'assignment', id: '3' }), null, 'an older item with that title');
  });

  test('without an updated time (discussions), the Save must have been seen', async () => {
    const d = { courseId: '11', type: 'discussion', id: '9' };
    a.eq(await inline({ id: 9 }).matchSaved({ id: '9', armedAt: t, type: 'discussion' }, d), null);
    a.ok(await inline({ id: 9 }).matchSaved({ id: '9', armedAt: t, savedAt: t + 1000, type: 'discussion' }, d));
  });

  test('Save buttons are told apart from Cancel', () => {
    load();
    ['Save', 'Save & Publish', 'save and publish', ' Save ', 'Add Module', 'Update Module'].forEach((x) => a.ok(globalThis.CGP.inlineCopy.SAVE_TEXT.test(x), x));
    ['Cancel', 'Delete', 'Saved'].forEach((x) => a.not(globalThis.CGP.inlineCopy.SAVE_TEXT.test(x), x));
  });
});
