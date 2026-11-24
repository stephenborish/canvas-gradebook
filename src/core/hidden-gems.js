/* Canvas Gradebook+ - Hidden Gems (pure logic: when, which, and subject).
 *
 * Rare moments when the Canvas page on screen comes to life for a few
 * seconds and then puts itself back exactly as it was. The pieces are drawn
 * by core/hidden-gems-ui.js; this module only decides when one may play and
 * which one. The subject comes from the current course name or the
 * teacher's cached course list, with zero extra API calls. Nothing is saved
 * except the cooldown record.
 *
 * Pure JS: no DOM and no chrome.* access at load time, so Node unit tests
 * can load and exercise this module directly. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.hiddenGems) return;

  var GEMS = ['gravity'];

  // Infrequent but discoverable: at most once every 24 hours, ~12% roll on an
  // eligible page visit, after settling on the page for 25–90s (averages roughly
  // one sighting every 2–3 teaching days).
  var DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  var DEFAULT_CHANCE = 0.12;
  var MIN_DELAY_MS = 25000;
  var MAX_DELAY_MS = 90000;

  /* Ordered specific-first so "AP Chemistry" matches chemistry before science,
   * "English Language Arts" matches literature before art, etc. */
  var SUBJECT_RULES = [
    { id: 'spanish',    label: 'Español',          re: /\b(spanish|espa[nñ]ol|castellano|ap\s*span(?:ish)?|spn)\b/i },
    { id: 'french',     label: 'Français',         re: /\b(french|fran[cç]ais|ap\s*french)\b/i },
    { id: 'german',     label: 'Deutsch',          re: /\b(german|deutsch|ap\s*german)\b/i },
    { id: 'latin',      label: 'Latina',           re: /\b(latin|ap\s*latin)\b/i },
    { id: 'chinese',    label: '中文',             re: /\b(chinese|mandarin|cantonese|hanyu|zhongwen|ap\s*chinese)\b|中文|汉语|漢語|华文|華文/i },
    { id: 'cs',         label: 'Computer Science', re: /\b(comp(?:uter)?\s*sci(?:ence)?|ap\s*cs[ap]?|apcsp|apcsa|programming|coding|robotics|web\s*dev|software|python|java(?:script)?|data\s*structures|engineering)\b/i },
    { id: 'chemistry',  label: 'Chemistry',        re: /\b(chem(?:istry)?|ap\s*chem|organic\s*chem|biochem(?:istry)?|stoich(?:iometry)?)\b/i },
    { id: 'physics',    label: 'Physics',          re: /\b(phys(?:ics)?|ap\s*phys(?:ics)?|mechanics|electromagnetism|astronomy|astrophysics|quantum)\b/i },
    { id: 'biology',    label: 'Biology',          re: /\b(bio(?:logy)?|ap\s*bio|anatomy|physiology|ecology|genetics|botany|zoology|microbiology|marine\s*sci(?:ence)?|env(?:ironmental)?\s*sci(?:ence)?)\b/i },
    { id: 'calculus',   label: 'Calculus',         re: /\b(calc(?:ulus)?|ap\s*calc|multivariable|diff(?:erential)?\s*eq(?:uations)?)\b/i },
    { id: 'math',       label: 'Mathematics',      re: /\b(math(?:ematics)?|algebra|geom(?:etry)?|trig(?:onometry)?|pre-?calc(?:ulus)?|stat(?:istic)?s|ap\s*stat(?:s)?|linear\s*algebra|discrete\s*math|number\s*theory)\b/i },
    { id: 'economics',  label: 'Economics',        re: /\b((?:macro|micro)?econ(?:omics)?|finance|accounting|business|entrepreneur(?:ship)?)\b/i },
    { id: 'psychology', label: 'Psychology',       re: /\b(psych(?:ology)?|sociology|ap\s*psych)\b/i },
    { id: 'science',    label: 'Science',          re: /\b(sci(?:ence)?|earth\s*sci(?:ence)?|physical\s*sci(?:ence)?|geology|forensic(?:s)?|stem|lab\s*science)\b/i },
    { id: 'theology',   label: 'Theology',         re: /\b(theol(?:ogy)?|relig(?:ion|ious)?|scripture|bibl(?:e|ical)|catholic|christian(?:ity)?|ethics|philosophy|apologetics|liturgy|world\s*religions|sacraments?|catechism)\b/i },
    { id: 'literature', label: 'Literature',       re: /\b(english|lit(?:erature)?|ap\s*lang|ap\s*lit|writing|composition|rhetoric|poetry|journalism|shakespeare|ela|language\s*arts|reading)\b/i },
    { id: 'history',    label: 'History',          re: /\b(hist(?:ory)?|apush|ap\s*euro|ap\s*world|civics|gov(?:ernment)?|geography|archaeology|social\s*studies|humanities|western\s*civ)\b/i },
    { id: 'music',      label: 'Music',            re: /\b(music|band|choir|chorus|chorale|orchestra|jazz|guitar|piano|strings|vocal|symphony|percussion|ap\s*music)\b/i },
    { id: 'drama',      label: 'Theatre',          re: /\b(drama|theat(?:er|re)|acting|stagecraft|improv)\b/i },
    { id: 'art',        label: 'Art',              re: /\b(art|arts|drawing|painting|ceramics|pottery|sculpture|photography|graphic\s*design|studio\s*art|architecture|film|illustration)\b/i },
    { id: 'pe',         label: 'Athletics',        re: /\b(p\.?e\.?|physical\s*education|fitness|wellness|athletics|gym|kinesiology|health)\b/i },
    { id: 'language',   label: 'World Languages',  re: /\b(japanese|italian|korean|arabic|greek|hebrew|linguistics|world\s*lang(?:uage)?s?|esl|ell)\b/i }
  ];

  var SUBJECT_LABELS = { general: 'General' };
  for (var i = 0; i < SUBJECT_RULES.length; i++) {
    SUBJECT_LABELS[SUBJECT_RULES[i].id] = SUBJECT_RULES[i].label;
  }

  function matchSubject(text) {
    var s = String(text || '').trim();
    if (!s) return null;
    for (var idx = 0; idx < SUBJECT_RULES.length; idx++) {
      if (SUBJECT_RULES[idx].re.test(s)) return SUBJECT_RULES[idx].id;
    }
    return null;
  }

  function detectSubject(currentCourseName, allCourseNames) {
    var direct = matchSubject(currentCourseName);
    if (direct) {
      return { id: direct, label: SUBJECT_LABELS[direct], source: 'course' };
    }
    var list = Array.isArray(allCourseNames) ? allCourseNames : [];
    var counts = Object.create(null);
    var bestId = null;
    var bestCount = 0;
    for (var j = 0; j < list.length; j++) {
      var m = matchSubject(list[j]);
      if (!m) continue;
      counts[m] = (counts[m] || 0) + 1;
      if (counts[m] > bestCount) {
        bestCount = counts[m];
        bestId = m;
      }
    }
    if (bestId) {
      return { id: bestId, label: SUBJECT_LABELS[bestId], source: 'courses' };
    }
    return { id: 'general', label: SUBJECT_LABELS.general, source: 'default' };
  }

  /* ------------------------------------------------------ per-subject styling */

  /* The crane is folded from a sheet of patterned washi paper. Each subject
   * gets its own sheet: a colour, a print that suits the subject (hexagons
   * for chemistry, graph paper for maths, a music staff for music, waves,
   * hemp leaf or circles for the rest), and the colour of the print. */
  var SUBJECT_STYLE = {
    chemistry:  { paper: '#1f7f86', print: '#e9f4f1', pattern: 'hex' },
    physics:    { paper: '#263d8a', print: '#f3d98b', pattern: 'stars' },
    biology:    { paper: '#3f7d46', print: '#f0ecd2', pattern: 'asanoha' },
    science:    { paper: '#22708f', print: '#eef6f6', pattern: 'hex' },
    calculus:   { paper: '#24467d', print: '#e8eef8', pattern: 'grid' },
    math:       { paper: '#2c5aa3', print: '#f1f4fb', pattern: 'grid' },
    chinese:    { paper: '#b8322a', print: '#f2c76e', pattern: 'seigaiha' },
    spanish:    { paper: '#1d58a0', print: '#f6e7c1', pattern: 'shippo' },
    french:     { paper: '#36508f', print: '#f5ecdc', pattern: 'dots' },
    german:     { paper: '#2f4656', print: '#e6d5b0', pattern: 'asanoha' },
    latin:      { paper: '#9a4a2c', print: '#f3dfb9', pattern: 'shippo' },
    theology:   { paper: '#4f3a85', print: '#f1d48a', pattern: 'stars' },
    history:    { paper: '#86352c', print: '#efdcc0', pattern: 'seigaiha' },
    literature: { paper: '#5e3556', print: '#f2e3e8', pattern: 'lines' },
    music:      { paper: '#2c2a4e', print: '#e9dcb4', pattern: 'staff' },
    art:        { paper: '#c0402f', print: '#fbe8c8', pattern: 'dots' },
    drama:      { paper: '#6e2445', print: '#f4d28c', pattern: 'stars' },
    cs:         { paper: '#1c5e52', print: '#bff0d8', pattern: 'grid' },
    economics:  { paper: '#2b6148', print: '#eee5c6', pattern: 'shippo' },
    psychology: { paper: '#4a3d7d', print: '#ecdff5', pattern: 'seigaiha' },
    pe:         { paper: '#bf532a', print: '#fbeadb', pattern: 'lines' },
    language:   { paper: '#2b6a86', print: '#f2ebda', pattern: 'seigaiha' },
    general:    { paper: '#c4413a', print: '#f6e2c2', pattern: 'seigaiha' }
  };

  function pick(arr, rng) {
    if (!arr || !arr.length) return null;
    var r = typeof rng === 'function' ? rng() : Math.random();
    var idx = Math.floor(Math.max(0, Math.min(0.999999, r)) * arr.length);
    return arr[idx];
  }

  function seedFrom(rng) {
    return Math.floor((typeof rng === 'function' ? rng() : Math.random()) * 4294967295) >>> 0;
  }

  /* Return subject-tailored, per-iteration-varied props for a given gem.
   * `seed` drives every random choice the drawing makes, so one seed always
   * draws the same flock, flight or branch. */
  function contentFor(gemId, subjectId, rng) {
    var key = SUBJECT_STYLE[subjectId] ? subjectId : 'general';
    var style = SUBJECT_STYLE[key];
    var rand = typeof rng === 'function' ? rng : Math.random;
    var base = { subjectId: key, subjectLabel: SUBJECT_LABELS[key] || 'General' };

    if (gemId === 'murmuration' || gemId === 'crane') {
      base.direction = rand() < 0.5 ? 1 : -1;
    }
    if (gemId === 'crane') {
      base.paper = { color: style.paper, print: style.print, pattern: style.pattern };
    }
    base.seed = seedFrom(rand);
    return base;
  }

  /* ---------------------------------------------------------------- weather */

  /* What is falling, from the WMO weather codes Open-Meteo reports for the
   * Philadelphia / Malvern area (one code per place). Snow anywhere wins over
   * rain anywhere. Returns { id: 'snow' | 'rain', heavy, thunder } or null. */
  var WEATHER_EVERY_MS = 3 * 60 * 60 * 1000;
  function kindOf(c) {
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { id: 'snow', heavy: c === 75 || c === 86, thunder: false };
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99)) {
      return { id: 'rain', heavy: c === 65 || c === 67 || c === 82 || c >= 95, thunder: c >= 95 };
    }
    return null;
  }
  function weatherKind(codes) {
    var list = Array.isArray(codes) ? codes : [codes];
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var c = Number(list[i]);
      if (!isFinite(c)) continue;
      var k = kindOf(c);
      if (!k) continue;
      if (!best || (k.id === 'snow' && best.id !== 'snow') || (k.id === best.id && (k.heavy && !best.heavy || k.thunder && !best.thunder))) best = k;
    }
    return best;
  }

  /* While the weather lasts, it shows at most once every three hours, and
   * never while the teacher has turned the surprises off. */
  function weatherDue(state, now, opts) {
    var o = opts || {};
    if (o.enabled === false || o.reducedMotion) return false;
    var ts = typeof now === 'number' ? now : Date.now();
    var last = state && typeof state.weatherShownAt === 'number' ? state.weatherShownAt : 0;
    return !last || ts - last >= WEATHER_EVERY_MS;
  }

  /* Check whether the shared cooldown window is currently clear (used both on
   * initial roll and immediately before playback after the settle delay). */
  function isCooldownClear(state, now, opts) {
    var o = opts || {};
    if (o.enabled === false) return false;
    if (o.reducedMotion) return false;
    var cooldownMs = typeof o.cooldownMs === 'number' ? o.cooldownMs : DEFAULT_COOLDOWN_MS;
    var ts = typeof now === 'number' ? now : Date.now();
    var last = state && typeof state.lastShownAt === 'number' ? state.lastShownAt : 0;
    if (last && ts - last < cooldownMs) return false;
    return true;
  }

  /* Decide whether an automatic surprise should trigger on this page visit. */
  function shouldTrigger(state, now, opts, rng) {
    if (!isCooldownClear(state, now, opts)) return false;
    var o = opts || {};
    var chance = typeof o.chance === 'number' ? o.chance : DEFAULT_CHANCE;
    var r = typeof rng === 'function' ? rng() : Math.random();
    return r < chance;
  }

  /* Extract course names/codes from course-switcher's chrome.storage.local
   * cache box only when origin, logged-in user id, and freshness all match. */
  var COURSE_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
  function extractCachedCourseNames(box, origin, uid, now, maxAgeMs) {
    if (!box || !origin || !uid) return [];
    if (box.origin !== origin || String(box.uid || '') !== String(uid)) return [];
    var ageLimit = typeof maxAgeMs === 'number' ? maxAgeMs : COURSE_CACHE_MAX_AGE_MS;
    var ts = typeof now === 'number' ? now : Date.now();
    if (typeof box.at !== 'number' || ts - box.at > ageLimit) return [];
    var list = Array.isArray(box.courses) ? box.courses : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c) continue;
      if (c.name) out.push(String(c.name));
      if (c.course_code) out.push(String(c.course_code));
    }
    return out;
  }

  /* Pick a gem id uniformly, avoiding any recently seen gems (up to 4) so
   * every sighting feels genuinely varied over weeks of teaching. Ids from an
   * older version of this module (still in a teacher's stored history) are
   * simply ignored. */
  function pickGem(recentOrLast, rng) {
    var recent = Array.isArray(recentOrLast)
      ? recentOrLast.slice(-4)
      : (recentOrLast ? [recentOrLast] : []);
    var pool = GEMS.filter(function (g) { return recent.indexOf(g) === -1; });
    if (!pool.length) {
      var last = recent[recent.length - 1];
      pool = GEMS.filter(function (g) { return g !== last; });
    }
    if (!pool.length) pool = GEMS.slice();
    return pick(pool, rng);
  }

  function nextDelayMs(rng) {
    var r = typeof rng === 'function' ? rng() : Math.random();
    return Math.round(MIN_DELAY_MS + Math.max(0, Math.min(1, r)) * (MAX_DELAY_MS - MIN_DELAY_MS));
  }

  CGP.hiddenGems = {
    GEMS: GEMS,
    SUBJECT_LABELS: SUBJECT_LABELS,
    SUBJECT_STYLE: SUBJECT_STYLE,
    DEFAULT_COOLDOWN_MS: DEFAULT_COOLDOWN_MS,
    DEFAULT_CHANCE: DEFAULT_CHANCE,
    matchSubject: matchSubject,
    detectSubject: detectSubject,
    extractCachedCourseNames: extractCachedCourseNames,
    contentFor: contentFor,
    isCooldownClear: isCooldownClear,
    shouldTrigger: shouldTrigger,
    pickGem: pickGem,
    WEATHER_EVERY_MS: WEATHER_EVERY_MS,
    weatherKind: weatherKind,
    weatherDue: weatherDue,
    nextDelayMs: nextDelayMs
  };
})();
