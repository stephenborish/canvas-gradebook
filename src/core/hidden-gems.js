/* Canvas Gradebook+ - Hidden Gems (pure logic, subject detection & content).
 *
 * Truly rare, unobtrusive miniature surprises in the margins of any Canvas
 * course page, quietly adapted to the subject the teacher teaches (from the
 * current course name or the teacher's cached course list, zero extra API
 * calls). Completely ephemeral — nothing is collected or saved into a UI.
 *
 * Pure JS: no DOM and no chrome.* access at load time, so Node unit tests
 * can load and exercise this module directly. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.hiddenGems) return;

  var GEMS = ['washer', 'boat', 'peel', 'harmonograph', 'prism', 'pencil'];

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

  /* Subtle time-of-day / season context (no sappy clichés). */
  function timeContext(now) {
    var d = now instanceof Date ? now : new Date(typeof now === 'number' ? now : Date.now());
    var h = d.getHours();
    var day = d.getDay();
    var m = d.getMonth();
    var moment = (h >= 22 || h < 4) ? 'night' : (day === 5 && h >= 13 ? 'friday' : 'day');
    var season = (m === 7 || m === 8) ? 'fall' : (m === 11 ? 'winter' : ((m === 4 || m === 5) ? 'finale' : null));
    return { moment: moment, season: season };
  }

  /* ------------------------------------------------- curiosities, riddles & quiet notes */

  var UNIVERSAL_BOAT_CARDS = [
    { id: 'u01', kind: 'fact', front: 'Honey sealed inside 3,000-year-old Egyptian jars is still completely edible.' },
    { id: 'u02', kind: 'fact', front: 'A single bolt of lightning reaches roughly 30,000 °C — five times hotter than the surface of the Sun.' },
    { id: 'u03', kind: 'fact', front: 'There are more possible legal chess games than atoms in the observable universe.' },
    { id: 'u04', kind: 'fact', front: 'Wombats are the only known animals that produce cube-shaped droppings — so they don’t roll off rocks.' },
    { id: 'u05', kind: 'riddle', front: 'The more of them you take, the more you leave behind. What are they?', back: 'Footsteps.' },
    { id: 'u06', kind: 'riddle', front: 'I have cities with no houses, rivers with no water, and forests with no trees. What am I?', back: 'A map.' },
    { id: 'u07', kind: 'riddle', front: 'What gets wetter the more it dries?', back: 'A towel.' },
    { id: 'u08', kind: 'riddle', front: 'A man pushes his car to a hotel and immediately realizes he is bankrupt. Why?', back: 'He is playing Monopoly.' },
    { id: 'u09', kind: 'note', front: 'Someone in your room this week felt braver asking a question because of the way you answered the last one.' },
    { id: 'u10', kind: 'note', front: 'You rarely get to see the moment a lesson actually lands — sometimes it happens five years after graduation.' },
    { id: 'u11', kind: 'note', front: 'Most of the quiet good you do in a school week never shows up in a gradebook. It still counts.' },
    { id: 'u12', kind: 'note', front: 'A student who almost gave up this month didn’t — mostly because your classroom felt like a safe place to try again.' }
  ];

  var MOMENT_CARDS = {
    night: [
      { id: 'nt01', kind: 'note', front: 'After 10 PM, even owls think you should close the laptop. The gradebook will not wander off overnight.' },
      { id: 'nt02', kind: 'fact', front: 'Fun fact: no student in recorded history has ever wished their teacher had slept less.' },
      { id: 'nt03', kind: 'note', front: 'You gave plenty to your students today. Leave the rest for morning light.' }
    ],
    friday: [
      { id: 'fr01', kind: 'fact', front: 'Friday afternoon physics: anything still ungraded at 3 PM acquires infinite inertia until Monday.' },
      { id: 'fr02', kind: 'note', front: 'Somewhere at a dinner table tonight, a kid is going to repeat something you said this week.' },
      { id: 'fr03', kind: 'note', front: 'Cleared for weekend departure. Whatever is left in this tab can learn to wait.' }
    ],
    fall: [
      { id: 'fa01', kind: 'fact', front: 'September paradox: the seating chart is brand new, and by Friday you will already know who sits in the back.' },
      { id: 'fa02', kind: 'note', front: 'New roster, new names — and sometime this month, someone quietly decides your room is their favorite hour of the day.' }
    ],
    winter: [
      { id: 'wi01', kind: 'fact', front: 'December thermodynamics: the last week before winter break moves at half the speed of ordinary time.' },
      { id: 'wi02', kind: 'note', front: 'Almost to break. Rest well when you get there — you earned every quiet morning.' }
    ],
    finale: [
      { id: 'fn01', kind: 'fact', front: 'Late-spring anomaly: every missing assignment from February suddenly becomes urgent in the same 48 hours.' },
      { id: 'fn02', kind: 'note', front: 'They will forget half the exam by July. They will not forget how you made them feel in your room.' }
    ]
  };

  var HARMONIC_RATIOS = [
    [2, 3, 1], [3, 4, 2], [3, 5, 1], [4, 5, 3],
    [2, 5, 3], [5, 6, 2], [3, 7, 2], [4, 7, 3],
    [5, 8, 3], [2, 3, 5], [3, 4, 5], [1, 3, 4]
  ];

  var PRISM_CRYSTALS = ['triangle', 'hex', 'diamond', 'lens', 'bevel'];
  var PRISM_CORNERS = ['top-right', 'top-left', 'bottom-right'];

  var SUBJECT_DATA = {
    chemistry: {
      watermark: 'H₂O',
      washerMark: 'benzene',
      peelScene: 'molecules',
      peelCaption: '6.022 × 10²³',
      inkPalette: ['#1c6b72', '#265c78', '#2a7b6f'],
      prismPalette: ['#4dd0e1', '#ffd54f', '#ff8a65', '#7e57c2'],
      prismAbsorption: true,
      pencilVariant: 'test-tube',
      boatCards: [
        { id: 'ch01', kind: 'fact', front: 'Gallium melts at 29.76 °C — a solid metal on your desk, a silver puddle in your palm.' },
        { id: 'ch02', kind: 'fact', front: 'J is the only letter in the English alphabet that never appears on the periodic table.' },
        { id: 'ch03', kind: 'riddle', front: 'I have a heart of gold, never rust, and sit quietly at atomic number 79. Who am I?', back: 'Au — Gold.' },
        { id: 'ch04', kind: 'fact', front: 'At its triple point (0.01 °C, 611.657 Pa), water boils and freezes at the exact same instant.' }
      ]
    },
    physics: {
      watermark: 'λ',
      washerMark: 'orbit',
      peelScene: 'cosmos',
      peelCaption: 'c = 299,792 km/s',
      inkPalette: ['#244c7a', '#394989', '#1e5b78'],
      prismPalette: ['#ff5252', '#ffca28', '#66bb6a', '#42a5f5', '#ab47bc'],
      prismAbsorption: true,
      pencilVariant: 'marble',
      boatCards: [
        { id: 'ph01', kind: 'fact', front: 'Sunlight takes 8 minutes to reach Earth — after spending roughly 100,000 years bouncing out of the Sun’s core.' },
        { id: 'ph02', kind: 'fact', front: 'GPS satellites have to adjust their clocks for both special and general relativity — or drift by ~11 km a day.' },
        { id: 'ph03', kind: 'riddle', front: 'I weigh nothing at all, outrun everything else, yet I can still push a solar sail. What am I?', back: 'A photon.' },
        { id: 'ph04', kind: 'fact', front: 'Glass is neither a true liquid nor a crystal — it is an amorphous solid frozen mid-disorder.' }
      ]
    },
    biology: {
      watermark: '🧬',
      washerMark: 'helix',
      peelScene: 'molecules',
      peelCaption: 'mycelium',
      inkPalette: ['#2c6b4f', '#3c6e47', '#1f6e68'],
      prismPalette: ['#81c784', '#aed581', '#4db6ac', '#fff176'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'bi01', kind: 'fact', front: 'A single teaspoon of healthy forest soil holds more living organisms than there are people on Earth.' },
        { id: 'bi02', kind: 'fact', front: 'Octopuses have three hearts, copper-based blue blood, and neurons distributed through every arm.' },
        { id: 'bi03', kind: 'riddle', front: 'I copy myself billions of times a day, use a four-letter alphabet, and coil into a staircase. What am I?', back: 'DNA.' },
        { id: 'bi04', kind: 'fact', front: 'Sharks have existed longer than trees — and longer than Saturn’s rings.' }
      ]
    },
    science: {
      watermark: '⚛',
      washerMark: 'orbit',
      peelScene: 'molecules',
      peelCaption: 'peer reviewed',
      inkPalette: ['#235a73', '#2b6d6b', '#3b577a'],
      prismPalette: ['#ff7043', '#ffd54f', '#4dd0e1', '#7986cb'],
      prismAbsorption: true,
      pencilVariant: 'marble',
      boatCards: [
        { id: 'sc01', kind: 'fact', front: 'Venus spins backward relative to most planets — so on Venus, the Sun rises in the west.' },
        { id: 'sc02', kind: 'fact', front: 'Hot water can occasionally freeze faster than cold water — a puzzle still studied as the Mpemba effect.' },
        { id: 'sc03', kind: 'riddle', front: 'You cannot see me, yet I hold every ocean in place and keep the Moon from wandering off. What am I?', back: 'Gravity.' }
      ]
    },
    calculus: {
      watermark: '∫',
      washerMark: 'integral',
      peelScene: 'blueprint',
      peelCaption: 'e^(iπ) + 1 = 0',
      inkPalette: ['#1c4575', '#2a528a', '#354b7a'],
      prismPalette: ['#64b5f6', '#4dd0e1', '#ffd54f', '#ba68c8'],
      prismAbsorption: false,
      pencilVariant: 'marble',
      boatCards: [
        { id: 'ca01', kind: 'fact', front: 'Gabriel’s Horn has finite volume but infinite surface area — you can fill it with paint, yet never finish painting it.' },
        { id: 'ca02', kind: 'fact', front: 'The Weierstrass function is continuous everywhere and differentiable nowhere — it broke 19th-century intuition.' },
        { id: 'ca03', kind: 'riddle', front: 'Differentiate me once, twice, or a thousand times, and I refuse to budge. Who am I?', back: 'eˣ (and 0).' },
        { id: 'ca04', kind: 'fact', front: 'Newton and Leibniz invented calculus independently — and we still write Leibniz’s ∫ and dy/dx every day.' }
      ]
    },
    math: {
      watermark: 'π',
      washerMark: 'pi',
      peelScene: 'blueprint',
      peelCaption: 'φ = 1.61803…',
      inkPalette: ['#1f4b7a', '#434c7d', '#245c70'],
      prismPalette: ['#4fc3f7', '#ffd54f', '#ff8a65', '#9575cd'],
      prismAbsorption: false,
      pencilVariant: 'marble',
      boatCards: [
        { id: 'ma01', kind: 'fact', front: 'In a room of just 23 people, there is better than a 50% chance two of them share a birthday.' },
        { id: 'ma02', kind: 'fact', front: 'Shuffle a 52-card deck well and you have almost certainly produced an order that has never existed before.' },
        { id: 'ma03', kind: 'riddle', front: 'I am an odd number. Take away one letter and I become even. What am I?', back: 'Seven.' },
        { id: 'ma04', kind: 'fact', front: 'Zero was regarded with suspicion in Europe for centuries before Fibonacci helped spread Hindu-Arabic numerals.' }
      ]
    },
    chinese: {
      watermark: '水',
      washerMark: 'hanzi',
      peelScene: 'inkwash',
      peelCaption: '静 · 思',
      inkPalette: ['#2c3033', '#3b332d', '#8c3329'],
      prismPalette: ['#e57373', '#ffd54f', '#80cbc4', '#90a4ae'],
      prismAbsorption: false,
      pencilVariant: 'brush',
      boatCards: [
        { id: 'zh01', kind: 'fact', front: '木是一棵树，林是树林，森是森林 — 汉字把整片风景藏在笔画里。' },
        { id: 'zh02', kind: 'riddle', front: '谜语：什么东西越洗越脏？', back: '水 (shuǐ) — Water.' },
        { id: 'zh03', kind: 'riddle', front: '字谜：一口咬掉牛尾巴。（打一字）', back: '告 (gào).' },
        { id: 'zh04', kind: 'fact', front: '“危机”由“危”与“机”组成 — 汉字的构造常常自带一点哲学幽默。' }
      ]
    },
    spanish: {
      watermark: 'ñ',
      washerMark: 'exclaim',
      peelScene: 'talavera',
      peelCaption: 'poco a poco',
      inkPalette: ['#1d4e7a', '#9c4328', '#235e6b'],
      prismPalette: ['#ff8a65', '#ffd54f', '#4fc3f7', '#f06292'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'es01', kind: 'fact', front: '«Ojalá» viene del árabe «law shāʾ Allāh»: ocho siglos de historia escondidos en un solo detonante del subjuntivo.' },
        { id: 'es02', kind: 'fact', front: 'La virgulilla de la «ñ» nació como abreviatura medieval para escribir «nn» sin gastar tanto pergamino.' },
        { id: 'es03', kind: 'riddle', front: 'Adivinanza: Blanca por dentro, verde por fuera. Si quieres que te lo diga, espera.', back: 'La pera (es-pera).' },
        { id: 'es04', kind: 'riddle', front: '¿Qué cosa es que cuanto más le quitas, más grande se vuelve?', back: 'Un agujero.' }
      ]
    },
    french: {
      watermark: 'ç',
      washerMark: 'smudge',
      peelScene: 'clockwork',
      peelCaption: 'tout doucement',
      inkPalette: ['#243f6b', '#6b3a4a', '#2c586b'],
      prismPalette: ['#64b5f6', '#ffd54f', '#f48fb1', '#80cbc4'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'fr10', kind: 'fact', front: '« Quatre-vingts » est un vestige du système vicésimal (base 20) hérité des Celtes et des Vikings.' },
        { id: 'fr11', kind: 'riddle', front: 'Devinette : Je commence la nuit et je finis le matin. Qui suis-je ?', back: 'La lettre N.' },
        { id: 'fr12', kind: 'fact', front: '« Oiseau » contient toutes les voyelles sauf le y — et aucune ne se prononce comme elle s’écrit.' }
      ]
    },
    german: {
      watermark: 'ß',
      washerMark: 'smudge',
      peelScene: 'clockwork',
      peelCaption: 'Fernweh',
      inkPalette: ['#2f3d4c', '#6e4a2d', '#3a4f41'],
      prismPalette: ['#ffd54f', '#ff8a65', '#64b5f6', '#a5d6a7'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'de01', kind: 'fact', front: 'Das „ß“ entstand aus der Ligatur von langem „ſ“ und „z“ — deshalb heißt es bis heute Eszett.' },
        { id: 'de02', kind: 'riddle', front: 'Rätsel: Was hat Zähne, kann aber nicht beißen?', back: 'Ein Kamm (oder eine Säge).' },
        { id: 'de03', kind: 'fact', front: '„Treppenwitz“ bezeichnet die geniale Antwort, die einem erst einfällt, wenn man schon auf der Treppe ist.' }
      ]
    },
    latin: {
      watermark: 'SPQR',
      washerMark: 'compass',
      peelScene: 'parchment',
      peelCaption: 'festina lente',
      inkPalette: ['#6b3629', '#4a3d2d', '#2f455c'],
      prismPalette: ['#ffcc80', '#e57373', '#90caf9', '#ffe082'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'la01', kind: 'fact', front: '“Salary” comes from Latin “salarium” — the allowance Roman soldiers received connected to salt.' },
        { id: 'la02', kind: 'fact', front: '“Festina lente” (make haste slowly) was Emperor Augustus’s favorite paradox — and a solid grading strategy.' },
        { id: 'la03', kind: 'riddle', front: 'Aenigma: Sine ore loquor, sine auribus audio, ventus me suscitat. Quid sum?', back: 'Echo.' }
      ]
    },
    theology: {
      watermark: 'ΑΩ',
      washerMark: 'alphaomega',
      peelScene: 'stainedglass',
      peelCaption: 'fides et ratio',
      inkPalette: ['#523c6e', '#7d5a2b', '#2c3d6b'],
      prismPalette: ['#ffd54f', '#e57373', '#64b5f6', '#ba68c8'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'th01', kind: 'fact', front: '“School” comes from the Greek “scholē” — which originally meant leisure: unhurried space to wonder.' },
        { id: 'th02', kind: 'fact', front: 'The oldest surviving intact European bound book is the St Cuthbert Gospel (~700 AD), still in its original red leather binding.' },
        { id: 'th03', kind: 'fact', front: '“Enthusiasm” traces back to Greek “entheos” — literally, inspired from within.' },
        { id: 'th04', kind: 'riddle', front: 'What can fill an entire cathedral without taking up a single inch of space?', back: 'Light.' }
      ]
    },
    history: {
      watermark: '🧭',
      washerMark: 'compass',
      peelScene: 'parchment',
      peelCaption: 'terra incognita',
      inkPalette: ['#5c4329', '#7a3b2e', '#3c4a57'],
      prismPalette: ['#ffcc80', '#ffe082', '#90caf9', '#bcaaa4'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'hi01', kind: 'fact', front: 'Oxford University was already teaching students more than 300 years before the Aztec Empire was founded.' },
        { id: 'hi02', kind: 'fact', front: 'Cleopatra lived closer in time to the iPhone than to the building of the Great Pyramid of Giza.' },
        { id: 'hi03', kind: 'fact', front: 'The oldest known customer complaint is a 3,750-year-old Babylonian clay tablet from Nanni to Ea-nāṣir about sub-par copper.' },
        { id: 'hi04', kind: 'riddle', front: 'I am always behind you, can never be altered, yet every generation keeps rewriting me. What am I?', back: 'History.' }
      ]
    },
    literature: {
      watermark: '¶',
      washerMark: 'smudge',
      peelScene: 'clockwork',
      peelCaption: 'ex libris',
      inkPalette: ['#3d352e', '#593a47', '#2f4959'],
      prismPalette: ['#ffab91', '#ffe082', '#80cbc4', '#b39ddb'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'li01', kind: 'fact', front: 'The dot over a lowercase “i” or “j” is called a tittle — from Latin “titulus”, a tiny inscription.' },
        { id: 'li02', kind: 'fact', front: 'The ampersand (&) is a stylized ligature of the Latin word “et” (and).' },
        { id: 'li03', kind: 'riddle', front: 'I have a spine and hundreds of leaves, yet I am neither animal nor tree. What am I?', back: 'A book.' },
        { id: 'li04', kind: 'fact', front: 'Mary Shelley began Frankenstein at age 18 during the dark, volcanic “Year Without a Summer” of 1816.' }
      ]
    },
    music: {
      watermark: '𝄞',
      washerMark: 'clef',
      peelScene: 'staff',
      peelCaption: 'pianissimo',
      inkPalette: ['#383254', '#6b4432', '#26495c'],
      prismPalette: ['#ffd54f', '#ff8a65', '#7986cb', '#4dd0e1'],
      prismAbsorption: false,
      pencilVariant: 'baton',
      boatCards: [
        { id: 'mu01', kind: 'fact', front: 'A concert grand piano’s strings pull on its cast-iron frame with roughly 20 tons of combined tension.' },
        { id: 'mu02', kind: 'fact', front: 'The oldest playable musical instruments ever found are bone flutes carved over 40,000 years ago.' },
        { id: 'mu03', kind: 'riddle', front: 'I have keys that open no locks and hammers that drive no nails. What am I?', back: 'A piano.' }
      ]
    },
    art: {
      watermark: '✦',
      washerMark: 'smudge',
      peelScene: 'cosmos',
      peelCaption: 'chiaroscuro',
      inkPalette: ['#275d8c', '#8c3b4a', '#2b6b5d'],
      prismPalette: ['#ff7043', '#ffca28', '#26c6da', '#ab47bc', '#66bb6a'],
      prismAbsorption: false,
      pencilVariant: 'colored-pencil',
      boatCards: [
        { id: 'ar01', kind: 'fact', front: 'Genuine ultramarine pigment was once more expensive than gold — ground from lapis lazuli mined in Afghanistan.' },
        { id: 'ar02', kind: 'fact', front: '“Sketch” comes from the Greek “schedios” — meaning done on the spur of the moment.' },
        { id: 'ar03', kind: 'riddle', front: 'I have a palette with no taste and a frame with no door. What am I?', back: 'A painting.' }
      ]
    },
    drama: {
      watermark: '🎭',
      washerMark: 'smudge',
      peelScene: 'cosmos',
      peelCaption: 'ghost light',
      inkPalette: ['#5e2a45', '#343a5e', '#78482c'],
      prismPalette: ['#ffca28', '#ff7043', '#ab47bc', '#4fc3f7'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'dr01', kind: 'fact', front: 'The single bare bulb left burning on an empty stage overnight is called a ghost light — part safety, part superstition.' },
        { id: 'dr02', kind: 'fact', front: '“Upstage” and “downstage” come from sloped (raked) stages where walking toward the audience literally meant walking downhill.' },
        { id: 'dr03', kind: 'riddle', front: 'What gets broken every time you wish someone luck on opening night?', back: 'A leg (figuratively).' }
      ]
    },
    cs: {
      watermark: '{}',
      washerMark: 'braces',
      peelScene: 'circuit',
      peelCaption: '0x2A',
      inkPalette: ['#1c6b5a', '#24527a', '#4a3d7a'],
      prismPalette: ['#4dd0e1', '#69f0ae', '#ffd54f', '#b388ff'],
      prismAbsorption: true,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'cs01', kind: 'fact', front: 'The first recorded computer “bug” was an actual moth taped into Grace Hopper’s Harvard Mark II logbook in 1947.' },
        { id: 'cs02', kind: 'fact', front: 'Ada Lovelace published the first machine algorithm in 1843 — a full century before electronic computers existed.' },
        { id: 'cs03', kind: 'riddle', front: 'Why do programmers sometimes confuse Halloween and Christmas?', back: 'Because Oct 31 == Dec 25.' }
      ]
    },
    economics: {
      watermark: '⚖',
      washerMark: 'compass',
      peelScene: 'blueprint',
      peelCaption: 'ceteris paribus',
      inkPalette: ['#245448', '#2a4566', '#614a29'],
      prismPalette: ['#81c784', '#ffd54f', '#64b5f6', '#ffab91'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'ec01', kind: 'fact', front: 'The island of Yap once used 4-ton carved limestone disks as currency — ownership changed hands even when the stone never moved.' },
        { id: 'ec02', kind: 'fact', front: 'During Dutch Tulip Mania in 1637, a single rare tulip bulb briefly traded for the price of a canal house in Amsterdam.' },
        { id: 'ec03', kind: 'riddle', front: 'What is the true cost of doing one thing instead of the best alternative?', back: 'Opportunity cost.' }
      ]
    },
    psychology: {
      watermark: 'Ψ',
      washerMark: 'smudge',
      peelScene: 'cosmos',
      peelCaption: 'perception',
      inkPalette: ['#453b6e', '#265c6b', '#6b3e52'],
      prismPalette: ['#b39ddb', '#4dd0e1', '#ffd54f', '#ff8a65'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'ps01', kind: 'fact', front: 'The Zeigarnik effect: human brains remember unfinished tasks far more vividly than completed ones.' },
        { id: 'ps02', kind: 'fact', front: 'Your brain edits out your own nose from your field of vision every waking second — until someone mentions it.' },
        { id: 'ps03', kind: 'riddle', front: 'I am always right in front of your face, yet your brain insists on pretending I am invisible. What am I?', back: 'Your nose.' }
      ]
    },
    pe: {
      watermark: '⏱',
      washerMark: 'orbit',
      peelScene: 'blueprint',
      peelCaption: 'in motion',
      inkPalette: ['#1f5e52', '#264d73', '#8c4a27'],
      prismPalette: ['#ff8a65', '#ffd54f', '#4db6ac', '#64b5f6'],
      prismAbsorption: false,
      pencilVariant: 'marble',
      boatCards: [
        { id: 'pe01', kind: 'fact', front: 'A marathon is 26.2 miles instead of 26 because the 1908 London Olympics added 385 yards so the finish sat right by the royal box.' },
        { id: 'pe02', kind: 'fact', front: 'Your heart beats roughly 100,000 times a day — pumping about 2,000 gallons of blood without taking a single break.' }
      ]
    },
    language: {
      watermark: '✦',
      washerMark: 'smudge',
      peelScene: 'talavera',
      peelCaption: 'lingua franca',
      inkPalette: ['#3b4d71', '#6e476b', '#2d5c6b'],
      prismPalette: ['#f48fb1', '#ffd54f', '#4dd0e1', '#9575cd'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: [
        { id: 'lg01', kind: 'fact', front: 'Over 7,000 living languages are spoken on Earth today — and more than half of the world is multilingual.' },
        { id: 'lg02', kind: 'fact', front: 'Japanese “tsundoku” names the universal habit of buying books and letting them pile up unread.' },
        { id: 'lg03', kind: 'riddle', front: 'I speak without a mouth and hear without ears, yet I come alive with wind. What am I?', back: 'An echo.' }
      ]
    },
    general: {
      watermark: '✦',
      washerMark: 'smudge',
      peelScene: 'clockwork',
      peelCaption: 'behind the curtain',
      inkPalette: ['#2b4c6b', '#4d3e5e', '#36594e'],
      prismPalette: ['#ff6e6e', '#ffd166', '#66d9a8', '#5dade2', '#b388eb'],
      prismAbsorption: false,
      pencilVariant: 'pencil',
      boatCards: UNIVERSAL_BOAT_CARDS
    }
  };

  function pick(arr, rng) {
    if (!arr || !arr.length) return null;
    var r = typeof rng === 'function' ? rng() : Math.random();
    var idx = Math.floor(Math.max(0, Math.min(0.999999, r)) * arr.length);
    return arr[idx];
  }

  function pickFresh(arr, recentIds, rng) {
    if (!arr || !arr.length) return null;
    var seen = Object.create(null);
    if (Array.isArray(recentIds)) {
      for (var i = 0; i < recentIds.length; i++) seen[recentIds[i]] = true;
    }
    var fresh = arr.filter(function (item) { return item && !seen[item.id]; });
    return pick(fresh.length ? fresh : arr, rng);
  }

  /* Return subject-tailored, per-iteration-varied props for a given gem. */
  function contentFor(gemId, subjectId, rng, opts) {
    var key = SUBJECT_DATA[subjectId] ? subjectId : 'general';
    var data = SUBJECT_DATA[key];
    var rand = typeof rng === 'function' ? rng : Math.random;
    var o = opts || {};
    var ctx = timeContext(o.now);

    if (gemId === 'boat') {
      var pool = UNIVERSAL_BOAT_CARDS;
      if (ctx.moment === 'night' && rand() < 0.35) {
        pool = MOMENT_CARDS.night;
      } else if (ctx.moment === 'friday' && rand() < 0.35) {
        pool = MOMENT_CARDS.friday;
      } else if (ctx.season && MOMENT_CARDS[ctx.season] && rand() < 0.2) {
        pool = MOMENT_CARDS[ctx.season];
      } else if (key !== 'general' && data.boatCards && data.boatCards.length && rand() < 0.72) {
        pool = data.boatCards;
      }
      var card = pickFresh(pool, o.recentCards, rand);
      var paperTints = ['#fbf7ee', '#f4f7fa', '#f9f3e6'];
      return {
        subjectId: key,
        subjectLabel: SUBJECT_LABELS[key] || 'General',
        watermark: data.watermark || '✦',
        direction: rand() < 0.5 ? 1 : -1,
        paperTint: pick(paperTints, rand),
        card: card
      };
    }
    if (gemId === 'washer') {
      var capColors = ['#c94a38', '#2e6b9e', '#3c7a57', '#b87d28'];
      return {
        subjectId: key,
        mark: data.washerMark || 'smudge',
        side: rand() < 0.7 ? 'right' : 'left',
        topPct: Math.round(24 + rand() * 28),
        capColor: pick(capColors, rand)
      };
    }
    if (gemId === 'peel') {
      var scene = (ctx.moment === 'night' && rand() < 0.45) ? 'cosmos' : (data.peelScene || 'clockwork');
      return {
        subjectId: key,
        scene: scene,
        caption: data.peelCaption || 'behind the curtain',
        corner: rand() < 0.7 ? 'bottom-right' : 'bottom-left'
      };
    }
    if (gemId === 'harmonograph') {
      var ratio = pick(HARMONIC_RATIOS, rand);
      var f1 = ratio[0] + (rand() - 0.5) * 0.04;
      var f2 = ratio[1] + (rand() - 0.5) * 0.04;
      var f3 = ratio[2] + (rand() - 0.5) * 0.03;
      return {
        subjectId: key,
        f1: Number(f1.toFixed(3)),
        f2: Number(f2.toFixed(3)),
        f3: Number(f3.toFixed(3)),
        p1: Number((rand() * Math.PI * 2).toFixed(3)),
        p2: Number((rand() * Math.PI * 2).toFixed(3)),
        p3: Number((rand() * Math.PI * 2).toFixed(3)),
        damping: Number((0.008 + rand() * 0.009).toFixed(4)),
        ink: pick(data.inkPalette || SUBJECT_DATA.general.inkPalette, rand),
        corner: rand() < 0.5 ? 'bottom-right' : 'bottom-left'
      };
    }
    if (gemId === 'prism') {
      return {
        subjectId: key,
        crystal: pick(PRISM_CRYSTALS, rand),
        corner: pick(PRISM_CORNERS, rand),
        palette: (data.prismPalette || SUBJECT_DATA.general.prismPalette).slice(),
        absorption: !!data.prismAbsorption,
        spreadDeg: Math.round(24 + rand() * 20),
        baseAngle: Math.round(-12 + rand() * 24)
      };
    }
    if (gemId === 'pencil') {
      return {
        subjectId: key,
        variant: data.pencilVariant || 'pencil',
        direction: rand() < 0.5 ? 1 : -1
      };
    }
    return { subjectId: key };
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
   * every sighting feels genuinely varied over weeks of teaching. */
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
    DEFAULT_COOLDOWN_MS: DEFAULT_COOLDOWN_MS,
    DEFAULT_CHANCE: DEFAULT_CHANCE,
    matchSubject: matchSubject,
    detectSubject: detectSubject,
    extractCachedCourseNames: extractCachedCourseNames,
    timeContext: timeContext,
    contentFor: contentFor,
    isCooldownClear: isCooldownClear,
    shouldTrigger: shouldTrigger,
    pickGem: pickGem,
    nextDelayMs: nextDelayMs
  };
})();
