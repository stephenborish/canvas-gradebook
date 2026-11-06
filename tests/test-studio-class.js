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
    a.deep(L.counts, { total: 5, watched: 1, partial: 2, none: 2 });
    a.deep(L.extra.map((v) => v.name), ['Dropped Student'], 'a student viewer not on the roster; the teacher left out');
    a.eq(Math.round(L.averageCompletion * 1000), Math.round(((1 + 0.65625 + 0.4375) / 5) * 1000));
  });

  test('a student with no email is matched by name, nicknames in brackets ignored', () => {
    const L = sc().classList([{ id: '9', name: 'Thomas Tegler', sortable_name: 'Tegler, Thomas', email: '' }], sc().viewersFrom(USERS));
    a.eq(L.rows[0].status, 'watched');
  });

  test('90% or more counts as watched; nothing or 0% is not watched', () => {
    a.eq(sc().statusOf(0.9), 'watched');
    a.eq(sc().statusOf(0.89), 'partial');
    a.eq(sc().statusOf(0), 'none');
    a.eq(sc().statusOf(null), 'none');
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

  test('two course videos with the same title: an unreadable embed is not guessed into either', () => {
    const out = sc().foldEmbeds([{ uuid: 'a', title: 'Intro' }, { uuid: 'b', title: 'Intro' }, { uuid: 'x', title: 'Intro', embeddedOnly: true, error: 'unavailable' }], {});
    a.eq(out.length, 3);
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
