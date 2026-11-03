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
    a.ok(/^Missing and late work — Avery Chen\nChemistry · as of /.test(t), t);
    a.ok(t.indexOf('Missing (1)') < t.indexOf('Late (1)'), 'missing first');
    a.ok(/• Lab <2> — due .+ — not turned in · 18 days overdue — worth 20 pts/.test(t), t);
    a.ok(/• A1 — due .+ — turned in .+ · 1 d 2 h late — 7 \/ 10 pts/.test(t), t);
    a.ok(t.includes('  https://x.test/courses/5/assignments/2'), 'links under each line');
    a.ok(t.includes('Points not yet earned on missing work: 20'));
    a.ok(rep.html.includes('<a href="https://x.test/courses/5/assignments/2">Lab &lt;2&gt;</a>'), 'names linked and escaped');
    a.not(rep.html.includes('<2>'), 'no raw markup from assignment names');
  });

  test('just one kind, and no links', () => {
    const rep = si().workReport(record(), { include: { missing: false, late: true }, links: false, now: NOW });
    a.eq(rep.count, 1);
    a.ok(/^Late work\n/.test(rep.text));
    a.not(rep.text.includes('Missing'));
    a.not(rep.text.includes('http'));
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
