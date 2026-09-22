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
| `M` | Missing — pressed again on the same cell, removes it |
| `E` | Excused |
| `L` | Late — pressed again on the same cell, removes it |
| `-` or `--` | clears the grade and resets every status |

Missing and Late are independent, instant flags. Each is a toggle, in exactly the same shape:
pressing the key applies that status, pressing it again on a cell that already carries it takes
the status back off. Neither one ever touches the grade, in either direction, and neither one
ever touches the other — marking a submission Missing does not change a grade already sitting
there, and typing a grade never removes or changes Missing or Late. Only your own `M` or `L`
press changes that status. This is deliberate: Canvas quietly flipping a manually-applied
Missing status to Late the moment a grade showed up used to be a surprise, not a convenience,
so nothing here does that automatically any more — mark it, or unmark it, yourself, and it
happens instantly either way.

Only a status *somebody applied* can be toggled off — Canvas reports `missing` (or `late`) for
anything merely past its due date and not handed in, and a first `M` (or `L`) on such a cell
still applies the status rather than flipping it.

These are writes to the Canvas record, not local decoration. `M` sends
`late_policy_status=missing` (and removing it sends `none`), so the submission reads as Missing
everywhere — the Grade Detail Tray, SpeedGrader and the student's own grades page — not only
here. Canvas's editor is closed without committing anything of its own first, so there is never
a second, plain grade write racing ours. The response is then checked: if the status did not
take, it is requested once more on its own, and if Canvas still refuses (a course late policy
can override it) you are told, rather than being left with a silent no-op.

A plain `0` stays an ordinary zero — it never becomes Missing. On letter-graded and
GPA-scale assignments a bare `A`–`F` is treated as the letter grade it is, and the shortcuts
are available as `MISSING`, `EX`, `LATE` instead.

**The designation appears the moment you press the key.** Canvas colours its late / missing /
excused cells from its own in-page store, which a write to the Submissions API never reaches —
so the cell used to keep whatever colour Canvas last rendered until the whole gradebook was
reloaded. The extension now paints the status itself, from the record it holds, the instant a
key is pressed. It also *removes* a status Canvas is still showing that the submission no
longer has — `M` or `L` toggled off on a cell that already carried that status.

Missing and Late are drawn as a plain, bold letter in a solid circle at the top-left of the cell —
a red **M**, a yellow **L** — rather than a tint, so the two can never be mistaken for each other
or missed at a glance; it shows whenever the submission is Missing or Late by our own record, full
stop, whether or not Canvas's own colour has caught up with it yet. Excused still gets a tint plus
a coloured bar down the leading edge, and that one *does* stand down once Canvas is already
painting the same status (including a custom status colour set in Canvas), so a gradebook Canvas
has caught up with looks exactly as it always did. Statuses the extension does not manage —
dropped, extended, Canvas's resubmitted shading — are never touched, and a column whose
submissions have not loaded yet is left completely alone rather than being declared status-free.

### Post grades from the column header

With a manual posting policy — or after hiding grades by hand — Canvas keeps a grade to itself:
you can see the score in the grid while the student still sees nothing. Canvas says so with a
small crossed-out eye in the column header, and hides the fix in that column's `⋮` menu.

Any assignment column currently holding grades students cannot see grows a **Post** button in
its header, labelled with how many are waiting (`Post 12`). Press it and that column's grades
go to the students immediately — the same action Canvas's own tray performs, through Canvas's
own `postAssignmentGrades` mutation. Canvas posts in a background job, so the extension waits
for that job, re-reads the column, and the button disappears by itself once nothing is hidden.

Canvas's submissions endpoint can lag its own posting job by a second or two, so a column that
still looks untouched on the first re-read is read again on a short backoff rather than believed.
If it still has not caught up, the extension reports what Canvas actually told it — the job
finished, the grades are posted — instead of the count it can currently see. (Reporting that
count is what used to produce a false *0 of N grades posted* on a post that had in fact
succeeded.) It does not overwrite the column on the strength of that: another instructor can
hide a column during the second or two a post takes, and then the read is simply right, so the
grid keeps showing what Canvas last said and one more re-read a few seconds later settles which
case it was. A job the extension stopped waiting for is reported as still running, which is what
it is — and rather than leaving it there, the extension keeps quietly re-checking that column in
the background, on a growing backoff, until it catches up or about ninety seconds have passed.
Posting never requires a reload to show its true result; only a refusal from Canvas is reported
as a failure.

Every one of those re-reads happens without disturbing the rest of the column while it runs: the
status badge, comment bubbles and the hidden-grade bar on every cell in it keep showing exactly
what they showed before Post was pressed, because the model never forgets it has already loaded
that column just because it is re-reading it. (It also never asks Canvas for comments on any of
these re-reads, since posting has no use for them - one fewer thing every column-wide read has to
carry, on the one action this extension most wants to feel instant.)

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
visible no matter how far right you scroll — it does not scroll away with the assignment
columns, and Canvas's own Total column at the far right is hidden so there is never a second,
possibly-different-looking Total competing with it. The values come from Canvas's enrollment
scores — weighting, drop rules and grading schemes are Canvas's own arithmetic, never
recomputed here.

Both of those only happen once the frozen pane has actually been widened to make room: the
widen is measured on every paint, not assumed, because Canvas's exact pane markup cannot be
checked here against a live instance (see "Known limitations" below). If the
measurement doesn't confirm the extra width is really there, nothing is drawn and Canvas's own
Total column is left visible and untouched — you are never left looking at a gap where a Total
used to be. A later paint that measures correctly brings the frozen Total right back with no
reload needed either way.

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
Canvas's own gradebook-settings gear collapses with the rest of the strip. An earlier version
kept it visible and repositioned it to sit beside Apply Filters instead; because that could only
be measured once Canvas had laid the toolbar out, the gear was always painted in its natural spot
first and then jumped — and Canvas re-renders that toolbar often enough that the jump kept
recurring after the page otherwise looked settled. Hiding it removes the measuring, the polling
and the jump.

Press **Alt+Shift+H** to bring Canvas's controls back for the current page — the gear included,
so gradebook settings, posting policies and column arrangement (by due date, name, points, module,
or manual drag, under the gear's own "Arrange columns by" option) stay one keystroke away. Turn the
whole behaviour off permanently in the options page.

One smaller, unconditional cleanup applies regardless of that setting: Canvas's own "keyboard
shortcuts" icon button is always hidden.

### Which grades the student can actually see

Every cell holding a grade that is still hidden gets a coloured bar down its left edge — exactly
the grades that column's **Post** button would post, so a column can be scanned without reading
the header count.

The bar is also the answer to a question the gradebook otherwise cannot show you: Canvas keeps a
submission *posted* once it has been posted, so changing an already-posted score reaches the
student straight away and there is nothing left to post. That is Canvas's own behaviour, not
something this extension does — but from the grid it looks identical to changing a hidden grade.
No bar means the student can see it.

Turn it off with *Mark cells whose grade the student cannot see yet* in the options page.

### Resubmission indicator

A small purple corner wedge in the cell's bottom-left means the student resubmitted after you graded (Canvas's
`grade_matches_current_submission`). Missing / late / excused status is Canvas's own gradebook
chrome and is left entirely alone here - no duplicate dots to keep in sync with it.

### Course switching

The course name in Canvas's breadcrumb grows a noticeably larger, pill-shaped **Switch course**
button. Click it for a filterable list of the courses you teach and jump straight to another
gradebook. The list is cached for 30 minutes.

This isn't limited to the gradebook page - the same button is on every page inside a course
(Assignments, Modules, Discussions, a single student's Grades, wherever Canvas draws that
course's breadcrumb), so switching courses never means going back to the gradebook first.

### SpeedGrader draft protection

Unsent comment text in SpeedGrader is autosaved locally, keyed by host + course + assignment +
student, and restored if you come back to that submission with an empty box. The draft is
cleared only once Canvas confirms the comment posted; if Canvas fails, the text stays and you
are told so.

### Due dates in the header, and a link back to the assignment

Each assignment header shows a small line under the points ("Due Sep 12, 11:59 PM"),
read straight from Canvas's own assignment data. Turn it off in the options page if you'd
rather keep the header to two lines.

The assignment's title itself is a real link to that assignment's own page, so re-reading or
editing it is a click away instead of a trip through Canvas's assignments list. It opens in a
new tab — cmd-click, middle-click and "copy link address" all behave the way you'd expect —
and clicking it never triggers the header's own sort/drag handling underneath.

### Comment snippets

Type `/evidence` then `Tab` in SpeedGrader or in the comment popover to expand a saved snippet.
Edit the snippet list in the options page (first line = trigger, following lines = text).

---

## Settings

Everything is in the options page — click the toolbar icon, or `chrome://extensions` →
Canvas Gradebook+ → Details → Extension options. It opens to a sidebar of tabs (Layout &
Display, Cell Indicators, Grading Input, Comment Snippets, Course & Domains, Backup &
Transfer, Diagnostics); Save and Restore defaults stay visible in the sidebar no matter which
tab you're on. Every feature above can be switched off individually. Nothing is configurable
from inside the gradebook, by design.

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
  content.js                      bootstrap (full gradebook, or just the course switcher
                                   elsewhere in the course), single rAF paint pass, observers

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

101 assertions covering the parts where being wrong would be expensive: `M` → Missing and `M`
again → not Missing, `L` → Late and `L` again → not Late, both leaving the grade untouched either
way, `E` → Excused, a grade entered on a Missing (or Late) submission never changing that status,
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
- **Frozen Total depends on a pane-widen that is verified, not assumed.** Canvas's own Total
  column at the far right is virtualized away during horizontal scrolling, so it cannot be made
  sticky there; instead the frozen pane beside the student name is widened and a Total is drawn
  into the space that opens up, and the native Total is hidden only once that widen is actually
  confirmed to have taken hold (checked on every paint against Canvas's real, unverifiable-here
  pane markup). If a future Canvas markup change ever breaks the widen, the frozen Total simply
  stops drawing and Canvas's own native Total column is left visible in its place — you are
  never left with neither.
- **Row height is unchanged.** SlickGrid computes row positions in JavaScript from its own row
  height; overriding it in CSS misaligns every row. Vertical space is won by collapsing Canvas's
  chrome instead.
- **Column resizing requires SlickGrid's supported API.** Gradebook+ waits for a stable, complete
  column model, changes every requested width in one `setColumns` transaction, and then asks the
  grid to invalidate, render, and resize its canvas. If Canvas does not expose that API, narrowing
  remains presentation-only; Gradebook+ never simulates resize-handle drags that could persist a
  partial set of widths as the teacher's preferences.
- **Grading periods.** The frozen Total is read with the same grading-period filter Canvas's own
  Total column is currently using, learned from the page itself rather than assumed - so the two
  agree, including when a grading period is the server's own default rather than something
  spelled out in the URL.
- **Anonymous or moderated assignments** are refused for API writes, since the identity mapping
  a write depends on is deliberately hidden there.
- **Posting grades uses Canvas's GraphQL endpoint** (`postAssignmentGrades`), which is what
  Canvas's own Gradebook uses. On a Canvas build without that mutation the extension falls back
  to the older "unmute this assignment" REST parameter, which posts the whole column rather
  than only its graded submissions; it says so in the toast when it does. If both are refused,
  nothing is changed and the column's own menu still works.
- Chrome / Edge (Chromium 116+). Not tested in Firefox, which needs a different manifest.
