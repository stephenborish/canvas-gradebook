/* Canvas Gradebook+ - "Find my calendar link for me" (options page, Class
 * Schedule).
 *
 * Teachers' class periods live in a calendar their school puts in their
 * Google Calendar under "Settings for other calendars" (at Malvern Prep it
 * is called "All Classes", a Veracross subscription). Copying its link by
 * hand means four screens of Google settings; this does it for them:
 *
 *   1. one Chrome question, from the click: may Gradebook+ read
 *      calendar.google.com (and the school's calendar feed site, so the link
 *      found can be read without a second question);
 *   2. Google Calendar's settings open in a new tab; findInPage() (run in
 *      that tab) clicks the class calendar in the left column, scrolls to
 *      and highlights its link, and reads it from the page;
 *   3. the links found are ranked (rank()): the school's own subscription
 *      link first (Google's copy of it can be up to a day behind), then the
 *      calendar's secret, then its public iCal address;
 *   4. the options page connects the first one that reads (the usual
 *      Connect calendar steps), comes back to the front and closes the tab.
 *
 * If the teacher's school account is not the first one signed in to Chrome
 * the next ones (/u/1/, /u/2/ ...) are tried in the same tab.
 *
 * Nothing here is saved, and a calendar connected before stays connected
 * until a new one has been read: the found link goes through the same
 * connect() as a pasted one. The links are never logged.
 *
 * deps (create): {
 *   request(origins) -> Promise<bool>        chrome.permissions.request
 *   openTab(url)     -> Promise<{id, url}>   a new tab, once it has loaded
 *   navigate(tabId, url) -> Promise<{id, url}>  the same, for another address
 *                                            (url undefined when not readable)
 *   run(tabId, opts) -> Promise<result>       findInPage in that tab
 *   onProgress(text)                          optional
 * } */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.calendarFinder) return;

  // The calendar(s) that hold a teacher's class periods, by the name shown
  // in Google Calendar. Matched ignoring case and spacing.
  var CALENDAR_NAMES = ['All Classes'];
  var GOOGLE_ORIGIN = 'https://calendar.google.com/*';
  // Sites schools' subscription links live on, asked for in the same Chrome
  // question so the link found can be read straight away.
  var FEED_ORIGINS = ['https://api.veracross.com/*'];
  var MAX_ACCOUNTS = 4;

  function settingsUrl(account) {
    return 'https://calendar.google.com/calendar/u/' + account + '/r/settings';
  }

  /* ------------------------------------------------- in the Calendar tab */

  /* Runs inside calendar.google.com (chrome.scripting.executeScript), so it
   * must not use anything from outside its own body. Google's page has no
   * stable ids or classes, so everything is found by the words shown.
   *
   * opts: {names: [..], mode: 'find' | 'show', timeoutMs}
   * -> {status: 'found' | 'notfound' | 'nolink' | 'notsettings' | 'timeout',
   *     name, account, calendarId, links: {source, secret, publicIcal},
   *     calendars: [names seen in the left column]} */
  function findInPage(opts) {
    opts = opts || {};
    var names = (opts.names || []).map(norm);
    var timeoutMs = opts.timeoutMs || 20000;
    var started = Date.now();
    var URL_RE = /(?:webcals?|https?):\/\/[^\s"'<>]+/gi;

    function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function left() { return timeoutMs - (Date.now() - started); }
    function account() {
      var m = /\/calendar\/u\/(\d+)\//.exec(location.pathname);
      return m ? Number(m[1]) : 0;
    }
    function visible(el) {
      if (!el || !el.getClientRects || !el.getClientRects().length) return false;
      var st = getComputedStyle(el);
      return st.visibility !== 'hidden' && st.display !== 'none';
    }
    /* Elements whose own words are exactly `text`. */
    function byText(text, root) {
      var want = norm(text);
      var out = [];
      // Text nodes, not every element's whole textContent: Google's page is
      // large and this runs several times a second.
      var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        if (norm(node.nodeValue) !== want) continue;
        var el = node.parentElement;
        if (el && out.indexOf(el) < 0 && norm(el.textContent) === want && visible(el)) out.push(el);
      }
      return out;
    }
    function heading(text) { return byText(text)[0] || null; }
    function after(a, b) { return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); }
    function clickable(el) {
      return el.closest('a[href], [role="link"], [role="button"], [role="treeitem"], [role="menuitem"], [role="option"], [tabindex], [jsaction*="click"]') || el;
    }
    function calendarIdFromPath() {
      var m = /\/settings\/calendar\/([^/?#]+)/.exec(location.pathname);
      if (!m) return '';
      try {
        var b = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
        while (b.length % 4) b += '=';
        var id = atob(b);
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id) ? id : '';
      } catch (e) { return ''; }
    }
    /* The side column's calendars: every link to one calendar's settings. */
    function calendarsSeen() {
      var seen = [];
      var links = document.querySelectorAll('a[href*="/settings/calendar/"], [data-href*="/settings/calendar/"]');
      for (var i = 0; i < links.length; i++) {
        var t = String(links[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (t && seen.indexOf(t) < 0 && t.length < 80) seen.push(t);
      }
      return seen;
    }
    /* The class calendar's entry in the side column, preferring the one
     * under "Settings for other calendars" (a school's subscription). */
    function findEntry() {
      var other = heading('Settings for other calendars');
      var best = null;
      for (var n = 0; n < names.length && !best; n++) {
        var hits = byText(names[n]);
        var below = hits.filter(function (el) { return after(other, el); });
        best = below[0] || hits[0] || null;
      }
      return best;
    }

    /* Every web address shown on the page (text and boxes), by kind. */
    function readLinks() {
      var found = { source: '', sourceEl: null, secret: '', secretEl: null, publicIcal: '', publicEl: null, calId: '' };
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var items = [];
      var node;
      while ((node = walker.nextNode())) {
        if (node.parentElement && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.parentElement.tagName)) continue;
        items.push({ text: node.nodeValue, el: node.parentElement });
      }
      var boxes = document.querySelectorAll('input, textarea');
      for (var b = 0; b < boxes.length; b++) if (boxes[b].value) items.push({ text: boxes[b].value, el: boxes[b] });
      // "URL" is the label Google puts over a subscribed calendar's address.
      var urlLabels = byText('URL');
      items.forEach(function (it) {
        var m;
        URL_RE.lastIndex = 0;
        while ((m = URL_RE.exec(it.text))) {
          var u = m[0].replace(/[).,;]+$/, '');
          if (/(…|\.\.\.)$/.test(u)) continue;            // cut short on screen
          var host = '';
          try { host = new URL(u.replace(/^webcals?:/i, 'https:')).hostname.toLowerCase(); } catch (e) { continue; }
          if (host === 'calendar.google.com' || host === 'www.google.com') {
            if (/\/calendar\/ical\/[^/]+\/private-[^/]+\//i.test(u)) {
              if (!found.secret) { found.secret = u; found.secretEl = it.el; }
            } else if (/\/calendar\/ical\/[^/]+\/public\//i.test(u)) {
              if (!found.publicIcal) { found.publicIcal = u; found.publicEl = it.el; }
            }
            continue;
          }
          if (/(^|\.)google(usercontent)?\.com$|(^|\.)gstatic\.com$/.test(host)) continue;
          if (it.el && it.el.closest && it.el.closest('iframe, code')) continue;
          // The one under the "URL" label wins; else a webcal:// or .ics link.
          var labelled = urlLabels.some(function (l) {
            var box = l.parentElement;
            for (var up = 0; up < 3 && box; up++, box = box.parentElement) if (box.contains(it.el)) return true;
            return false;
          });
          var score = (labelled ? 4 : 0) + (/^webcals?:/i.test(u) ? 2 : 0) + (/\.ics(\?|$)|subscribe|ical|calendar/i.test(u) ? 1 : 0);
          // Any other link (one in the calendar's description, say) is not it.
          if (!score) continue;
          if (!found.source || score > found.score) { found.source = u; found.sourceEl = it.el; found.score = score; }
        }
      });
      // A Google calendar's id ("...@import.calendar.google.com").
      var idRe = /\b[a-z0-9._%+-]+@(?:import\.|group\.)?calendar\.google\.com\b/i;
      for (var i = 0; i < items.length && !found.calId; i++) {
        var im = idRe.exec(items[i].text);
        if (im) found.calId = im[0];
      }
      return found;
    }

    var banner = null;
    function say(text, ok) {
      if (opts.quiet) return;
      if (!banner) {
        banner = document.createElement('div');
        banner.setAttribute('role', 'status');
        banner.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:14px;transform:translateX(-50%);max-width:560px;' +
          'padding:12px 18px;border-radius:12px;font:600 14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
          'box-shadow:0 8px 28px rgba(0,0,0,.22);color:#fff;background:#0374b5;text-align:center';
        document.body.appendChild(banner);
      }
      banner.style.background = ok === false ? '#b91c1c' : ok ? '#0b7a45' : '#0374b5';
      banner.textContent = 'Canvas Gradebook+: ' + text;
    }
    function highlight(el) {
      if (!el) return;
      var box = el;
      // The whole field, not just the words in it.
      for (var up = 0; up < 2 && box.parentElement && box.parentElement.textContent.length < 400; up++) box = box.parentElement;
      try { box.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { box.scrollIntoView(); }
      box.style.outline = '3px solid #0b7a45';
      box.style.outlineOffset = '3px';
      box.style.borderRadius = '6px';
      box.style.background = 'rgba(11, 122, 69, 0.08)';
      // Selected, so Ctrl/Cmd+C copies it.
      try {
        if (el.select) el.select();
        else { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      } catch (e) { /* ignore */ }
    }
    function result(status, extra) {
      return Object.assign({ status: status, account: account(), calendars: calendarsSeen() }, extra || {});
    }

    return (async function () {
      if (!/^\/calendar\//.test(location.pathname)) return result('notsettings');
      say('looking for your “' + (opts.names || [])[0] + '” calendar…');
      // Google's settings draw a moment after the page loads.
      var entry = null;
      while (left() > 0) {
        entry = findEntry();
        if (entry || (heading('Settings for other calendars') && Date.now() - started > 4000)) break;
        await sleep(250);
      }
      if (!entry) {
        var why = heading('Settings for my calendars') || heading('Settings for other calendars') ? 'notfound' : 'timeout';
        say(why === 'notfound'
          ? 'no calendar called “' + (opts.names || [])[0] + '” in this Google account.'
          : 'Google Calendar’s settings didn’t open.', false);
        return result(why);
      }
      var name = String(entry.textContent || '').replace(/\s+/g, ' ').trim();
      var before = location.pathname;
      clickable(entry).click();
      // The calendar's settings open in place (the address changes).
      var links = null;
      var clickedAt = Date.now();
      var nudged = false;
      var idSeenAt = 0;
      while (left() > 0) {
        await sleep(300);
        if (location.pathname === before && !/\/settings\/calendar\//.test(before)) {
          // Only opened up in the side column: its first item is
          // "Calendar settings".
          if (!nudged && Date.now() - clickedAt > 1500) {
            nudged = true;
            var sub = byText('Calendar settings').filter(function (el) { return after(entry, el); })[0];
            if (sub) clickable(sub).click();
          }
          continue;
        }
        links = readLinks();
        var anyLink = links.source || links.secret || links.publicIcal;
        // Only the calendar's id so far: the URL box may still be coming.
        if (!anyLink && links.calId && !idSeenAt) idSeenAt = Date.now();
        if (anyLink || (idSeenAt && Date.now() - idSeenAt > 3000)) {
          // Give the rest of the page a moment to fill in.
          await sleep(500);
          links = readLinks();
          break;
        }
      }
      var calId = calendarIdFromPath() || (links && links.calId) || '';
      if (!links || !(links.source || links.secret || links.publicIcal)) {
        say('found “' + name + '”, but no calendar link on its settings page.', false);
        return result('nolink', { name: name, calendarId: calId, links: { source: '', secret: '', publicIcal: '' } });
      }
      // The best link shown: the school's own, else Google's iCal address.
      highlight(links.sourceEl || links.secretEl || links.publicEl);
      say(opts.mode === 'show'
        ? 'this is your “' + name + '” link. It’s selected: copy it (Ctrl+C or ⌘C) and paste it in Gradebook+.'
        : 'found your “' + name + '” link. Connecting it in Gradebook+…', true);
      return result('found', { name: name, calendarId: calId, links: { source: links.source, secret: links.secret, publicIcal: links.publicIcal } });
    })().catch(function (e) {
      return result('error', { error: String((e && e.message) || e) });
    });
  }

  /* ------------------------------------------------------- the options page */

  /** The links worth trying, best first, as feed addresses (no repeats). */
  function rank(res) {
    var C = CGP.courseCalendar;
    var l = (res && res.links) || {};
    var out = [];
    var publicFromId = res && res.calendarId ? C.normalizeUrl(res.calendarId) : null;
    [l.source, l.secret, l.publicIcal, publicFromId].forEach(function (raw) {
      var u = raw ? C.normalizeUrl(raw) : null;
      if (u && out.indexOf(u) < 0) out.push(u);
    });
    return out;
  }

  function origins() { return [GOOGLE_ORIGIN].concat(FEED_ORIGINS); }

  function create(deps) {
    var progress = deps.onProgress || function () {};
    var self = { inflight: null, tabId: null, find: find };
    var opened = null;   // the tab as it first loaded

    /* Must be called from the click: Chrome's question comes first.
     * opts.mode: 'find' (connect it) or 'show' (leave the tab open on it). */
    function find(opts) {
      opts = opts || {};
      if (self.inflight) return self.inflight;
      self.tabId = null;
      var asked;
      try { asked = Promise.resolve(deps.request(origins())); } catch (e) { asked = Promise.reject(e); }
      var p = asked.then(function (granted) {
        if (!granted) return { status: 'denied' };
        progress('Opening Google Calendar…');
        return deps.openTab(settingsUrl(0)).then(function (tab) {
          self.tabId = tab.id;
          opened = tab;
          return search(tab.id, 0, opts, null);
        });
      }, function () { return { status: 'denied' }; });
      self.inflight = p.then(function (r) { self.inflight = null; return r; }, function (e) {
        self.inflight = null;
        return { status: 'error', error: String((e && e.message) || e), tabId: self.tabId };
      });
      return self.inflight;
    }

    function search(tabId, acct, opts, first) {
      var nav = acct === 0 ? Promise.resolve(opened) : deps.navigate(tabId, settingsUrl(acct));
      return nav.then(function (tab) {
        var url = String((tab && tab.url) || '');
        // Not on Google Calendar: a sign-in page, or no such account.
        if (!/^https:\/\/calendar\.google\.com\/calendar\//.test(url)) {
          return first || { status: acct === 0 ? 'signin' : 'notfound', tabId: tabId };
        }
        var m = /\/calendar\/u\/(\d+)\//.exec(url);
        if (acct > 0 && (!m || Number(m[1]) !== acct)) return first || { status: 'notfound', tabId: tabId };
        progress(acct === 0 ? 'Looking for your “' + CALENDAR_NAMES[0] + '” calendar…'
          : 'Looking in your other Google account (' + (acct + 1) + ')…');
        return deps.run(tabId, { names: CALENDAR_NAMES, mode: opts.mode || 'find', timeoutMs: 20000 }).then(function (res) {
          res = Object.assign({}, res || { status: 'error' }, { tabId: tabId });
          if (res.status === 'found' || res.status === 'nolink') return res;
          if (res.status === 'notfound' && acct + 1 < MAX_ACCOUNTS) return search(tabId, acct + 1, opts, first || res);
          return first || res;
        });
      });
    }

    return self;
  }

  /* What to tell the teacher when no link was found. */
  function explain(res) {
    var name = '“' + CALENDAR_NAMES[0] + '”';
    var s = res && res.status;
    if (s === 'denied') return 'Chrome didn’t allow Gradebook+ to open your Google Calendar settings. Click the button again and choose Allow – or paste your link yourself.';
    if (s === 'signin') return 'Sign in to your school Google account in the Google Calendar tab that just opened, then click Find my calendar link again.';
    if (s === 'notfound') {
      var seen = res.calendars && res.calendars.length ? ' The calendars Google showed: ' + res.calendars.slice(0, 8).join(', ') + '.' : '';
      return 'Couldn’t find a calendar called ' + name + ' in your Google Calendar. Make sure you’re signed in to your school Google account ' +
        'and that ' + name + ' is listed under “Other calendars”. If your classes are in a calendar with another name, follow ' +
        '“Where do I find my link?” below.' + seen;
    }
    if (s === 'nolink') return 'Found ' + name + ', but Google showed no link for it. Follow “Where do I find my link?” below, or ask your school for its calendar subscription link.';
    if (s === 'timeout' || s === 'notsettings') return 'Google Calendar took too long to open its settings. Check the Google Calendar tab, then click Find my calendar link again.';
    return 'Something went wrong finding your link' + (res && res.error ? ' (' + res.error + ')' : '') + '. Try again, or paste your link yourself.';
  }

  CGP.calendarFinder = {
    create: create, findInPage: findInPage, rank: rank, explain: explain, origins: origins,
    settingsUrl: settingsUrl, CALENDAR_NAMES: CALENDAR_NAMES
  };
})();
