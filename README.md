# Canvas Gradebook+

A Chrome extension (Manifest V3) that fixes the Canvas instructor Gradebook **in place**.
There is no second gradebook, no dashboard, no side panel, no floating toolbar. You open
Canvas, and the gradebook simply behaves the way it should have in the first place.

Everything runs locally in your browser, against the Canvas session you are already logged
into. No API token to paste, no server, no student data leaving your machine.

---

## Install

1. Download / unzip this folder somewhere permanent (e.g. `~/Documents/canvas-gradebook-plus`).
   Chrome loads the folder from disk every time it starts, so don't leave it in Downloads.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `canvas-gradebook-plus` folder (the one containing
   `manifest.json`).
5. Open your course gradebook: `https://<yourschool>.instructure.com/courses/<id>/gradebook`.

It works out of the box on `*.instructure.com`. If your school self-hosts Canvas on its own
domain, open the extension's options page (click the toolbar icon), type the domain under
**Self-hosted Canvas domain**, and click **Enable here**.

To make a fresh ZIP after editing anything:

```bash
cd .. && zip -r canvas-gradebook-plus.zip canvas-gradebook-plus -x "*/.DS_Store"
```

---

## What changes in the gradebook

### Instructor feedback indicators (the main event)

A small blue speech bubble appears in every grade cell where **you personally** left a
submission comment. Not "this submission has comments" — the extension compares each
comment's `author_id` against your own user id, so a student's comment or another teacher's
comment does not light up your cell.

- Hover: *You left feedback* or *3 instructor comments*.
- Two or more of your comments show a small count beside the bubble.
- If the student replied after your last comment, the bubble turns hollow and purple and the
  tooltip adds *student replied since*.
- The bubble sits in the cell's bottom-right corner, so a column's bubbles line up in one
  vertical channel down the right-hand edge and a screenful can be read in a single pass.
- Click the bubble to read the whole thread in place, and reply without leaving the gradebook.
  A reply posted here updates the indicator immediately — no page reload.
- Hovering the bubble previews the latest comment, and that preview is itself a target: the
  pointer can travel into it, and clicking it opens Canvas's own Grade Detail Tray — the side
  pane — for that submission.
- Indicators survive Canvas's virtualized scrolling; they are repainted as rows and columns
  come back into view.

### One-keystroke statuses

In any editable grade cell:

| Key | Result |
| --- | --- |
| `M` | grade `0` **and** status Missing, in one write — pressed again on the same cell it switches Missing to Late and takes the `0` back out |
| `E` | Excused |
| `L` | Late (grade untouched) — pressed again on an already-Late submission, it removes the status |
| `-` or `--` | clears the grade and resets the status |

Both status keys are toggles. `M` on a cell you have already marked Missing means "it turned
up after all": the status becomes **Late**, the `0` that `M` wrote is removed, and the cell is
left empty and ready for whatever grade you want to type into it. `L` on a cell you have
already marked Late simply removes that status. Only a status *somebody applied* can be
toggled — Canvas reports `missing` for anything merely past due and not handed in, and a first
`M` on such a cell still applies the status rather than flipping it.

Only the `0` that `M` itself writes is `M`'s to take away. A submission can be flagged Missing
*and* carry a real grade — Canvas lets you mark it Missing in the Grade Detail Tray and grade
it afterwards, and leaves both standing — and toggling that one changes the status to Late
while the grade stays exactly where it is.

These are writes to the Canvas record, not local decoration. `M` sends the score and
`late_policy_status=missing` in a single request, so the submission reads as Missing in the
Grade Detail Tray, in SpeedGrader and on the student's own grades page. Canvas's editor is
closed without committing anything of its own first, so there is never a second, plain grade
write racing ours — that race is what used to leave a `0` behind with no Missing status. The
response is then checked: if the status did not take, it is requested once more on its own, and
if Canvas still refuses (a course late policy can override it) you are told, rather than being
left with a silent zero.

**Entering a score on a submission that was Missing** removes the Missing status and records
**Late** in its place — the work came in, after it was due. That applies however the grade was
typed, including through Canvas's own editor. Turn off *Grading a Missing submission marks it
Late* in the options page to simply clear the status instead.

A plain `0` stays an ordinary zero — it never becomes Missing. On letter-graded and
GPA-scale assignments a bare `A`–`F` is treated as the letter grade it is, and the shortcuts
are available as `MISSING`, `EX`, `LATE` instead.

**The designation appears the moment you press the key.** Canvas colours its late / missing /
excused cells from its own in-page store, which a write to the Submissions API never reaches —
so the cell used to keep whatever colour Canvas last rendered until the whole gradebook was
reloaded. The extension now paints the status itself, from the record it holds, the instant a
key is pressed: a tint plus a coloured bar down the leading edge of the cell. It also *removes*
a status Canvas is still showing that the submission no longer has — the second `M` turning
Missing into Late, `L` toggled off, a grade that resolved a Missing status.

Where Canvas has caught up and is already painting that same status, the extension's tint
stands down and Canvas's own colour (including custom status colours set in Canvas) is what you
see. Statuses the extension does not manage — dropped, extended, Canvas's resubmitted shading —
are never touched, and a column whose submissions have not loaded yet is left completely alone
rather than being declared status-free.

### Post grades from the column header

With a manual posting policy — or after hiding grades by hand — Canvas keeps a grade to itself:
you can see the score in the grid while the student still sees nothing. Canvas says so with a
small crossed-out eye in the column header, and hides the fix in that column's `⋮` menu.

Any assignment column currently holding grades students cannot see grows a **Post** button in
its header, labelled with how many are waiting (`Post 12`). Press it and that column's grades
go to the students immediately — the same action Canvas's own tray performs, through Canvas's
own `postAssignmentGrades` mutation. Canvas posts in a background job, so the extension waits
for that job, re-reads the column, and the button disappears by itself once nothing is hidden.

Three things it deliberately does not do:

- it never appears on a column with nothing to post, so the button is a statement of fact about
  that column rather than decoration;
- it posts graded submissions only, exactly like Canvas's own default, so students who have not
  been graded yet are not handed an empty grade;
- it never guesses: a column whose submissions have not loaded, or a Canvas build that does not
  report whether a grade is posted, shows no button at all.

Turn it off with *Show a Post button on columns holding grades students cannot see yet* in the
options page.

### Spreadsheet navigation

`Enter` / `Shift+Enter` move down / up. `Tab` / `Shift+Tab` move right / left. Arrow keys move
between grade cells. The extension only assists when Canvas's own handling didn't already
move the cursor, so nothing is double-handled, and typing in a search box or a comment box is
never hijacked.

### Paste a block of grades

Copy a range from Excel or Google Sheets, click the top-left destination cell, and paste.

- newline = next student, tab = next assignment
- `M`, `E`, `L`, numbers, percents, letters and blanks are all understood; blanks are skipped
  rather than clearing an existing grade
- a single space-separated line (`5 5 M 4 E`) is read as a column, which is what you mean when
  you type it by hand
- the mapping is validated **before** anything is written: if any cell would land on the Total
  column, past the end of the roster, or on a value that isn't a valid grade, the whole paste
  is refused and nothing changes
- one confirmation dialog for large operations (default: more than 25 cells)

### Multi-cell selection

`Cmd`/`Ctrl`-click cells to add them to a selection; `Shift`-click to extend a rectangle. A plain
click doesn't select anything of its own, but it still sets the point the *next* Shift-click
extends from, the same way a spreadsheet works — so clicking either end of a range first and
Shift-clicking the other always builds the same rectangle, in either direction. Then press `M`,
`E`, `L`, or type a number and press `Enter` to apply it to everything selected. `Escape` clears
the selection. No toolbar appears; the selection is just an outline on the cells.

Press `C` with one or more cells selected to add the same comment to every one of them at once —
one small dialog, one Save, written as your own comment on each selected submission individually
(so each student's thread reads exactly as if you'd typed it there yourself). `/snippet` + `Tab`
works in it too.

### Student name + Total, frozen together

The Total percentage is drawn beside the student name in Canvas's own frozen pane, so it stays
visible no matter how far right you scroll. The values come from Canvas's enrollment scores —
weighting, drop rules and grading schemes are Canvas's own arithmetic, never recomputed here.

### Submission indicator, one click from SpeedGrader

Every grade cell for an assignment Canvas accepts online shows a small badge in its top-right
corner: **solid green** means the student has handed something in, **hollow grey** means they
have not. The glyph tells you what kind of thing the assignment wants — a file, a text entry, a
URL, a media recording, a discussion post, a quiz — so a column reads in one pass. Hovering
gives you the submission time and the attempt number.

Clicking the badge opens **that student's submission in SpeedGrader**, in a new tab, so you keep
your place in the grid. It is a real link, so cmd-click, middle-click and "copy link address"
all behave the way you'd expect.

Assignments marked *on paper* or *no submission* get no badge at all: there is no such thing as
a missing online submission for those, and a grid full of hollow badges on them would be noise
that is also wrong. A cell whose column has not finished loading shows no badge either, rather
than claiming "nothing submitted" when the truth simply hasn't arrived.

### Open a submission by double-clicking its cell

Canvas puts a small arrow button inside a grade cell while you are editing it; that arrow opens
the Grade Detail Tray (or SpeedGrader, depending on your Canvas). **That arrow is now hidden**,
and double-clicking anywhere in the cell presses it instead — a whole-cell target rather than a
~14px one, and the cell gets its width back. Canvas's own control is clicked, so nothing about
what it opens is reimplemented or guessed. The button is only hidden, never removed, and only
while double-click is switched on, so the action can never become unreachable; if Canvas ever
ships markup where the button can't be found, double-click falls back to opening SpeedGrader for
that exact submission rather than doing nothing.

### Find a student across every course you teach

Next to the course switcher in the Canvas breadcrumb: **Find student**. Type a name, pick the
student — the list shows which course each match is in — and Canvas opens that course's
gradebook with their row scrolled to and briefly highlighted. If the student is in the gradebook
you're already looking at, it just scrolls there without reloading anything.

Matching is by word, in any order, so "tommy newnam", "newnam tommy" and "new tom" all find the
same student.

Rosters are read from Canvas the first time you open the search — never on page load, so a
teacher who doesn't use it never pays for it — a handful of courses at a time, and are held **in
memory for that page only**. They are lists of real students' names, and this extension does not
write those to the device; open the search in a new tab and it reads them again.

### Compact, readable layout

Assignment columns are narrowed to ~110px with two-line wrapped, centered titles and centered
points. Every grade sits in the middle of its cell both horizontally and vertically, in tabular
figures so a column of numbers lines up digit for digit; student names stay left-aligned and
vertically centered, and are no longer underlined (they are still links to that student's
grades page - hover turns them Canvas blue). The row under the pointer lights up across the
frozen pane and the scrolling pane together, including the frozen Total column. The header gets
a gradient and a brand-coloured rule so it reads as a header, and Canvas's bare grade input
becomes a properly inset, centered, focus-ringed box instead of a browser-default text field
jammed against the cell borders.

Every one of those highlights is painted as a tint *over* Canvas's own cell colour, so the
pale blue behind a Late grade, the pink behind a Missing one and the yellow behind an Excused
one all still show through.

Canvas's utility strip (student
and assignment search, filters, Sync, Import, Export, View Options) is collapsed
along with the empty wrappers it leaves behind, and the grid takes the full height of the window.
Apply Filters and Canvas's own gradebook-settings gear are never part of that collapse — Canvas's
real gear button is left exactly where it is (moving it would break its own click handling; see
1.6.1 below), and a lookalike control that forwards its click to the real one sits right beside
Apply Filters instead, so a settings control is always one click away, whatever this setting is
set to.

Press **Alt+Shift+H** to bring Canvas's controls back for the current page. Turn the whole
behaviour off permanently in the options page.

### Resubmission indicator

A small purple corner wedge in the cell's bottom-left means the student resubmitted after you graded (Canvas's
`grade_matches_current_submission`). Missing / late / excused status is Canvas's own gradebook
chrome and is left entirely alone here - no duplicate dots to keep in sync with it.

### Course switching

The course name in Canvas's breadcrumb grows a noticeably larger, pill-shaped **Switch course**
button. Click it for a filterable list of the courses you teach and jump straight to another
gradebook. The list is cached for 30 minutes.

### SpeedGrader draft protection

Unsent comment text in SpeedGrader is autosaved locally, keyed by host + course + assignment +
student, and restored if you come back to that submission with an empty box. The draft is
cleared only once Canvas confirms the comment posted; if Canvas fails, the text stays and you
are told so.

### Due dates in the header

Each assignment header shows a small line under the points ("Due Sep 12, 11:59 PM"),
read straight from Canvas's own assignment data. Turn it off in the options page if you'd
rather keep the header to two lines.

### Comment snippets

Type `/evidence` then `Tab` in SpeedGrader or in the comment popover to expand a saved snippet.
Edit the snippet list in the options page (first line = trigger, following lines = text).

---

## Settings

Everything is in the options page — click the toolbar icon, or `chrome://extensions` →
Canvas Gradebook+ → Details → Extension options. Every feature above can be switched off
individually. Nothing is configurable from inside the gradebook, by design.

## Diagnostics

Turn on **Record diagnostics** in the options page, open a gradebook, then come back and press
**Refresh**. You get course id, student and assignment counts, submissions loaded, instructor
comments found, mapped and unmapped cells, failed requests, and a recent event log.

Student names, grades and comment text are never written to the log — only counts and ids.

## Privacy

- All requests go to your own Canvas host, using your existing session cookie and Canvas's own
  CSRF token, exactly as the Canvas web app does.
- No API token, no login, no account.
- No analytics, no telemetry, no external servers of any kind. The only network permission is
  your Canvas domain.
- Settings sync through your Chrome profile (`chrome.storage.sync`); SpeedGrader drafts and the
  diagnostics snapshot stay on the device (`chrome.storage.local`).
- Student data is never persisted. The cross-course student search holds its rosters in memory
  for the life of the page and no longer; the only thing cached on disk from Canvas is your own
  list of course names and terms, for 30 minutes.

---

## How it is put together

```
manifest.json                     MV3 manifest; one content-script entry, ordered
src/background.js                 service worker: defaults, options, custom-domain registration
src/script-manifest.js            the ordered file list (mirror of the manifest entry)

src/core/                         pure logic - no DOM, no chrome.* at load time
  util.js                         settings, defaults, sanitizing, diagnostics, small helpers
  canvas-api.js                   same-origin Canvas REST client (CSRF, pagination, retry, pooling)
  grade-ops.js                    token -> Canvas form params + optimistic patch (M / E / L / 0 ...)
  post-ops.js                     which grades are still hidden from their students
  clipboard-matrix.js             TSV / column / spaced-column clipboard parsing
  comment-analysis.js             "did I author this comment" logic and thread analysis
  grid-map.js                     cell <-> (student_id, assignment_id) mapping maths
  totals.js                       Total formatting and row alignment
  snippets.js                     /trigger + Tab expansion
  model.js                        assignments, students, submissions, caches, events
  ui.js                           the one transient toast

src/gradebook/
  dom-adapter.js                  THE ONLY file that knows Canvas's grid markup
  cell-registry.js                element <-> cell identity, paint signatures
  indicators.js                   bubbles, counts, late/missing/excused status, value overrides
  writer.js                       optimistic writes with rollback, dedupe, error reporting
  selection.js                    multi-cell selection
  cell-actions.js                 double-click -> Canvas's own tray arrow; two-pane row hover
  keyboard.js                     M / E / L, navigation, editor reconciliation
  bulk-paste.js                   validate-then-write clipboard application
  frozen-total.js                 the synchronized Total column in the frozen pane
  layout.js                       compaction, column widths, header decoration
  post-grades.js                  the per-column Post button and the posting job
  comment-popover.js              in-place comment thread and reply
  course-switcher.js              breadcrumb course dropdown + shared teaching-course list
  student-search.js               cross-course student search (rosters in memory only)
  content.js                      bootstrap, single rAF paint pass, observers

src/speedgrader/content.js        comment draft autosave
src/page/env-bridge.js            reads a few ENV ids from the page context
src/options/                      the only settings UI
src/styles/                       all CSS, scoped under html.cgp-*
tests/                            node:vm test harness + suites
```

Design rules the code sticks to:

- **Writes go through Canvas's REST API**, not through simulated clicks. Before any API write,
  any open Canvas cell editor is cancelled so it cannot commit a stale value afterwards.
- **The DOM is for display and identity only.** All grid-markup knowledge lives in
  `dom-adapter.js`; if Canvas ships a new gradebook, that is the file to update.
- **One paint pass.** Every repaint is coalesced into a single `requestAnimationFrame`
  callback, mutations the extension itself makes are ignored by the observers, and paint
  signatures stop repeated work — so no render loops.
- **Optimistic, then truthful.** A cell updates instantly, then reconciles with what Canvas
  actually stored; a failed write rolls the cell back and says so once, briefly.

## Tests

```bash
node tests/run.js
```

90 assertions covering the parts where being wrong would be expensive: `M` → 0 + Missing and
`M` again → Late with the score cleared (but a real grade left alone), `E` → Excused,
`L` → Late and `L` again → not Late,
a grade on a Missing submission → Late,
plain `0` is *not* Missing, letter-grade exceptions, clipboard
matrix parsing (TSV / column / spaced / ragged / CRLF), clipboard-to-cell mapping and its
refusals, instructor-comment authorship (including drafts, other teachers, numeric vs string
ids, student replies), comment cache updates after a save, bulk dedupe and last-write-wins,
Total formatting and row alignment, the status a cell must show the instant `M` or `L` is
pressed, which submissions count as still hidden from their students, settings clamping, and a
column-wide fetch that was already in flight when a write landed on one of its cells never being
allowed to overwrite that write once it lands.

Syntax-check everything with:

```bash
for f in $(find . -name '*.js'); do node --check "$f" || echo "FAIL $f"; done
```

## Troubleshooting: if something doesn't light up

Canvas's actual gradebook markup can vary between instances, and this extension was built and
unit tested without access to a live one. If comment bubbles don't appear, column widths don't
change, or a keyboard shortcut seems to do nothing:

1. Open the extension's options page and turn on **Record diagnostics**.
2. Reload the gradebook, let it fully load, and try the thing that isn't working.
3. Come back to options → **Diagnostics** → **Refresh**.
4. Look at `columnsUnresolved` and `rowsUnresolved` under counters/facts. Zero means the
   extension found every column and student row; a non-zero number means some cells could not
   be identified, which is why indicators, widths, or shortcuts might not apply to them.
5. If anything is unresolved, `sampleUnresolvedHeader1/2/3` and `sampleUnresolvedRow1/2` show a
   structural sample (element id, class name, link hrefs - never student names or grades) of
   what the extension is actually looking at, which is the fastest way to fix the mismatch.

Two things that no longer happen, as of this fix:

- Pressing `M`/`E`/`L` in a grade cell used to occasionally fall through to Canvas's own
  editor and produce Canvas's "invalid grade" toast if the cell couldn't be identified yet.
  It now always intercepts the keystroke and shows its own message instead, so a stray letter
  is never left sitting in a grade cell.
- Column identification now also matches an unresolved header's visible title text against
  the assignment list from Canvas's API as a fallback, in addition to several more id/attribute
  patterns, since SlickGrid's generated header ids are not always in the exact shape a first
  pass assumed.

## Known limitations

- **Not verified against a live Canvas instance.** The pure logic is unit tested, but the
  DOM-dependent parts (grid mapping, column resizing, control collapsing) were written against
  Canvas's documented markup and could not be exercised against a real gradebook here. That is
  exactly what the diagnostics panel is for: if something looks off, turn it on, reload the
  gradebook, and read the unmapped-cell and failed-request counts.
- **Canvas's own Total column at the far right is left in place.** It is virtualized away
  during horizontal scrolling, so it cannot be made sticky; the frozen Total is drawn beside
  the student name instead. Hide the original with Canvas's own column menu if the duplicate
  bothers you.
- **Row height is unchanged.** SlickGrid computes row positions in JavaScript from its own row
  height; overriding it in CSS misaligns every row. Vertical space is won by collapsing Canvas's
  chrome instead.
- **Column resizing uses Canvas's own resize handles.** If a Canvas update changes those
  handles, the extension detects the failed first drag and stands down completely rather than
  half-resizing the grid. Everything else keeps working.
- **Grading periods.** The frozen Total shows the score Canvas returns for the enrollment. If
  you are filtered to a specific grading period, re-check it against Canvas's own Total column
  before relying on it for reporting.
- **Anonymous or moderated assignments** are refused for API writes, since the identity mapping
  a write depends on is deliberately hidden there.
- **Posting grades uses Canvas's GraphQL endpoint** (`postAssignmentGrades`), which is what
  Canvas's own Gradebook uses. On a Canvas build without that mutation the extension falls back
  to the older "unmute this assignment" REST parameter, which posts the whole column rather
  than only its graded submissions; it says so in the toast when it does. If both are refused,
  nothing is changed and the column's own menu still works.
- Chrome / Edge (Chromium 116+). Not tested in Firefox, which needs a different manifest.

## Version

1.7.0 - a data-integrity audit across grade identity, writes, posting and drafts, prompted by a
teacher asking what edge cases could still cause a wrong grade or a lost comment. Highlights:

- **Cell identity.** A click or keystroke could resolve to the wrong student right after sorting
  or filtering the gradebook: the row cache was checked before a live read of the row itself,
  instead of after. A live read now always wins, the row cache is fully rebuilt (not just
  patched) the moment a sort/filter is detected, and a Shift-click range no longer trusts
  off-screen rows left over from before it. Two assignments sharing the exact same name (a
  common pattern across modules/terms) could have the second one silently forced onto the
  first's id by the name-matching fallback; it now re-checks the points value that
  disambiguated them in the first place before ever reusing that match. The very first
  row-height measurement, if it landed before Canvas had rendered a row yet, used to lock in a
  guess for the rest of the page's life; a wrong guess collided different students onto the same
  computed row index. It's no longer cached until it's a real measurement.
- **Grade writes.** A grade typed directly into Canvas's own cell editor never marked itself
  against the in-flight-fetch race guard added in 1.6.0 - only M/E/L, paste and comments did -
  so a slower column-wide read could still silently revert a plain typed grade. A failed write
  left that same guard permanently pointed at a write that never happened, freezing the cell's
  data forever; it's cleared on failure now. Moderated assignments were only half-refused (like
  the README already claimed) - `writer.js` now refuses them exactly like anonymous ones, for
  both grades and comments (comments had no such refusal at all before, despite grades on the
  same assignment being refused).
- **Clipboard paste.** Pasting one Excel/Sheets cell showing a locale-grouped number ("1 000")
  silently split into two values and wrote to two different students. It's now recognized as one
  grouped number and kept as one write. Cells skipped mid-paste (an anonymous/moderated column
  mixed into an otherwise-ordinary range) used to vanish with no indication - the toast now says
  so.
- **Posting grades.** Any failure of Canvas's postAssignmentGrades mutation - including a
  legitimate refusal because moderation wasn't finished - fell back to the older, broader
  "unmute the whole column" endpoint, which has no moderation awareness and posts everything
  regardless of what was clicked. That fallback now only runs when the mutation itself looks
  genuinely unavailable; a real refusal is shown as an error instead. The Post button's count
  could also be stale by however long the page had been open (a co-teacher grading elsewhere is
  not an edge case) - the column is re-read immediately before posting and before the
  confirmation toast, not just from whatever the button last displayed.
- **SpeedGrader drafts.** Clicking through students quickly could land one student's saved draft
  in a different student's box, or silently delete a still-unsaved draft when navigating away
  before Canvas finished repopulating the comment field. Both are fixed. A rejected
  `chrome.storage.local` write (quota, a mid-session extension update) used to report success
  regardless; it's now surfaced once per page rather than silently losing the draft. The
  confirmation-tracking observer only ever attached to the first comments panel Canvas rendered;
  if a later student's panel was a fresh element rather than a mutation of the same one, a
  submitted comment's draft copy was never cleared and could be resubmitted as a duplicate.
- **Settings.** A corrupted or legacy-schema `snippets` value used to reset to an empty list
  (wiping the built-in defaults too) instead of falling back to the real defaults like every
  other setting does. The snippet library's own limits (60 entries x 4000 characters) could
  exceed `chrome.storage.sync`'s real 8KB-per-item quota by several times over, silently failing
  to save - discarding every other pending setting change in the same save, with no error shown
  anywhere. Limits are now realistic, and a failed save is reported instead of silently
  discarded.
- **Column resizing.** Two failed attempts at narrowing a column to width now try to put it back
  where it started - and say so if that also fails - rather than leaving Canvas's own resize
  handle (which persists whatever width it's dragged to, including to the teacher's next login)
  at an untouched, silently wrong width. A utility-strip wrapper wrongly collapsed because it
  looked empty at the time (Canvas hadn't rendered into it yet) is now periodically rechecked and
  recovered instead of staying hidden for the rest of the page's life.

1.6.1 - two fixes reported right after 1.6.0 shipped. Pressing `C` with cells selected did
nothing but type a literal "c" into whatever grade cell was last focused: building a selection
with Cmd/Ctrl-click deliberately keeps Canvas from moving focus onto the clicked cells, so the
teacher's previous grade editor stayed focused throughout, and the shortcut refused to fire
whenever that focused element looked like a text input - which, in practice, was every time.
The shortcut now opens the bulk-comment dialog once a selection exists, unless the focused text
entry was itself focused after that selection was last built - which means a teacher who keeps
grading or typing Notes elsewhere while an old selection quietly sits in the background still
gets their own keystrokes, selection or not. Canvas's own gradebook-settings gear also went dead
after being pinned beside Apply Filters: pinning it worked by physically moving Canvas's real
button into `<body>`, which silently breaks its click, because Canvas's gradebook is a React app
whose event delegation depends on the button staying in the DOM subtree React actually rendered
it into. The real gear is no longer touched or moved - including staying out of whatever Canvas
container the "collapse Canvas's utility strip" setting hides - and a lookalike button sits
beside Apply Filters instead, forwarding its click to whatever Canvas's real settings control
resolves to at that moment.

1.6.0 - fixes reported from real classroom use. Keyboard shortcuts (`M`/`E`/`L`, numbers, bulk
paste) no longer silently revert a moment after they're applied: a column-wide submissions fetch
that was already in flight when the write landed could land afterwards and overwrite it with the
pre-write state, which looked exactly like "nothing happened until I refresh" - a manual reload
only ever "fixed" it because a fresh page's own fetches always start after the write they follow,
so they could never lose that race. Multi-cell selection now builds the same rectangle regardless
of which end you click first: a plain click did not set a reference point for the next
Shift-click, so only the order that happened to Cmd/Ctrl-click first actually worked. Selected
cells can now take one comment all at once - press `C` with a selection to add the same text to
every selected submission. The breadcrumb's "Switch course" and "Find student" controls no longer
drop onto their own line out of alignment with the course name once both are present, and Find
student's magnifier is no longer squashed down to a sliver by an overly-broad caret-sizing rule.
Canvas's own gradebook-settings gear is now pinned beside Apply Filters and left out of the
"collapse Canvas's utility strip" setting entirely, so it's always reachable without Alt+Shift+H.

1.5.0 - the `M` and `L` designations now appear the instant the key is pressed. Canvas paints
late / missing / excused cells from its own in-page store, which nothing written through the
Submissions API ever reaches, so the colour only caught up on a full page reload; the extension
paints the status itself from the record it holds, and clears a status Canvas is still showing
that the submission no longer has. Any assignment column holding grades students cannot see yet
grows a **Post** button in its header, labelled with how many are waiting, which posts that
column's graded submissions immediately and then re-reads the column so the button retires
itself.

1.4.0 - fixes and adjustments reported against 1.3.0. The last student's row no longer blinks:
publishing the grid's height on every synthetic resize re-entered the same window-resize
listener that caused it, so the grid was being remeasured and re-rendered roughly five times a
second forever, and the row on the edge of SlickGrid's rendered range flickered in and out with
it; the geometry is now published only when it actually changes, and as a whole pixel rather
than a fractional `calc()`. `M` no longer lets Canvas's own editor commit a competing grade
write, and the Missing status is verified with Canvas after the fact instead of assumed.
Entering a score on a Missing submission now switches it to Late rather than merely clearing
the status. `L` became a toggle. The comment bubble moved to the cell's bottom-right (the
resubmission wedge took over bottom-left), and its hover preview is now hoverable and clickable
- clicking it opens Canvas's Grade Detail Tray for that submission. Grades are larger (a new
**Grade text size** setting, 16px by default), and the grade you are typing is drawn in exactly
the face, size, weight and alignment it will have once it is committed.

1.3.0 - Canvas's in-cell tray arrow is hidden (its action moves entirely onto double-click, with
a SpeedGrader fallback so the gesture can never dead-end); every online-submission cell gains a
badge saying whether the student has actually handed something in, what kind of thing the
assignment expects, and links straight to that student's submission in SpeedGrader; and the
breadcrumb gains a **Find student** search across every course you teach, which jumps to the
right gradebook and highlights the student's row on arrival. Rosters for that search are read
lazily and held in memory only - never written to the device.

1.2.0 - a visual pass over the grid plus the cell behaviours reported against 1.1.1. Grades and
student names are now centered vertically (and grades horizontally) inside their cells instead
of sitting on the cell's text baseline near the top-left; student names lost their underline but
kept their link; the comment bubble is bigger, carries a white ring so it stays legible on
Canvas's coloured status cells, and has a generous invisible hit area so hovering it no longer
demands pixel accuracy; a comment bubble destroyed by Canvas rewriting the cell (which is what
opening and closing its grade editor does) is now repainted instead of staying gone until the
page reloads - the paint signature alone could not see that the markup had been wiped, so
painted state is verified against the DOM; double-clicking a grade cell presses Canvas's own
tray arrow; Canvas's in-cell grade input is styled as a real, inset, centered, focus-ringed
field; and the header, column rules, active cell, selection and Total column were reworked,
with every highlight painted as a tint over Canvas's own status colours rather than replacing
them.

1.1.1 - fixes real-Canvas rendering bugs reported against 1.1.0: the assignment header's
title/points/due-date text overlapping itself (the CSS that kept a native header wrapper
visible whenever it contained Canvas's column-options button was un-hiding the title text
right along with it - now every native node is hidden and only the actual button, by tag/role,
is shown again, at any nesting depth); Canvas's own "open in SpeedGrader / Grade Detail Tray"
arrow overlapping the grade input in edit mode on narrowed columns (the input and the arrow
now get an explicit flex layout instead of stacking on the same pixels); the comment bubble
rendering on top of Canvas's own status icon or tray arrow and, worse, sometimes intercepting
their click (the bubble now lives in the one corner - bottom-left - Canvas's grade cell never
draws into, instead of alternating between the two top corners Canvas already uses); and the
course switcher's filled, oversized pill reading as bolted-on furniture next to the breadcrumb
(now a quiet ghost-style control that inherits the breadcrumb's own type size and only gains a
background on hover/open).

1.1.0 - fixes a stale-signature bug where a comment bubble could silently fail to (re)appear
after Canvas recycled its cell element while scrolling; adds a read-only hover preview of the
latest comment alongside the existing click-to-reply popover; moves in-cell markers to corners
Canvas's own SpeedGrader/Grade Detail Tray arrow and column options menu don't use, and stops
hiding those Canvas controls outright; re-enables assignment due dates in the header (now on by
default); auto-clears a Missing status left over once a submission is actually graded; makes the
course switcher a labeled, pill-shaped button instead of a bare caret; removes the missing/
late/excused/needs-grading status dots entirely (Canvas already shows this itself); and gives
student names a larger, higher-contrast treatment plus a broader visual pass across the grid.

1.0.1 - fixes M/E/L sometimes reaching Canvas's own editor, broadens column/row/comment-box
detection with several fallbacks plus name-based matching, adds assignment due dates to
headers, and adds diagnostic samples for anything still unresolved.
