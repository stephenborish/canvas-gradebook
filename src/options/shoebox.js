/* Canvas Gradebook+ - the Shoebox: the notes caught from paper airplanes.
 *
 * A tab on the options page that is not there until the first note has been
 * caught (see gems/airmail-state.js). #shoebox in the address opens it, and
 * shows it even while it is still empty. Every note caught is here, newest
 * first, with the day it arrived; so is a count of the ones that got away,
 * and the one switch: whether planes fly at all. */
(function () {
  'use strict';
  var CGP = globalThis.CGP;
  if (!CGP || !CGP.AirmailState) return;

  var state = new CGP.AirmailState();
  var wantedNow = /^#shoebox$/.test(location.hash || '');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  var PLANE_ICON = '<svg class="tab__icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 9.2 17.5 3l-4.2 14-3.6-5.3z"/><path d="M17.5 3 9.7 11.7v4.1l2-2.4"/></svg>';

  function byId(id) {
    var list = CGP.AIRMAIL_NOTES || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function dateLabel(at) {
    try { return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return ''; }
  }

  function build(rec) {
    var nav = document.querySelector('.tabs');
    var inner = document.querySelector('.content__inner');
    if (!nav || !inner || document.getElementById('tab-shoebox')) return;

    var tab = el('button', 'tab tab--shoebox');
    tab.type = 'button';
    tab.id = 'tab-shoebox';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'panel-shoebox');
    tab.dataset.tab = 'shoebox';
    tab.tabIndex = -1;
    tab.innerHTML = PLANE_ICON;
    tab.appendChild(el('span', 'tab__label', 'Shoebox'));
    nav.appendChild(tab);

    var panel = el('section', 'panel shoebox');
    panel.id = 'panel-shoebox';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'tab-shoebox');
    panel.dataset.panel = 'shoebox';
    panel.hidden = true;
    inner.appendChild(panel);
    render(panel, rec);

    if (CGP.optionsWireTab) CGP.optionsWireTab(tab);
    if (wantedNow && CGP.optionsShowTab) CGP.optionsShowTab('shoebox', { silent: true });
  }

  function render(panel, rec) {
    panel.textContent = '';
    var head = el('header', 'panel__head');
    head.appendChild(el('h1', '', 'The Shoebox'));
    head.appendChild(el('p', '', 'Every teacher keeps one. These are the notes you caught from paper airplanes that drifted across your gradebook.'));
    panel.appendChild(head);

    var caught = (Array.isArray(rec.caught) ? rec.caught : []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    var missed = Number(rec.missed) || 0;

    var stats = el('p', 'shoebox__stats');
    stats.textContent = caught.length + (caught.length === 1 ? ' note' : ' notes') + ' caught' +
      (missed ? ' · ' + missed + ' got away' : '');
    panel.appendChild(stats);

    if (!caught.length) {
      panel.appendChild(el('p', 'shoebox__empty', 'Nothing here yet. Keep an eye on the sky — they don’t come often, and they don’t wait long.'));
    } else {
      var grid = el('ul', 'shoebox__grid');
      caught.forEach(function (c, i) {
        var n = byId(c.id);
        if (!n) return;
        var li = el('li', 'shoebox__note' + (n.pile === 'golden' ? ' is-gold' : n.pile === 'night' ? ' is-night' : ''));
        var meta = el('p', 'shoebox__meta');
        var subj = CGP.AirmailState.subjectLabel(n.pile);
        meta.appendChild(el('span', '', n.pile === 'golden' ? 'A rare one' : subj || (n.pile === 'night' ? 'Late delivery' : 'Par avion')));
        meta.appendChild(el('span', '', dateLabel(c.at)));
        li.appendChild(meta);
        li.appendChild(el('p', 'shoebox__text', n.text));
        li.appendChild(el('p', 'shoebox__from', '\u2014 ' + n.from));
        grid.appendChild(li);
      });
      panel.appendChild(grid);
    }

    panel.appendChild(el('h2', 'panel__group', 'Paper airplanes'));
    var row = el('div', 'setting');
    var label = el('label', 'setting__label');
    label.setAttribute('for', 'airmailOn');
    label.textContent = 'Let paper airplanes fly now and then';
    var sw = el('input', 'switch');
    sw.type = 'checkbox';
    sw.id = 'airmailOn';
    sw.checked = rec.off !== true;
    sw.addEventListener('change', function () { state.setOff(!sw.checked); });
    row.appendChild(label);
    row.appendChild(sw);
    panel.appendChild(row);
    panel.appendChild(el('p', 'hint', 'Never more than one a day. Saved on this computer only.'));
  }

  state.read().then(function (rec) {
    var has = Array.isArray(rec.caught) && rec.caught.length > 0;
    if (has || wantedNow) build(rec);
  });
})();
