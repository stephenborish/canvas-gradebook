/* "Find my calendar link for me" (options/calendar-finder.js): which of the
 * links read off Google Calendar's settings is tried first, the Chrome
 * question asked from the click, the teacher's other Google accounts, and
 * what the teacher is told when nothing is found. findInPage itself runs
 * in Google's page and is checked in a real browser, not here. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, assert: a } = require('./harness');

const CGP = globalThis.CGP;
const ROOT = path.resolve(__dirname, '..');

function F() {
  if (!CGP.calendarFinder) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/options/calendar-finder.js'), 'utf8'), { filename: 'options/calendar-finder.js' });
  return CGP.calendarFinder;
}

const VERACROSS = 'webcal://api.veracross.com/malvernprep/subscribe/F0E9F452-93EB-4B3C-AFE5-E5370F71AAAA.ics?uid=123';
const ID = 'vvtdpd9d83opc17jl9o57pcmkitoetfv@import.calendar.google.com';
const PUBLIC = 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(ID) + '/public/basic.ics';

/* A pretend browser: tabs that land on `pages[account]` ('calendar' or
 * 'signin'), and the in-page finder's answer for each account. */
function world(o) {
  const w = { asked: [], opened: [], navigated: [], ran: [], progress: [] };
  const urlFor = (acct) => o.pages && o.pages[acct] === 'signin' ? undefined
    : o.pages && o.pages[acct] === 'gone' ? 'https://calendar.google.com/calendar/u/0/r/settings'
      : 'https://calendar.google.com/calendar/u/' + acct + '/r/settings';
  let current = 0;
  w.finder = F().create({
    request: (origins) => { w.asked.push(origins); return Promise.resolve(o.grant !== false); },
    openTab: (url) => { w.opened.push(url); current = 0; return Promise.resolve({ id: 7 }); },
    navigate: (id, url) => { w.navigated.push(url); current = Number(/\/u\/(\d+)\//.exec(url)[1]); return Promise.resolve(); },
    waitLoaded: () => Promise.resolve({ id: 7, url: urlFor(current) }),
    run: (id, opts) => { w.ran.push({ acct: current, opts }); return Promise.resolve((o.answers || {})[current] || { status: 'notfound', calendars: [] }); },
    onProgress: (t) => w.progress.push(t)
  });
  return w;
}

suite('Find my calendar link', (test) => {
  test('the school’s own subscription link is tried first, then the secret, then the public address', () => {
    const links = F().rank({ links: { source: VERACROSS, secret: '', publicIcal: PUBLIC }, calendarId: ID });
    a.deep(links, [VERACROSS.replace('webcal://', 'https://'), PUBLIC], 'no repeats; webcal read over https');
    const secret = 'https://calendar.google.com/calendar/ical/me%40x.org/private-abc/basic.ics';
    a.deep(F().rank({ links: { source: '', secret: secret, publicIcal: '' } }), [secret]);
    a.deep(F().rank({ links: {}, calendarId: ID }), [PUBLIC], 'the calendar’s id alone gives its public address');
    a.deep(F().rank({ status: 'notfound' }), []);
    a.deep(F().rank({ links: { source: 'not a link' } }), []);
  });

  test('one Chrome question, from the click, covers Google Calendar and the school’s feed', async () => {
    const w = world({ answers: { 0: { status: 'found', name: 'All Classes', links: { source: VERACROSS } } } });
    const p = w.finder.find({ mode: 'find' });
    a.eq(w.asked.length, 1, 'asked before anything waits');
    a.ok(w.asked[0].indexOf('https://calendar.google.com/*') >= 0);
    a.ok(w.asked[0].indexOf('https://api.veracross.com/*') >= 0);
    const r = await p;
    a.eq(r.status, 'found');
    a.eq(r.tabId, 7);
    a.deep(w.opened, ['https://calendar.google.com/calendar/u/0/r/settings']);
    a.deep(w.ran[0].opts.names, ['All Classes']);
    a.eq(w.navigated.length, 0);
  });

  test('a refused question opens nothing', async () => {
    const w = world({ grant: false });
    const r = await w.finder.find({});
    a.eq(r.status, 'denied');
    a.eq(w.opened.length, 0);
    a.ok(/Allow/.test(F().explain(r)));
  });

  test('the school account second in Chrome is found too', async () => {
    const w = world({ answers: { 1: { status: 'found', name: 'All Classes', links: { source: VERACROSS } } } });
    const r = await w.finder.find({});
    a.eq(r.status, 'found');
    a.deep(w.navigated, ['https://calendar.google.com/calendar/u/1/r/settings']);
  });

  test('stops at the last signed-in account and says what it saw', async () => {
    const w = world({ pages: { 2: 'gone' }, answers: { 0: { status: 'notfound', calendars: ['Stephen Borish', 'Holidays'] } } });
    const r = await w.finder.find({});
    a.eq(r.status, 'notfound');
    a.eq(w.ran.length, 2, 'accounts 0 and 1 searched; 2 does not exist');
    a.deep(r.calendars, ['Stephen Borish', 'Holidays'], 'the first account’s answer');
    const msg = F().explain(r);
    a.ok(/All Classes/.test(msg) && /school Google account/.test(msg) && /Holidays/.test(msg), msg);
  });

  test('a sign-in page is reported, not searched', async () => {
    const w = world({ pages: { 0: 'signin' } });
    const r = await w.finder.find({});
    a.eq(r.status, 'signin');
    a.eq(w.ran.length, 0);
    a.ok(/Sign in/.test(F().explain(r)));
  });

  test('a second click while it runs gets the same answer', async () => {
    const w = world({ answers: { 0: { status: 'found', links: { source: VERACROSS } } } });
    const p1 = w.finder.find({});
    const p2 = w.finder.find({});
    a.eq(p1, p2);
    await p1;
    a.eq(w.asked.length, 1);
  });

  test('a page that throws comes back as an error, never stuck', async () => {
    const f = F().create({
      request: () => Promise.resolve(true),
      openTab: () => Promise.reject(new Error('No tab')),
      navigate: () => Promise.resolve(), waitLoaded: () => Promise.resolve({}), run: () => Promise.resolve(null)
    });
    const r = await f.find({});
    a.eq(r.status, 'error');
    a.eq(f.inflight, null);
  });
});
