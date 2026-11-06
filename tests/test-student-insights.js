'use strict';

const { suite, assert: a } = require('./harness');

function si() { return globalThis.CGP.studentInsights; }

const NOW = Date.parse('2026-10-20T12:00:00Z');
const H = 3600 * 1000, D = 24 * H;

function asg(id, extra) {
  return Object.assign({ id: String(id), name: 'A' + id, pointsPossible: 10, dueAt: new Date(NOW - (20 - id) * D).toISOString(),
    groupId: '1', published: true, submissionTypes: ['online_upload'] }, extra || {});
}
function sub(id, extra) {
  return Object.assign({ assignment_id: String(id), user_id: '7', score: null, workflow_state: 'unsubmitted' }, extra || {});
}

suite('student overview: work record', (test) => {
  test('classifies on time, late, missing, excused and upcoming from Canvas flags', () => {
    const assignments = [asg(1), asg(2), asg(3), asg(4), asg(5, { dueAt: new Date(NOW + 2 * D).toISOString() })];
    const due2 = Date.parse(assignments[1].dueAt);
    const r = si().summarize({
      now: NOW, studentId: '7', assignments,
      submissions: [
        sub(1, { submitted_at: new Date(Date.parse(assignments[0].dueAt) - 3 * H).toISOString(), score: 9, workflow_state: 'graded' }),
        sub(2, { submitted_at: new Date(due2 + 30 * H).toISOString(), late: true, seconds_late: 30 * 3600, score: 6, workflow_state: 'graded' }),
        sub(3, { missing: true }),
        sub(4, { excused: true }),
        sub(5)
      ]
    });
    a.deep([r.counts.onTime, r.counts.late, r.counts.missing, r.counts.excused, r.counts.upcoming], [1, 1, 1, 1, 1]);
    a.eq(r.rates.late, 0.5);
    a.eq(r.missingPoints, 10);
    a.eq(r.lateness.median, 30 * 3600);
    a.eq(r.lateness.buckets.find((b) => b.key === 'days3').count, 1, '30 hours late is in 1-3 days');
    a.eq(r.overall.percent, 75, '(9 + 6) / 20; missing without a grade is not counted');
    a.eq(r.lists.upcoming.length, 1);
  });

  test('a teacher-applied status wins over Canvas’s automatic flag', () => {
    const r = si().summarize({
      now: NOW, studentId: '7', assignments: [asg(1), asg(2)],
      submissions: [sub(1, { missing: true, late_policy_status: 'none' }), sub(2, { late_policy_status: 'missing', submitted_at: new Date(NOW - D).toISOString(), late: true })]
    });
    a.eq(r.items.find((i) => i.id === '1').status, 'notSubmitted');
    a.eq(r.items.find((i) => i.id === '2').status, 'missing');
  });

  test('unpublished assignments and unknown ones are left out', () => {
    const r = si().summarize({ now: NOW, studentId: '7', assignments: [asg(1, { published: false })], submissions: [sub(1, { missing: true }), sub(99, { missing: true })] });
    a.eq(r.items.length, 0);
    a.eq(r.counts.missing, 0);
  });

  test('needs grading: submitted with no grade, or regraded after a resubmission', () => {
    const r = si().summarize({
      now: NOW, studentId: '7', assignments: [asg(1), asg(2), asg(3)],
      submissions: [
        sub(1, { submitted_at: new Date(NOW - 30 * D).toISOString(), workflow_state: 'submitted' }),
        sub(2, { submitted_at: new Date(NOW - 30 * D).toISOString(), score: 5, workflow_state: 'graded', grade_matches_current_submission: false, attempt: 2 }),
        sub(3, { submitted_at: new Date(NOW - 30 * D).toISOString(), score: 5, workflow_state: 'graded' })
      ]
    });
    a.deep(r.lists.needsGrading.map((i) => i.id).sort(), ['1', '2']);
    a.deep(r.lists.resubmitted.map((i) => i.id), ['2']);
  });

  test('group averages, weighted estimate and class comparison', () => {
    const r = si().summarize({
      now: NOW, studentId: '7', weighted: true,
      assignments: [asg(1, { groupId: '1' }), asg(2, { groupId: '2' })],
      groups: [{ id: 1, name: 'Tests', group_weight: 60 }, { id: 2, name: 'HW', group_weight: 40 }],
      classMedians: { 1: 70, 2: 90 },
      submissions: [sub(1, { score: 8, workflow_state: 'graded' }), sub(2, { score: 10, workflow_state: 'graded' })]
    });
    a.eq(r.groups.length, 2);
    a.eq(r.groups[0].average, 80);
    a.eq(Math.round(r.weightedEstimate), 88, '80*.6 + 100*.4');
    a.eq(r.relative.above, 2);
    a.eq(r.relative.avgDiff, 10);
  });

  test('trend compares the latest graded work with what came before', () => {
    const assignments = [1, 2, 3, 4, 5, 6].map((i) => asg(i));
    const scores = [10, 10, 9, 6, 5, 5];
    const r = si().summarize({ now: NOW, studentId: '7', assignments,
      submissions: scores.map((s, i) => sub(i + 1, { score: s, workflow_state: 'graded' })) });
    a.eq(r.trend.recentCount, 3);
    a.eq(Math.round(r.trend.delta), Math.round((5 + 5 + 6) / 3 * 10 - (10 + 10 + 9) / 3 * 10));
    a.ok(r.insights.some((i) => /trending down/.test(i.text)));
  });

  test('streak of missing work is flagged', () => {
    const r = si().summarize({ now: NOW, studentId: '7', assignments: [asg(1), asg(2), asg(3)],
      submissions: [sub(1, { submitted_at: new Date(NOW - 30 * D).toISOString(), score: 9 }), sub(2, { missing: true }), sub(3, { missing: true })] });
    a.deep(r.streak, { status: 'missing', count: 2 });
    a.ok(r.insights.some((i) => i.level === 'risk' && /in a row/.test(i.text)));
  });

  test('a student comment after the last teacher comment is unanswered', () => {
    const r = si().summarize({ now: NOW, studentId: '7', instructorId: '1', assignments: [asg(1)],
      submissions: [sub(1, { submission_comments: [
        { author_id: '1', created_at: '2026-10-01T00:00:00Z' },
        { author_id: '7', created_at: '2026-10-02T00:00:00Z' }] })] });
    a.eq(r.feedback.fromYou, 1);
    a.eq(r.feedback.fromStudent, 1);
    a.eq(r.feedback.unanswered.length, 1);
  });
});

suite('student overview: activity', (test) => {
  test('folds hourly page views into days, weekdays and hours', () => {
    const t1 = new Date(NOW - 2 * D); t1.setMinutes(0, 0, 0);
    const t2 = new Date(NOW - 40 * D); t2.setMinutes(0, 0, 0);
    const act = si().activity({ page_views: { [t1.toISOString()]: 5, [t2.toISOString()]: 3 }, participations: [{ created_at: t1.toISOString() }] }, NOW, 10);
    a.eq(act.total, 8);
    a.eq(act.last7, 5);
    a.eq(act.last30, 5);
    a.eq(act.prior30, 3);
    a.eq(act.days.length, 70);
    a.eq(act.byHour[t1.getHours()] >= 5, true);
    a.eq(act.activeDays30, 1);
    a.eq(act.participations, 1);
    a.eq(new Date(act.days[0].date).getDay(), 0, 'weeks start on Sunday');
  });

  test('places the student among the class, ties counted half', () => {
    a.eq(si().percentile(5, [1, 5, 9]), 50);
    a.eq(si().percentile(1, [1, 5, 9, 10]), 13);
    a.eq(si().percentile(null, [1, 2]), null);
  });

  test('inactivity and low page views raise flags', () => {
    const r = si().summarize({ now: NOW, studentId: '7', assignments: [], submissions: [],
      student: { lastActivityAt: new Date(NOW - 9 * D).toISOString() },
      summaries: [{ id: '7', page_views: 3 }, { id: '8', page_views: 50 }, { id: '9', page_views: 80 }, { id: '10', page_views: 60 }, { id: '11', page_views: 40 }, { id: '12', page_views: 70 }] });
    a.eq(r.engagement.daysSinceActivity, 9);
    a.ok(r.insights[0].level === 'risk' && /9 days/.test(r.insights[0].text));
    a.ok(r.insights.some((i) => /Fewer page views/.test(i.text)));
  });
});

suite('student overview: formatting', (test) => {
  test('durations keep the two largest units', () => {
    a.eq(si().duration(45), '45 s');
    a.eq(si().duration(600), '10 min');
    a.eq(si().duration(5400), '1 h 30 min');
    a.eq(si().duration(30 * 3600), '1 d 6 h');
    a.eq(si().duration(10 * 86400), '10 d');
  });

  test('class medians ignore excused and blank cells and need two scores', () => {
    const cells = { '1:a': { score: 5 }, '1:b': { score: 10 }, '1:c': { excused: true, score: 0 }, '2:a': { score: 3 } };
    const m = si().classMedians((aid, uid) => cells[aid + ':' + uid] || null, [{ id: '1', pointsPossible: 10 }, { id: '2', pointsPossible: 10 }], ['a', 'b', 'c']);
    a.eq(m['1'], 75);
    a.eq(m['2'], undefined);
  });
});

suite('student overview: opening from a name click', (test) => {
  require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'src/gradebook/student-insights.js'), 'utf8'));
  const C = globalThis.CGP.StudentInsightsController;

  // Just enough of an element for closest()/getAttribute().
  function el(tag, cls, attrs, parent) {
    return {
      tagName: tag, parent, attrs: attrs || {}, classes: cls ? cls.split(' ') : [],
      classList: { contains(c) { return this.el.classes.indexOf(c) >= 0; } },
      getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
      closest(sel) {
        for (let n = this; n; n = n.parent) {
          if (sel === 'a' && n.tagName === 'A') return n;
          if (sel.startsWith('.') && n.classes.indexOf(sel.slice(1)) >= 0) return n;
        }
        return null;
      }
    };
  }
  function nameLink(href, extra) {
    const canvas = el('DIV', 'grid-canvas');
    const row = el('DIV', 'slick-row', {}, canvas);
    const cell = el('DIV', 'slick-cell', {}, row);
    const a = el('A', 'student-grades-link', Object.assign({ href }, extra || {}), cell);
    a.classList.el = a;
    const span = el('SPAN', '', {}, a);
    return { row, a, span };
  }
  function ctl(on, testRow) {
    return new C({ model: {}, api: {}, courseId: '5', settings: { values: { studentInsights: on } },
      adapter: { studentIdFromRow: () => '42', isTestStudentRow: () => !!testRow } });
  }
  const click = (target, extra) => Object.assign({ target, button: 0, defaultPrevented: false }, extra || {});

  test('a plain click on a student name resolves the student', () => {
    const { span } = nameLink('/courses/5/grades/42');
    a.eq(ctl(true).studentForClick(click(span)), '42');
  });

  test('Canvas’s own data-student_id wins when present', () => {
    const { a: link } = nameLink('/courses/5/grades/42', { 'data-student_id': '77' });
    a.eq(ctl(true).studentForClick(click(link)), '77');
  });

  test('modifier clicks, the setting off, and the Test Student are left to Canvas', () => {
    const { span } = nameLink('/courses/5/grades/42');
    a.eq(ctl(true).studentForClick(click(span, { metaKey: true })), null);
    a.eq(ctl(true).studentForClick(click(span, { ctrlKey: true })), null);
    a.eq(ctl(true).studentForClick(click(span, { button: 1 })), null);
    a.eq(ctl(false).studentForClick(click(span)), null);
    a.eq(ctl(true, true).studentForClick(click(span)), null);
  });

  test('links that are not a student name are ignored', () => {
    const { span } = nameLink('/courses/5/assignments/9');
    a.eq(ctl(true).studentForClick(click(span)), null);
  });
});

suite('student overview: missing and late list to send', (test) => {
  function record() {
    const assignments = [asg(1), asg(2, { name: 'Lab <2>', pointsPossible: 20 }), asg(3)];
    const due1 = Date.parse(assignments[0].dueAt);
    return si().summarize({ now: NOW, studentId: '7', assignments, submissions: [
      sub(1, { submitted_at: new Date(due1 + 26 * H).toISOString(), late: true, seconds_late: 26 * 3600, score: 7, workflow_state: 'graded' }),
      sub(2, { missing: true }),
      sub(3, { submitted_at: new Date(NOW - 30 * D).toISOString(), score: 9 })
    ] });
  }

  test('lists missing then late work with due dates, overdue days, lateness and points', () => {
    const rep = si().workReport(record(), { studentName: 'Avery Chen', courseName: 'Chemistry', now: NOW,
      links: true, urlFor: (i) => 'https://x.test/courses/5/assignments/' + i.id });
    a.eq(rep.count, 2);
    const t = rep.text;
    a.ok(/^Chemistry · \w+day, \w+ \d+, \d{4}\n\nMissing \(1\)/.test(t), t);
    a.not(/work —|Missing and late work/.test(t), 'no title line');
    a.ok(rep.html.startsWith('<p><b>Chemistry</b><br><b>'), rep.html);
    a.ok(t.indexOf('Missing (1)') < t.indexOf('Late (1)'), 'missing first');
    a.ok(/• Lab <2> — due .+ — not turned in · 18 days overdue — worth 20 pts/.test(t), t);
    a.ok(/• A1 — due .+ — turned in .+ · 1 d 2 h late — 7 \/ 10 pts/.test(t), t);
    a.ok(t.includes('  https://x.test/courses/5/assignments/2'), 'links under each line');
    a.not(t.includes('Points not yet earned'));
    a.ok(rep.html.includes('<a href="https://x.test/courses/5/assignments/2">Lab &lt;2&gt;</a>'), 'names linked and escaped');
    a.not(rep.html.includes('<2>'), 'no raw markup from assignment names');
  });

  test('just one kind, and no links', () => {
    const rep = si().workReport(record(), { include: { missing: false, late: true }, links: false, now: NOW });
    a.eq(rep.count, 1);
    a.ok(/^\w+day, \w+ \d+, \d{4}\n\nLate \(1\)/.test(rep.text), rep.text);
    a.not(rep.text.includes('Missing'));
    a.not(rep.text.includes('http'));
  });

  test('no student name unless asked, and excluded assignments are left off', () => {
    const rep = si().workReport(record(), { courseName: 'Chemistry', now: NOW, exclude: { 2: true } });
    a.ok(/^Chemistry · /.test(rep.text), rep.text);
    a.eq(rep.count, 1);
    a.not(rep.text.includes('Lab <2>'));
    a.not(rep.text.includes('Points not yet earned'));
  });

  test('last active says the time, and the date when it was not today or yesterday', () => {
    const t = new Date(2026, 10, 3, 19, 50).getTime();
    a.eq(si().lastActiveText(t, new Date(2026, 10, 3, 21, 0).getTime()), 'today at 7:50 PM');
    a.eq(si().lastActiveText(t, new Date(2026, 10, 4, 8, 0).getTime()), 'yesterday at 7:50 PM');
    a.eq(si().lastActiveText(t, new Date(2026, 10, 9, 8, 0).getTime()), 'on Tue, Nov 3 at 7:50 PM');
    a.eq(si().lastActiveText(null, NOW), '–');
  });

  test('nothing to report still says so', () => {
    const r = si().summarize({ now: NOW, studentId: '7', assignments: [asg(1)], submissions: [sub(1, { submitted_at: new Date(NOW - 30 * D).toISOString() })] });
    const rep = si().workReport(r, { now: NOW });
    a.eq(rep.count, 0);
    a.ok(rep.text.includes('Nothing missing and late right now.'));
  });
});

suite('student overview: search by name or date', (test) => {
  const t = new Date(2026, 9, 12, 23, 59).getTime(); // Mon Oct 12 2026
  const hay = ['Lab 3: Gas Laws', si().dateSearchText(t)].join(' | ');
  test('finds dates however they are typed', () => {
    ['10/12', '10/12/2026', '10/12/26', '2026-10-12', 'oct 12', 'October 12', 'monday'].forEach((q) => {
      a.ok(si().matchesSearch(hay, q), q);
    });
  });
  test('names match word by word, in any order', () => {
    a.ok(si().matchesSearch(hay, 'gas lab'));
    a.ok(si().matchesSearch(hay, ''));
    a.not(si().matchesSearch(hay, 'quiz'));
    a.not(si().matchesSearch(hay, '11/12'));
  });
});

suite('student overview: where "see the work" goes', (test) => {
  const C = globalThis.CGP.StudentInsightsController;
  const ctl = new C({ model: {}, api: {}, adapter: {}, courseId: '5', settings: { values: {} } });
  ctl._uid = '7';
  function item(types, subExtra, aExtra) {
    const r = si().summarize({ now: NOW, studentId: '7',
      assignments: [asg(1, Object.assign({ submissionTypes: types }, aExtra || {}))],
      submissions: [sub(1, Object.assign({ score: 8, workflow_state: 'graded' }, subExtra || {}))] });
    return r.items[0];
  }
  const done = { submitted_at: new Date(NOW - 20 * D).toISOString() };

  test('on paper and no-submission assignments have nothing to open', () => {
    a.eq(item(['on_paper']).kind, 'paper');
    a.eq(ctl.workLink(item(['on_paper'])), null);
    a.eq(ctl.workLink(item(['none'])), null);
    a.eq(ctl.workLink(item(['not_graded'])), null);
  });

  test('work handed in to Canvas opens in SpeedGrader', () => {
    const l = ctl.workLink(item(['online_upload', 'online_text_entry'], done));
    a.eq(l.label, 'View work');
    a.eq(l.href, '/courses/5/gradebook/speed_grader?assignment_id=1&student_id=7');
  });

  test('an external tool submission opens the student’s own work in the tool', () => {
    const i = item(['external_tool'], Object.assign({ submission_type: 'basic_lti_launch', url: 'https://api.turnitin.com/lti/sub?id=99&x=1' }, done),
      { toolUrl: 'https://api.turnitin.com/lti/launch' });
    a.eq(i.kind, 'tool');
    const l = ctl.workLink(i);
    a.eq(l.label, 'Open in Turnitin');
    a.eq(l.href, '/courses/5/external_tools/retrieve?display=borderless&assignment_id=1&url=' +
      encodeURIComponent('https://api.turnitin.com/lti/sub?id=99&x=1'));
    a.ok(l.primary);
  });

  test('without a per-student launch, the tool opens on the assignment', () => {
    const l = ctl.workLink(item(['external_tool'], {}, { toolUrl: 'https://edpuzzle.com/lti/launch' }));
    a.eq(l.label, 'Open in Edpuzzle');
    a.eq(l.href, '/courses/5/assignments/1');
    a.not(l.primary, 'not handed in yet, so a quiet link');
  });

  test('tool names: known tools by name, others by host', () => {
    a.eq(si().toolName('https://assignments.google.com/lti/a'), 'Google Assignments');
    a.eq(si().toolName('https://lti.deltamath.com/launch'), 'DeltaMath');
    a.eq(si().toolName('https://www.example-tool.org/lti'), 'Example-tool');
    a.eq(si().toolName(null), null);
  });
});

suite('student overview: PR review fixes', (test) => {
  test('category class median is the median of classmates’ category averages', () => {
    // Everyone earns 10/10 and 0/100: every category average is 9.1%, not 50%.
    const assignments = [asg(1, { pointsPossible: 10 }), asg(2, { pointsPossible: 100 })];
    const cells = {};
    ['a', 'b', 'c'].forEach((u) => { cells['1:' + u] = { score: 10 }; cells['2:' + u] = { score: 0 }; });
    const gm = si().classGroupMedians((aid, uid) => cells[aid + ':' + uid] || null, assignments, ['a', 'b', 'c']);
    a.eq(Math.round(gm['1'] * 10) / 10, 9.1);
    const r = si().summarize({ now: NOW, studentId: '7', assignments, groups: [{ id: 1, name: 'All' }], classGroupMedians: gm,
      submissions: [sub(1, { score: 10, workflow_state: 'graded' }), sub(2, { score: 0, workflow_state: 'graded' })] });
    a.eq(Math.round(r.groups[0].average * 10) / 10, 9.1);
    a.eq(r.groups[0].classMedian, gm['1'], 'the student matches the class exactly');
  });

  test('category class median skips excused and ungraded work per student', () => {
    const assignments = [asg(1), asg(2)];
    const cells = { '1:a': { score: 5 }, '2:a': { excused: true, score: 0 }, '1:b': { score: 10 }, '2:b': { score: null } };
    const gm = si().classGroupMedians((aid, uid) => cells[aid + ':' + uid] || null, assignments, ['a', 'b']);
    a.eq(gm['1'], 75);
  });

  test('zero-point extra credit adds earned points to the averages', () => {
    const assignments = [asg(1, { pointsPossible: 10 }), asg(2, { pointsPossible: 0 })];
    const r = si().summarize({ now: NOW, studentId: '7', weighted: true, assignments,
      groups: [{ id: 1, name: 'All', group_weight: 100 }],
      submissions: [sub(1, { score: 8, workflow_state: 'graded' }), sub(2, { score: 2, workflow_state: 'graded' })] });
    a.eq(r.overall.percent, 100);
    a.eq(r.groups[0].average, 100);
    a.eq(r.weightedEstimate, 100);
  });

  test('a category holding only extra credit has no average (nothing possible)', () => {
    const r = si().summarize({ now: NOW, studentId: '7', assignments: [asg(1, { pointsPossible: 0 })],
      groups: [{ id: 1, name: 'Bonus' }], submissions: [sub(1, { score: 2, workflow_state: 'graded' })] });
    a.eq(r.groups[0].average, null);
    a.eq(r.overall, null);
  });
});

suite('student overview: course content opened', (test) => {
  const access = (code, extra) => ({ asset_user_access: Object.assign({ asset_code: code, view_score: 1, participate_score: 0,
    created_at: new Date(NOW - 10 * D).toISOString(), last_access: new Date(NOW - 1 * D).toISOString() }, extra || {}) });

  test('lists each item with views, first and last opened, and course areas by name', () => {
    const c = si().contentActivity({ courseId: '5', now: NOW, pageViews: null, assignments: [], accesses: [
      access('wiki_page_12', { readable_name: 'Unit 3 Notes', view_score: 4 }),
      access('attachment_34', { display_name: 'lab.pdf', view_score: 2, last_access: new Date(NOW - 3 * D).toISOString() }),
      access('grades:course_5', { readable_name: 'Course Grades', view_score: 9 })
    ] });
    a.eq(c.items.length, 3);
    const page = c.items.find((i) => i.type === 'wiki_page');
    a.eq(page.name, 'Unit 3 Notes');
    a.eq(page.views, 4);
    a.eq(page.kind, 'page');
    a.eq(c.items.find((i) => i.kind === 'area').name, 'Grades');
    a.eq(c.items[c.items.length - 1].type, 'attachment', 'most recently opened first');
    a.eq(c.totalSeconds, null, 'no page views, no time');
  });

  test('page views add time per item and tell downloads from previews; other courses are ignored', () => {
    const pv = (url, secs, extra) => Object.assign({ url, interaction_seconds: secs, created_at: new Date(NOW - D).toISOString(),
      context_type: 'Course', links: { context: '5' } }, extra || {});
    const c = si().contentActivity({ courseId: '5', now: NOW, assignments: [], accesses: [
      access('wiki_page_12', { readable_name: 'Unit 3 Notes' }),
      access('attachment_34', { display_name: 'lab.pdf' })
    ], pageViews: [
      pv('https://x.test/courses/5/pages/unit-3-notes', 120),
      pv('https://x.test/courses/5/pages/unit-3-notes', 60),
      pv('https://x.test/courses/5/files/34', 30),
      pv('https://x.test/courses/5/files/34/download?download_frd=1', 0),
      pv('https://x.test/courses/9/pages/unit-3-notes', 500, { links: { context: '9' } })
    ] });
    const page = c.items.find((i) => i.type === 'wiki_page');
    a.eq(page.seconds, 180);
    a.eq(page.recentViews, 2);
    const file = c.items.find((i) => i.type === 'attachment');
    a.eq(file.downloads, 1);
    a.eq(file.previews, 1);
    a.eq(c.totalSeconds, 210);
  });

  test('assignments whose instructions, quiz or discussion were never opened, past due first', () => {
    const c = si().contentActivity({ courseId: '5', now: NOW, pageViews: null, accesses: [
      access('assignment_1'), access('quizzes:quiz_77'), access('discussion_topic_88')
    ], assignments: [
      asg(1), asg(2, { quizId: '77' }), asg(3, { discussionTopicId: '88' }),
      asg(4, { dueAt: new Date(NOW + 3 * D).toISOString() }), asg(5, { dueAt: new Date(NOW - 5 * D).toISOString() }),
      asg(6, { published: false })
    ] });
    a.deep(c.notOpened.map((n) => n.id), ['5', '4']);
    a.eq(c.notOpenedPastDue, 1);
  });

  test('no Access Report, nothing to show', () => {
    a.eq(si().contentActivity({ courseId: '5', accesses: null }), null);
  });
});

suite('student overview: never-opened review fixes', (test) => {
  const access = (code) => ({ asset_user_access: { asset_code: code, view_score: 1 } });
  test('uses the student’s own due date (an extension), not the course-wide one', () => {
    const c = si().contentActivity({ courseId: '5', now: NOW, pageViews: null, accesses: [],
      assignments: [asg(1, { dueAt: new Date(NOW - 2 * D).toISOString() })], dueFor: { 1: NOW + 3 * D } });
    a.eq(c.notOpened[0].dueAt, NOW + 3 * D);
    a.eq(c.notOpenedPastDue, 0);
  });
  test('a cut-short Access Report claims nothing was never opened', () => {
    const accesses = [access('assignment_9')];
    accesses.truncated = true;
    const c = si().contentActivity({ courseId: '5', now: NOW, pageViews: null, accesses, assignments: [asg(1)] });
    a.eq(c.notOpened.length, 0);
    a.not(c.notOpenedKnown);
  });
  test('course index: each item’s modules, and Studio videos embedded anywhere in the course', () => {
    const studio = (id) => '<iframe title="Vid ' + id + '" src="/courses/9/external_tools/retrieve?url=https%3A%2F%2Fs.instructuremedia.com%2Flti%2Flaunch%3Fcustom_arc_media_id%3D' + id + '"></iframe>';
    const idx = globalThis.CGP.studentInsights.courseIndex({
      courseId: '9',
      assignments: [
        { id: 1, name: 'HW - Isotopes', description: '<p>Watch</p>' + studio('aaaaaa-1') },
        { id: 2, name: 'Quiz 1', quiz_id: 50, description: '' },
        { id: 3, name: 'No video', description: '<p>Read pp. 8-9</p>' }
      ],
      quizzes: [{ id: 50, title: 'Quiz 1', description: studio('bbbbbb-2') }],
      discussions: [{ id: 70, title: 'Talk', message: studio('cccccc-3') }],
      pages: [{ page_id: 80, url: 'notes', title: 'Notes', body: studio('aaaaaa-1') }],
      modules: [
        { name: 'Unit 2: Atoms', items: [
          { type: 'Assignment', content_id: 1 }, { type: 'Quiz', content_id: 50 }, { type: 'Page', page_url: 'notes' },
          { type: 'ExternalTool', title: 'Bonding video', external_url: 'https://s.instructuremedia.com/lti/launch?custom_arc_media_id=dddddd-4' }
        ] }
      ]
    });
    a.deep(idx.modules.assignment_1, ['Unit 2: Atoms']);
    a.deep(idx.modules.assignment_2, ['Unit 2: Atoms'], 'a quiz’s assignment takes the quiz’s module');
    a.deep(idx.modules.wiki_page_80, ['Unit 2: Atoms']);
    a.eq(idx.modules.assignment_3, undefined);
    const ids = idx.embeds.map((e) => e.uuid);
    a.deep(ids, ['aaaaaa-1', 'bbbbbb-2', 'cccccc-3', 'aaaaaa-1', 'dddddd-4'], 'a quiz’s own description is read even when its assignment’s is empty');
    a.eq(idx.embeds[1].place.url, '/courses/9/assignments/2', 'the quiz is linked through its assignment');
    a.deep(idx.embeds[0].place, { kind: 'Assignment', name: 'HW - Isotopes', url: '/courses/9/assignments/1', modules: ['Unit 2: Atoms'] });
    a.eq(idx.embeds[3].place.kind, 'Page');
    a.eq(idx.embeds[4].place.kind, 'Module');
  });
  test('pages list without bodies: each page is read on its own, an unreadable one left as it was', async () => {
    const vm = require('vm');
    if (!globalThis.CGP.StudentInsightsController) vm.runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '../src/gradebook/student-insights.js'), 'utf8'));
    const reads = [];
    const api = { sectionItem: (cid, type, id) => { reads.push(id); return id === 2 ? Promise.reject(new Error('403')) : Promise.resolve({ page_id: id, url: 'p' + id, body: '<p>' + id + '</p>' }); } };
    const c = new globalThis.CGP.StudentInsightsController({ model: {}, api, adapter: {}, settings: { values: {} }, courseId: 9 });
    const full = await c.pageBodies([{ page_id: 1, url: 'p1' }, { page_id: 2, url: 'p2' }]);
    a.deep(reads.sort(), [1, 2]);
    a.eq(full[0].body, '<p>1</p>');
    a.deep(full[1], { page_id: 2, url: 'p2' });
    reads.length = 0;
    await c.pageBodies([{ page_id: 3, url: 'p3', body: '' }]);
    a.eq(reads.length, 0, 'bodies already there: nothing more read');
  });
});

suite('student overview: profile tab', (test) => {
  const C = () => {
    if (!globalThis.CGP.StudentInsightsController) require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, '../src/gradebook/student-insights.js'), 'utf8'));
    return globalThis.CGP.StudentInsightsController;
  };

  test('parents and guardians: the observers paired with this student, each once', () => {
    const observers = [
      { id: 1, name: 'Pat Billings', sortable_name: 'Billings, Pat', email: 'pat@home.net', observed_users: [{ id: 7 }] },
      { id: 2, name: 'Sam Billings', sortable_name: 'Billings, Sam', enrollments: [{ associated_user_id: 7 }, { associated_user_id: 7 }] },
      { id: 3, name: 'Other Parent', sortable_name: 'Parent, Other', email: 'o@x.org', observed_users: [{ id: 8 }] },
      { id: 1, name: 'Pat Billings', sortable_name: 'Billings, Pat', observed_users: [{ id: 7 }] }
    ];
    const g = si().guardiansFor(observers, '7');
    a.deep(g.map((x) => x.name), ['Pat Billings', 'Sam Billings']);
    a.eq(g[0].email, 'pat@home.net');
    a.eq(g[1].email, '');
    a.eq(g[0].lastLogin, undefined, 'Canvas didn’t say');
    a.eq(si().guardiansFor([{ id: 1, name: 'P', last_login: null, observed_users: [{ id: 7 }] }], 7)[0].lastLogin, null, 'never logged in');
    a.deep(si().guardiansFor(null, 7), []);
  });

  test('grade level from a class year in the school email or login', () => {
    const nov2026 = Date.parse('2026-11-06T12:00:00Z');
    a.deep(si().classYear([{ text: 'abillings30@malvernprep.org', label: 'email' }], nov2026), { classYear: 2030, grade: 9, from: 'email' });
    a.eq(si().classYear([{ text: 'jsmith27@x.org', label: 'email' }], nov2026).grade, 12, 'Class of 2027 are seniors in 2026-27');
    a.eq(si().classYear([{ text: '2029.jdoe@x.org', label: 'email' }], nov2026).grade, 10);
    a.eq(si().classYear([{ text: 'jsmith27@x.org', label: 'email' }], Date.parse('2027-03-01T12:00:00Z')).grade, 12, 'spring is the same school year');
    a.eq(si().classYear([{ text: 'jsmith@x.org', label: 'email' }, { text: '123456', label: 'sis' }], nov2026), null, 'no year: nothing guessed');
    a.eq(si().classYear([{ text: 'room99@x.org', label: 'email' }], nov2026), null, 'a number that is not a class year');
    a.eq(si().classYear([{ text: 'jsmith@x.org', label: 'email' }, { text: 'jsmith28', label: 'login' }], nov2026).from, 'login');
  });

  test('the panel shows email, guardians, grade level and grades, and says what Canvas withheld', () => {
    const Ctl = C();
    const c = new Ctl({ model: {}, api: {}, adapter: {}, settings: { values: {} }, courseId: 376 });
    const parts = {
      enrollment: { grades: { current_score: 86.04, current_grade: 'B', final_score: 71.2, final_grade: 'C-' } },
      profile: {
        user: { id: 7, login_id: 'abillings30', sis_user_id: 'S1001', pronouns: 'he/him',
          enrollments: [{ course_id: 376, type: 'StudentEnrollment', course_section_id: 11, created_at: '2026-08-25T12:00:00Z' }] },
        observers: [{ id: 1, name: 'Pat <Billings>', sortable_name: 'Billings, Pat', email: 'pat@home.net', observed_users: [{ id: 7 }] },
          { id: 2, name: 'Sam Billings', sortable_name: 'Billings, Sam', email: 'sam@home.net', observed_users: [{ id: 7 }] }],
        sections: [{ id: 11, name: 'Block 3' }],
        emails: { 7: 'abillings30@malvernprep.org' },
        profile: null,
        enrollments: [{ course_id: 376 }, { course_id: 331, grades: { current_score: 92.5, current_grade: 'A-' } }, { course_id: 999 }],
        courses: [{ id: 376, name: 'Integrated Science I - 3' }, { id: 331, name: 'AP Biology - 1' }]
      }
    };
    const html = c.profilePanel('7', { name: 'Andrew Billings', sortableName: 'Billings, Andrew' }, parts);
    a.ok(html.includes('mailto:abillings30@malvernprep.org'), 'student email');
    a.ok(html.includes('Grade ' + si().classYear([{ text: 'abillings30@malvernprep.org', label: 'x' }], Date.now()).grade) || !si().classYear([{ text: 'abillings30@malvernprep.org', label: 'x' }], Date.now()), 'grade level');
    a.ok(html.includes('Pat &lt;Billings&gt;'), 'guardian name, escaped');
    a.ok(html.includes('mailto:pat@home.net,sam@home.net'), 'email all guardians');
    a.ok(html.includes('Block 3') && html.includes('S1001') && html.includes('he/him'), 'section, SIS id, pronouns');
    a.ok(html.includes('86%') && html.includes('C–'), 'current and final grades');
    a.ok(html.includes('AP Biology - 1') && html.includes('/courses/331/grades/7') && !html.includes('/courses/999/'), 'other classes with this teacher only');

    a.ok(html.includes('Not shared with you by Canvas'), 'student login: unknown');
    a.ok(html.includes('didn’t share when these parents last logged in'), 'parent logins: unknown');

    // Last Canvas login: the student's own record, else recent_students; parents' from their records.
    const login = '2026-11-02T13:05:00Z';
    const withLogins = JSON.parse(JSON.stringify(parts));
    withLogins.profile.user.last_login = login;
    withLogins.profile.observers[0].last_login = login;
    withLogins.profile.observers[1].last_login = null;
    const h2 = c.profilePanel('7', { name: 'Andrew Billings' }, withLogins);
    const when = si().lastActiveText(Date.parse(login), Date.now());
    a.ok(h2.includes('Last Canvas login</dt><dd>' + when), 'student login shown');
    a.ok(h2.includes('Last Canvas login: ' + when) && h2.includes('Last Canvas login: Never'), 'each parent’s login');
    a.ok(!h2.includes('didn’t share when'), 'no note when every parent is known');
    const viaRecent = JSON.parse(JSON.stringify(parts));
    viaRecent.profile.recent = [{ id: 8, last_login: '2026-01-01T00:00:00Z' }, { id: 7, last_login: login }];
    a.ok(c.profilePanel('7', { name: 'A' }, viaRecent).includes('Last Canvas login</dt><dd>' + when), 'from recent_students');

    const none = c.profilePanel('7', { name: 'A' }, { profile: { user: null, observers: null, sections: null, emails: {}, profile: null, enrollments: null, courses: null } });
    a.ok(none.includes('didn’t let you see'), 'observers refused');
    a.ok(!none.includes('Also in your classes'));
    a.ok(c.profilePanel('7', { name: 'A' }, {}).includes('Reading this student’s profile'), 'loading');
  });
});
