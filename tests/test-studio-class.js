'use strict';

const { suite, assert: a } = require('./harness');

function sc() { return globalThis.CGP.studioClass; }

// The shape Studio's /insights/users answers with (seen in the teacher's network tab).
const USERS = { insights: [
  { id: 234, display_name: 'Thomas (Tommy) Tegler', email: 'ttegler07@school.org', role_names: ['Student'], completion_rate: 1.0 },
  { id: 310, display_name: "Jameson O'Donnell", email: 'jodonnell08@school.org', role_names: ['Student'], completion_rate: 0.65625 },
  { id: 4, display_name: 'Stephen (Steve) Borish', email: 'sborish@school.org', role_names: ['Teacher'], completion_rate: 0.125 },
  { id: 466, display_name: 'Zachary (Zach) Fellman', email: 'ZFellman09@school.org', role_names: ['Student'], completion_rate: 0.4375 },
  { id: 900, display_name: 'Dropped Student', email: 'gone@school.org', role_names: ['Student'], completion_rate: 0.2 }
] };

const ROSTER = [
  { id: '1', name: 'Thomas (Tommy) Tegler', sortable_name: 'Tegler, Thomas (Tommy)', email: 'ttegler07@school.org' },
  { id: '2', name: "Jameson O'Donnell", sortable_name: "O'Donnell, Jameson", email: 'jodonnell08@school.org' },
  { id: '3', name: 'Zachary (Zach) Fellman', sortable_name: 'Fellman, Zachary (Zach)', email: 'zfellman09@school.org' },
  { id: '4', name: 'Avery Adams', sortable_name: 'Adams, Avery', email: 'aadams@school.org' },
  { id: '5', name: 'Sameer Dhillon', sortable_name: 'Dhillon, Sameer', email: '' }
];

suite('Studio class list', (test) => {
  test('reads Studio’s viewers, marking teachers', () => {
    const v = sc().viewersFrom(USERS);
    a.eq(v.length, 5);
    a.eq(v[0].completion, 1);
    a.ok(v[2].teacher);
    a.eq(v[3].email, 'zfellman09@school.org', 'emails lower-cased');
  });

  test('every roster student alphabetically by last name, with watched / partly / not watched', () => {
    const L = sc().classList(ROSTER, sc().viewersFrom(USERS));
    a.deep(L.rows.map((r) => r.name), ['Avery Adams', 'Sameer Dhillon', 'Zachary (Zach) Fellman', "Jameson O'Donnell", 'Thomas (Tommy) Tegler']);
    const by = Object.fromEntries(L.rows.map((r) => [r.name, r]));
    a.eq(by['Avery Adams'].status, 'none');
    a.eq(by['Avery Adams'].completion, null);
    a.eq(by['Zachary (Zach) Fellman'].status, 'partial');
    a.eq(by['Thomas (Tommy) Tegler'].status, 'watched');
    a.deep(L.counts, { total: 5, watched: 1, partial: 2, none: 2, unknown: 0 });
    a.deep(L.extra.map((v) => v.name), ['Dropped Student'], 'a student viewer not on the roster; the teacher left out');
    a.eq(Math.round(L.averageCompletion * 1000), Math.round(((1 + 0.65625 + 0.4375) / 5) * 1000));
  });

  test('a student with no email is matched by name, nicknames in brackets ignored', () => {
    const L = sc().classList([{ id: '9', name: 'Thomas Tegler', sortable_name: 'Tegler, Thomas', email: '' }], sc().viewersFrom(USERS));
    a.eq(L.rows[0].status, 'watched');
  });

  test('90% or more counts as watched; 0% is not watched; no share at all is unknown', () => {
    a.eq(sc().statusOf(0.9), 'watched');
    a.eq(sc().statusOf(0.89), 'partial');
    a.eq(sc().statusOf(0), 'none');
    a.eq(sc().statusOf(null), 'unknown');
  });

  test('without a roster: Studio’s student viewers alone, by last name', () => {
    const L = sc().viewersOnly(sc().viewersFrom(USERS));
    a.deep(L.rows.map((r) => r.name), ['Zachary (Zach) Fellman', "Jameson O'Donnell", 'Dropped Student', 'Thomas (Tommy) Tegler'].sort((x, y) => {
      const last = (n) => sc().plainName(n).split(' ').pop();
      return last(x).localeCompare(last(y));
    }));
    a.ok(L.viewersOnly);
  });

  test('a video’s embeds, by uuid, in a bare list or under a key', () => {
    const a1 = sc().perspectivesFrom({ perspectives: [{ uuid: 'abc', course: { name: 'AP Biology - 1', course_id: 376 } }] });
    a.deep(a1, [{ uuid: 'abc', name: 'AP Biology - 1', courseId: 376 }]);
    const a2 = sc().perspectivesFrom([{ uuid: 'xyz', title: 'AP Biology - 2' }]);
    a.eq(a2[0].name, 'AP Biology - 2');
  });

  test('overview: counts and a viewers-across-the-video line, read loosely', () => {
    const o = sc().overviewFrom({ insights: { views: 18, unique_viewers: 14, unique_viewers_over_time: [14, 12, 11, 11, 9, 5] } });
    a.eq(o.views, 18);
    a.eq(o.uniqueViewers, 14);
    a.eq(o.timeline.length, 6);
    a.eq(o.timeline[5].at, 1);
    const o2 = sc().overviewFrom({ unique_viewers: [{ time: 0, count: 14 }, { time: 30, count: 10 }, { time: 60, count: 4 }] });
    a.deep(o2.timeline.map((p) => p.value), [14, 10, 4]);
    a.eq(o2.timeline[1].at, 0.5);
    a.eq(sc().overviewFrom({ nothing: 'here' }).timeline, null);
  });
});

suite('Studio videos for one student', (test) => {
  // Trimmed from the real collections and tiles answers.
  const COLLECTIONS = [
    { id: 713, type: 'course_wide', name: 'AP Biology - 2' },
    { id: 400, type: 'course_wide', name: 'Integrated Science I - 4' },
    { id: 252, type: 'course_wide', name: 'AP Biology - 1' }
  ];
  const TILES = { tiles: [
    { item_type: 'perspective', data: { id: 'CwFk9GMFJK-bCZ5dUFUa2g', title: 'The Scientific Method', created_at: '2026-11-04T04:07:26Z', archived_at: null,
      media: { id: 257, duration: 909.0, thumbnail_url: 'https://i.ytimg.com/x.jpg' } } },
    { item_type: 'perspective', data: { id: 'IMSKjIsEsPct9BECUs17rQ', title: 'VIDEO - Isotopes & Average Atomic Mass', created_at: '2026-10-12T17:01:21Z',
      media: { id: 203, duration: 687.0 } } },
    { item_type: 'media', data: { id: 'not-a-perspective' } },
    { item_type: 'perspective', data: { id: 'old', title: 'Archived', archived_at: '2026-10-01T00:00:00Z', media: {} } }
  ] };

  test('finds the Studio course by the Canvas course name', () => {
    a.eq(sc().findCollection(COLLECTIONS, 'AP Biology - 1').id, 252);
    a.eq(sc().findCollection(COLLECTIONS, 'ap biology – 1').id, 252, 'case and dash style ignored');
    a.eq(sc().findCollection(COLLECTIONS, 'Chemistry'), null);
    a.eq(sc().findCollection(COLLECTIONS, ['AP Biology - 1', 'AP Biology (Block 6)']).id, 252, 'real name first');
    a.eq(sc().findCollection(COLLECTIONS, ['Chemistry', 'AP Biology - 1']).id, 252, 'falls back to the next name');
    a.eq(sc().findCollection(COLLECTIONS, ['', null, 'Chemistry']), null);
  });

  test('reads a course’s videos from its tiles', () => {
    const v = sc().videosFromTiles(TILES);
    a.deep(v.map((x) => x.uuid), ['CwFk9GMFJK-bCZ5dUFUa2g', 'IMSKjIsEsPct9BECUs17rQ', 'old']);
    a.eq(v[0].duration, 909);
    a.ok(v[2].archived);
  });

  test('one student across the videos: watched, partly, not watched; newest first', () => {
    const videos = sc().videosFromTiles(TILES);
    videos[0].viewers = sc().viewersFrom({ insights: [{ display_name: 'Avery Adams', email: 'aadams@x.org', role_names: ['Student'], completion_rate: 0.5 }] });
    videos[1].viewers = sc().viewersFrom({ insights: [{ display_name: 'Someone Else', email: 'se@x.org', role_names: ['Student'], completion_rate: 1 }] });
    const r = sc().studentVideos(videos, { name: 'Avery Adams', sortable_name: 'Adams, Avery', email: 'AAdams@x.org' });
    a.eq(r.rows.length, 2, 'archived left out');
    a.eq(r.rows[0].title, 'The Scientific Method');
    a.eq(r.rows[0].status, 'partial');
    a.eq(r.rows[0].watchedSeconds, 454.5);
    a.eq(r.rows[1].status, 'none');
    a.eq(r.rows[1].classWatched, 1);
    a.deep(r.counts, { total: 2, watched: 0, partial: 1, none: 1, unknown: 0 });
  });

  test('why Studio gave no viewers: no access (403) or gone (404), each said plainly', () => {
    const videos = [
      { uuid: 'x1', title: 'A', viewers: [], error: 'no insights', errorStatus: 403, places: [{ kind: 'Page', name: 'P' }] },
      { uuid: 'x2', title: 'B', viewers: [], error: 'unavailable', errorStatus: 404, places: [{ kind: 'Page', name: 'P' }] },
      { uuid: 'x3', title: 'C', viewers: [], error: 'unavailable', places: [{ kind: 'Page', name: 'P' }] }
    ];
    const r = sc().studentVideos(videos, { name: 'Avery Adams', email: 'aadams@x.org' });
    const by = Object.fromEntries(r.rows.map((x) => [x.uuid, x]));
    a.eq(by.x1.label, 'No access in Studio');
    a.eq(by.x2.label, 'Not found in Studio');
    a.eq(by.x3.label, 'Unavailable');
    a.ok(r.rows.every((x) => x.status === 'unknown'));
  });

  test('students’ own recordings are told apart from the teacher’s videos, and not counted', () => {
    const submitted = sc().studentEmbeds(
      [{ user_id: 7, url: 'https://s.instructuremedia.com/lti/launch?custom_arc_media_id=SUBMIT-uuid-1' },
        { user_id: 8, body: '<p><iframe src="/courses/1/external_tools/retrieve?url=https%3A%2F%2Fs.instructuremedia.com%2Flti%2Flaunch%3Fcustom_arc_media_id%3DTEXT-uuid-2"></iframe></p>' }],
      [{ user_id: 9, message: '<iframe title="My project" src="https://s.instructuremedia.com/embed/REPLY-uuid-3"></iframe>' }]);
    a.deep(Object.keys(submitted).sort(), ['REPLY-uuid-3', 'SUBMIT-uuid-1', 'TEXT-uuid-2']);
    a.eq(submitted['REPLY-uuid-3'].userId, '9');
    a.eq(submitted['REPLY-uuid-3'].kind, 'Discussion reply');
    const videos = [
      { uuid: 'POSTED', title: 'Cells', viewers: [], places: [{ kind: 'Page', name: 'Cells' }] },
      { uuid: 'REPLY-uuid-3', title: 'AP Bio nucleus project', viewers: [], places: [] },
      { uuid: 'cap', title: '[Untitled Thu Nov 19 2026 16:42:28 GMT-0500 (Eastern Standard Time)]', viewers: [], places: [] },
      { uuid: 'spare', title: 'Old lecture', viewers: [], places: [] }
    ];
    const r = sc().studentVideos(videos, { name: 'Avery Adams', email: 'aadams@x.org' }, { studentEmbeds: submitted });
    const by = Object.fromEntries(r.rows.map((x) => [x.uuid, x]));
    a.eq(by.POSTED.origin, 'posted');
    a.eq(by['REPLY-uuid-3'].origin, 'student');
    a.eq(by['REPLY-uuid-3'].submittedBy, '9');
    a.eq(by.cap.origin, 'student', 'Studio’s default recording title');
    a.eq(by.spare.origin, 'unposted');
    a.deep(r.postedCounts, { total: 1, watched: 0, partial: 0, none: 1, unknown: 0 });
    a.eq(r.counts.total, 4);
    a.ok(!sc().isCaptureTitle('Untitled video') && !sc().isCaptureTitle('Dehydration synthesis and hydrolysis'));
  });

  test('a video whose viewers Studio didn’t give is unknown, not "not watched"', () => {
    const videos = sc().videosFromTiles(TILES).slice(0, 1);
    videos[0].viewers = [];
    videos[0].error = 'unavailable';
    const r = sc().studentVideos(videos, { name: 'Avery Adams', email: 'aadams@x.org' });
    a.eq(r.rows[0].status, 'unknown');
    a.eq(r.rows[0].completion, null);
    a.deep(r.counts, { total: 1, watched: 0, partial: 0, none: 0, unknown: 1 });
  });
  // A Studio video embedded with Canvas's editor: Canvas's own launch
  // address with Studio's, URL-encoded, inside.
  const EMBED = '<p>Watch the full video about isotopes below.</p>' +
    '<p><iframe class="lti-embed" style="width: 720px; height: 405px;" title="Isotopes &amp; Average Atomic Mass" ' +
    'src="/courses/376/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fmalvernprep.instructuremedia.com%2Flti%2Flaunch%3F' +
    'custom_arc_launch_type%3Dbare_embed%26custom_arc_media_id%3Dd9b3c1aa-1111-4a2b-9c3d-abcdef012345%26custom_arc_start_at%3D0" ' +
    'allowfullscreen="allowfullscreen"></iframe></p>';

  test('finds a Studio video embedded in an assignment’s description, with its title', () => {
    a.deep(sc().embedsFromHtml(EMBED), [{ uuid: 'd9b3c1aa-1111-4a2b-9c3d-abcdef012345', title: 'Isotopes & Average Atomic Mass' }]);
  });

  test('also a twice-encoded launch, a share link, and each video once', () => {
    const twice = '<iframe src="/courses/1/external_tools/retrieve?url=https%253A%252F%252Fx.instructuremedia.com%252Flti%252Flaunch%253Fcustom_arc_media_id%253Dabc123-xyz"></iframe>';
    const share = '<a href="https://x.instructuremedia.com/embed/0f0f0f0f-2222">Watch</a><iframe title="Video player for Cells" src="https://x.instructuremedia.com/embed/0f0f0f0f-2222"></iframe>';
    a.deep(sc().embedsFromHtml(twice).map((e) => e.uuid), ['abc123-xyz']);
    a.deep(sc().embedsFromHtml(share), [{ uuid: '0f0f0f0f-2222', title: '' }]);
    a.deep(sc().embedsFromHtml('<iframe src="https://www.youtube.com/embed/xyz"></iframe>'), [], 'YouTube is not Studio');
  });

  test('joins where each video is embedded; embedded videos not in Studio’s course list come back apart', () => {
    const videos = sc().videosFromTiles(TILES);
    const place = { kind: 'Assignment', name: 'HW - Isotopes', url: '/courses/1/assignments/7749', modules: ['Unit 2'] };
    const j = sc().joinEmbeds(videos, [
      { uuid: videos[0].uuid, title: '', place },
      { uuid: 'not-in-studio-list', title: 'Isotopes', place },
      { uuid: 'not-in-studio-list', title: 'Isotopes', place }
    ]);
    a.deep(j.videos[0].places, [place]);
    a.eq(j.missing.length, 1);
    a.eq(j.missing[0].places.length, 1, 'the same place once');
  });

  test('"in class" counts only this class’s viewers when the class is known', () => {
    const videos = [{ uuid: 'u1', title: 'Copied embed', viewers: sc().viewersFrom(USERS) }];
    const all = sc().studentVideos(videos, { name: 'Avery Adams', email: 'aadams@school.org' });
    const mine = sc().studentVideos(videos, { name: 'Avery Adams', email: 'aadams@school.org' },
      { classEmails: { 'ttegler07@school.org': true, 'aadams@school.org': true } });
    a.eq(all.rows[0].classWatched, 4);
    a.eq(mine.rows[0].classWatched, 1);
  });

  test('an embed that is the same video as one in Studio’s course list is folded into it, not listed twice', () => {
    const viewers = sc().viewersFrom(USERS);
    const course = { uuid: 'course-p', mediaId: 41, title: 'Biological Molecules', viewers: viewers.slice(0, 2) };
    const viaMedia = { uuid: 'embed-x', title: 'Biological Molecules', embeddedOnly: true,
      viewers: [{ id: '234', name: 'Thomas (Tommy) Tegler', email: 'ttegler07@school.org', roles: ['Student'], teacher: false, completion: 0.5 },
        { id: '466', name: 'Zach', email: 'zfellman09@school.org', roles: ['Student'], teacher: false, completion: 0.95 }] };
    const errored = { uuid: 'embed-y', title: 'biological molecules', embeddedOnly: true, viewers: [], error: 'unavailable', errorStatus: 404 };
    const other = { uuid: 'embed-z', title: 'Something else', embeddedOnly: true, viewers: [], error: 'unavailable' };
    const out = sc().foldEmbeds([course, viaMedia, errored, other], { 'embed-x': 'course-p' });
    a.deep(out.map((v) => v.uuid), ['course-p', 'embed-z'], 'the media’s own embed, and an unreadable one with the same title, fold in');
    a.deep(out[0].aliases, ['embed-x', 'embed-y']);
    const by = Object.fromEntries(out[0].viewers.map((v) => [v.email, v.completion]));
    a.eq(by['ttegler07@school.org'], 1, 'the most watched in either embed');
    a.eq(by['zfellman09@school.org'], 0.95, 'a viewer only in the embed is kept');
    const joined = sc().joinEmbeds(out, [{ uuid: 'embed-x', title: 'Biological Molecules', place: { kind: 'Assignment', name: 'HW', url: '/courses/1/assignments/5', modules: [] } }]);
    a.eq(joined.missing.length, 0, 'an alias places the course video');
    a.eq(joined.videos[0].places[0].name, 'HW');
  });

  test('two course videos with the same title but different lengths: an unreadable embed is not guessed into either', () => {
    const out = sc().foldEmbeds([{ uuid: 'a', title: 'Intro', duration: 300 }, { uuid: 'b', title: 'Intro', duration: 420 },
      { uuid: 'x', title: 'Intro', embeddedOnly: true, error: 'unavailable' }], {});
    a.eq(out.length, 3);
  });

  test('a course video and an embed of it under another embed id are one row, placed where the embed is', () => {
    // Studio's course list has the video (not embedded anywhere under its
    // own id); the page embeds a copy whose viewers Studio didn't give and
    // whose perspectives lookup found nothing.
    const course = { uuid: 'course-g', mediaId: 7, title: 'Genes, proteins, and traits | Khan Academy', duration: 300,
      viewers: [{ id: '1', name: 'Avery Adams', email: 'aadams@school.org', roles: ['Student'], teacher: false, completion: 1 }] };
    const embed = { uuid: 'embed-g', title: 'Genes, proteins, and traits | Khan Academy', embeddedOnly: true, duration: null, viewers: [], error: 'unavailable', errorStatus: 404 };
    const readable = { uuid: 'embed-h', title: 'genes proteins and traits khan academy', embeddedOnly: true, duration: null,
      viewers: [{ id: '2', name: 'Blake Brown', email: 'bbrown@school.org', roles: ['Student'], teacher: false, completion: 0.4 }] };
    const out = sc().foldEmbeds([course, embed, readable], {});
    a.deep(out.map((v) => v.uuid), ['course-g'], 'one row, the course’s own');
    a.deep(out[0].viewers.map((v) => v.email).sort(), ['aadams@school.org', 'bbrown@school.org'], 'viewers of every copy');
    const j = sc().joinEmbeds(out, [{ uuid: 'embed-g', title: 'x', place: { kind: 'Page', name: 'DNA Structure', url: '/courses/1/pages/dna', modules: [] } }]);
    a.eq(j.missing.length, 0);
    a.eq(j.videos[0].places[0].name, 'DNA Structure', 'not “Not posted in Canvas”');
    const rows = sc().studentVideos(j.videos, { name: 'Avery Adams', email: 'aadams@school.org' });
    a.eq(rows.rows.length, 1);
    a.eq(rows.rows[0].status, 'watched', 'not “Unavailable”');
  });

  test('the same media added to the course twice is one row', () => {
    const out = sc().foldEmbeds([
      { uuid: 'p1', mediaId: 9, title: 'Gel Electrophoresis', duration: 480, viewers: [], error: 'unavailable' },
      { uuid: 'p2', mediaId: 9, title: 'Gel electrophoresis (copy)', duration: 480, viewers: [] }
    ], {});
    a.deep(out.map((v) => v.uuid), ['p2'], 'the readable copy is kept');
    a.deep(out[0].aliases, ['p1']);
  });

  test('similar titles with different lengths stay two videos', () => {
    const out = sc().foldEmbeds([
      { uuid: 't', title: 'Genes, proteins, and traits | Middle school biology', duration: 300, viewers: [] },
      { uuid: 'c', title: 'Genes, proteins, and cells | High school biology', duration: 420, viewers: [] }
    ], {});
    a.eq(out.length, 2);
  });

  test('the same video under the same title in two modules is two places', () => {
    const place = (url, mod) => ({ uuid: 'v1', title: 'Review video', place: { kind: 'Module', name: 'Review video', url, modules: [mod] } });
    const j = sc().joinEmbeds([{ uuid: 'v1', title: 'Review video' }], [
      place('/courses/1/modules/items/10', 'Unit 1'), place('/courses/1/modules/items/20', 'Unit 2'),
      place('/courses/1/modules/items/20', 'Unit 2')
    ]);
    a.deep(j.videos[0].places.map((p) => p.modules[0]), ['Unit 1', 'Unit 2'], 'both modules kept, a repeat once');
    const noIds = sc().joinEmbeds([{ uuid: 'v1', title: 'Review video' }], [place('/courses/1/modules', 'Unit 1'), place('/courses/1/modules', 'Unit 2')]);
    a.deep(noIds.videos[0].places.map((p) => p.modules), [['Unit 1', 'Unit 2']], 'one address: its modules merged');
  });
});

/* ------------------------------------------- attribution and identity */

suite('Studio: who watched, and which video', (test) => {
  const ALEX1 = { id: '101', name: 'Alex Rivera', sortable_name: 'Rivera, Alex', email: 'arivera1@school.org' };
  const ALEX2 = { id: '102', name: 'Alex Rivera', sortable_name: 'Rivera, Alex', email: 'arivera2@school.org' };
  const VIEWER2 = { insights: [{ id: 77, display_name: 'Alex Rivera', email: 'ARivera2@school.org', role_names: ['Student'], completion_rate: 0.95 }] };
  const show = (L) => L.rows.map((r) => [r.id, r.label, r.completion]);
  const out = (label, x) => console.log('       fixture ' + label + ': ' + JSON.stringify(x));

  test('REGRESSION: two Alex Riveras, the viewer’s email is the second one’s - in both roster orders', () => {
    [[ALEX1, ALEX2], [ALEX2, ALEX1]].forEach((roster, n) => {
      const L = sc().classList(roster, sc().viewersFrom(VIEWER2));
      const by = Object.fromEntries(L.rows.map((r) => [r.id, r]));
      a.eq(by['101'].status, 'none', 'order ' + n + ': the first never watched');
      a.eq(by['101'].label, 'Not watched');
      a.eq(by['101'].viewer, null);
      a.eq(by['102'].status, 'watched', 'order ' + n);
      a.eq(by['102'].matchedBy, 'email');
      a.eq(by['102'].completion, 0.95);
      a.deep(L.counts, { total: 2, watched: 1, partial: 0, none: 1, unknown: 0 });
      a.deep(L.extra, []);
      out('order ' + (n ? 'Alex2, Alex1' : 'Alex1, Alex2'), { rows: show(L), counts: L.counts, average: L.averageCompletion });
    });
  });

  test('a name is used only when it names one student and one viewer, and no email disagrees', () => {
    // The viewer's email belongs to nobody: someone else, not either Alex.
    const other = sc().viewersFrom({ insights: [{ id: 5, display_name: 'Alex Rivera', email: 'alex.r@elsewhere.org', role_names: ['Student'], completion_rate: 1 }] });
    const L1 = sc().classList([ALEX1], other);
    a.eq(L1.rows[0].label, 'Not watched', 'a conflicting email is never overridden by a name');
    a.eq(L1.extra.length, 1);
    // No emails on either side: one Alex on the roster is fine...
    const bare = sc().viewersFrom({ insights: [{ id: 6, display_name: 'Alex Rivera', role_names: ['Student'], completion_rate: 0.5 }] });
    const noMail = (x) => Object.assign({}, x, { email: '' });
    a.eq(sc().classList([noMail(ALEX1)], bare).rows[0].label, 'Partly watched');
    // ...two are "Match unclear" for both, in either order, and not counted.
    [[noMail(ALEX1), noMail(ALEX2)], [noMail(ALEX2), noMail(ALEX1)]].forEach((roster) => {
      const L = sc().classList(roster, bare);
      a.deep(L.rows.map((r) => r.label), ['Match unclear', 'Match unclear']);
      a.deep(L.counts, { total: 2, watched: 0, partial: 0, none: 0, unknown: 2 });
      a.eq(L.averageCompletion, null, 'unknown is not 0%');
      a.eq(L.unclear.length, 1);
      a.eq(L.extra.length, 0, 'not called “not on the roster”');
      out('two Alexes, no emails', { rows: show(L), counts: L.counts, average: L.averageCompletion });
    });
  });

  test('a matched viewer with no completion is “Completion unavailable”; a known 0 is “Not watched” at 0%', () => {
    const v = sc().viewersFrom({ insights: [
      { id: 1, display_name: 'Alex Rivera', email: 'arivera1@school.org', role_names: ['Student'] },
      { id: 2, display_name: 'Alex Rivera', email: 'arivera2@school.org', role_names: ['Student'], completion_rate: 0 }
    ] });
    const L = sc().classList([ALEX1, ALEX2, { id: '103', name: 'Bo Chen', sortable_name: 'Chen, Bo', email: 'bchen@school.org' }], v);
    const by = Object.fromEntries(L.rows.map((r) => [r.id, r]));
    a.eq(by['101'].label, 'Completion unavailable');
    a.eq(by['101'].status, 'unknown');
    a.eq(by['101'].completion, null);
    a.eq(by['102'].label, 'Not watched');
    a.eq(by['102'].completion, 0);
    a.eq(by['103'].label, 'Not watched');
    a.eq(by['103'].completion, null);
    a.deep(L.counts, { total: 3, watched: 0, partial: 0, none: 2, unknown: 1 });
    a.eq(L.averageCompletion, 0);
    a.eq(L.averageOf, 2, 'the average leaves out the unknown share');
    const only = sc().viewersOnly(v);
    a.deep(only.counts, { total: 2, watched: 0, partial: 0, none: 1, unknown: 1 });
    out('missing vs zero completion', { rows: show(L), counts: L.counts, average: L.averageCompletion, averageOf: L.averageOf });
  });

  test('the student overview matches against the whole class, so a shared name is not taken', () => {
    const vid = (viewers) => [{ uuid: 'v1', title: 'Cell walk', duration: 300, createdAt: '2026-11-01', viewers: sc().viewersFrom(viewers) }];
    // Alex 1's own overview: the email belongs to Alex 2.
    [[ALEX1, ALEX2], [ALEX2, ALEX1]].forEach((roster) => {
      const r1 = sc().studentVideos(vid(VIEWER2), ALEX1, { roster }).rows[0];
      a.eq(r1.label, 'Not watched');
      a.eq(r1.completion, null);
      const r2 = sc().studentVideos(vid(VIEWER2), ALEX2, { roster }).rows[0];
      a.eq(r2.label, 'Watched');
      a.eq(r2.watchedSeconds, 285);
    });
    // No emails: on a one-student roster the name would match; with the class it is unclear.
    const bare = { insights: [{ id: 6, display_name: 'Alex Rivera', role_names: ['Student'], completion_rate: 0.5 }] };
    const lone = Object.assign({}, ALEX1, { email: '' }), twin = Object.assign({}, ALEX2, { email: '' });
    const s = sc().studentVideos(vid(bare), lone, { roster: [lone, twin] });
    a.eq(s.rows[0].label, 'Match unclear');
    a.eq(s.rows[0].watchedSeconds, null);
    a.deep(s.counts, { total: 1, watched: 0, partial: 0, none: 0, unknown: 1 });
    // Completion missing in the overview too, and "in class" counts only known viewing.
    const nc = sc().studentVideos(vid({ insights: [{ id: 1, display_name: 'Alex Rivera', email: 'arivera1@school.org', role_names: ['Student'] }] }), ALEX1, { roster: [ALEX1, ALEX2] });
    a.eq(nc.rows[0].label, 'Completion unavailable');
    a.eq(nc.rows[0].classWatched, 0);
    out('student overview', { alex1: 'Not watched', alex2: 'Watched (285 s)', sharedNameNoEmail: s.rows[0].label, noCompletion: nc.rows[0].label });
  });

  test('two videos with different media ids stay two, though titles match and lengths differ by a second', () => {
    const a1 = { uuid: 'p1', mediaId: 501, title: 'Lab safety', duration: 240, viewers: [] };
    const a2 = { uuid: 'p2', mediaId: 502, title: 'Lab safety', duration: 241, viewers: [] };
    const folded = sc().foldEmbeds([a1, a2].map((x) => Object.assign({}, x)));
    a.deep(folded.map((v) => v.uuid), ['p1', 'p2']);
    // An embed with no media id and no length still joins the one it can only be... unless two media share the title.
    const emb = { uuid: 'e9', title: 'Lab safety', duration: null, embeddedOnly: true, viewers: [] };
    a.eq(sc().foldEmbeds([a1, a2, emb].map((x) => Object.assign({}, x))).length, 3, 'nothing guessed between two media');
    // Same media id, or same title and length with no media ids: still one.
    a.eq(sc().foldEmbeds([Object.assign({}, a1), Object.assign({}, a1, { uuid: 'p3', duration: 238 })]).length, 1);
    a.eq(sc().foldEmbeds([{ uuid: 'q1', title: 'Lab safety', duration: 240, viewers: [] }, { uuid: 'q2', title: 'Lab safety', duration: 241, viewers: [] }]).length, 1);
    out('distinct media', { videos: folded.map((v) => v.uuid + ':' + v.mediaId) });
  });

  test('a verified Studio alias still folds into its course video, with its viewers', () => {
    const course = { uuid: 'p1', mediaId: 501, title: 'Lab safety', duration: 240, viewers: sc().viewersFrom({ insights: [{ id: 1, display_name: 'Alex Rivera', email: 'arivera1@school.org', role_names: ['Student'], completion_rate: 0.3 }] }) };
    const embed = { uuid: 'emb-7', title: 'Copied embed', duration: null, embeddedOnly: true,
      viewers: sc().viewersFrom({ insights: [{ id: 2, display_name: 'Alex Rivera', email: 'arivera2@school.org', role_names: ['Student'], completion_rate: 1 }] }) };
    const out1 = sc().foldEmbeds([course, embed], { 'emb-7': 'p1' });
    a.eq(out1.length, 1);
    a.deep(out1[0].aliases, ['emb-7']);
    const L = sc().classList([ALEX1, ALEX2], out1[0].viewers);
    a.deep(L.rows.map((r) => [r.id, r.label]), [['101', 'Partly watched'], ['102', 'Watched']]);
    out('verified alias', { aliases: out1[0].aliases, rows: L.rows.map((r) => [r.id, r.label, r.completion]) });
  });
});
