# Canvas Gradebook+

A Chrome extension (Manifest V3) that fixes the Canvas instructor Gradebook **in place**.
There is no second gradebook, no dashboard, no side panel, no floating toolbar. You open
Canvas, and the gradebook simply behaves the way it should have in the first place.

Everything runs locally in your browser, against the Canvas session you are already logged
into. No API token to paste, no server, no student data leaving your machine.

---

## Install

Install it from the Chrome Web Store (unlisted, so use this link):
**https://chromewebstore.google.com/detail/ijohiadaoippjnjcgnemhcidabnbncfa**

Then open your course gradebook: `https://<yourschool>.instructure.com/courses/<id>/gradebook`.

A store install follows your Chrome profile: with Chrome sync on, it installs itself on every
computer you sign into, and its settings come with it. New versions arrive on their own; the
extension checks for one when Chrome starts and when you open a Canvas course (at most hourly),
and switches over as soon as it is downloaded. A gradebook tab that was already open keeps
working, but reload it to pick up the new version and any settings changes.

If you used an earlier unpacked copy (**Load unpacked** on `chrome://extensions`), remove it
once the store version is installed, or both will run on the gradebook. Its settings don't
carry over on their own: use **Export** on the old copy's options page and **Import** on the
new one first.

It works out of the box on `*.instructure.com`. If your school self-hosts Canvas on its own
domain, open the extension's options page (click the toolbar icon), type the domain under
**Self-hosted Canvas domain**, and click **Enable here**.

For development, **Load unpacked** on `chrome://extensions` (Developer mode on) still works on
a checkout of this repo. To make a ZIP for a Web Store upload after raising `"version"` in
`manifest.json`:

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
- Each of your own comments in that thread has a small trash can. Press it once and it turns red
  and pulses while a bar drains (about three seconds); press it again to delete the comment from
  Canvas. Letting the bar run out cancels. Other people's comments have no trash can.
- Hovering the bubble previews the latest comment, and that preview is itself a target: the
  pointer can travel into it, and clicking it opens Canvas's own Grade Detail Tray — the side
  pane — for that submission.
- Indicators survive Canvas's virtualized scrolling; they are repainted as rows and columns
  come back into view.
- A comment, grade or status (Missing, Late, Excused) saved through Canvas's own Grade Detail
  Tray — or in SpeedGrader, in another tab — shows up in the cell as soon as Canvas saves it: the
  extension notices the write and re-reads that one cell, so the bubble and the M/L badge appear
  without a reload. See "Every view stays in step" below.

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
there.

**Entering a grade never adds a status.** The extension follows Canvas's own rules
(`Submission#missing?` / `late?`) exactly, and those already know the assignment's submission
type:

- Canvas's *automatic* Missing (past due, nothing submitted, on an assignment that takes online
  submissions) disappears by itself the moment any grade is saved, a `0` included. Nothing extra is
  sent.
- Canvas's automatic Missing and Late never apply to **on paper** or **no submission** assignments,
  and automatic Late only applies to work a student actually submitted after the due date.
- A Missing somebody *applied* (with `M`, the Grade Detail Tray or SpeedGrader) stays on a graded
  submission in Canvas. With **A real grade typed over a Missing you applied takes Missing off** on
  (the default, under Grading Input), typing or pasting a grade above zero over it — or saving one in
  the Grade Detail Tray — hands the status back to Canvas (`late_policy_status: null`), and Canvas
  marks the work Late (applying the course's late deduction) only if it really was submitted late.
  SpeedGrader is Canvas's own page: a grade saved there keeps an applied Missing, as in Canvas. It waits for Canvas's own save of the grade to land first, so a value Canvas
  refuses — or an edit you cancel with `Escape` — never changes anything. A `0` (or fail /
  incomplete) leaves an applied Missing on: a zero is how missing work is recorded. Turn the setting
  off and grades never touch a status at all.

Earlier versions marked the work **Late** whenever a grade was typed over any Missing, a second or
more after Canvas's own save and without regard to the submission type; that is gone.

Typing a grade and then pressing `M` (before leaving the cell) saves that grade with an applied
Missing off — `M` is you saying "not missing". Taking an applied Missing off (this, or pressing `M`
again) never pins "no status" on work the student actually handed in: the status goes back to
Canvas, so work submitted after its due date is Late again, with its deduction. Pinning "None"
(which is what the Grade Detail Tray's and SpeedGrader's *None* do) switches Late off for good.

`L` sends how late the work really was (`seconds_late_override`), exactly as Canvas's own tray does
when you pick Late there. Without it Canvas counts an applied Late as 0 seconds late and deducts
nothing.

Adding a comment never touches a status: Canvas's comment write leaves it exactly where it was.
(Earlier versions put Missing back whenever a comment's answer came back without it — which also
re-marked Missing that had just been removed in SpeedGrader or the tray.) Canvas's answer to a
comment is now taken as the current truth for the cell's status too.

Typed grades are saved by Canvas's own editor and nothing else — the extension never sends a
second copy of a grade you typed.

Only a status *somebody applied* can be toggled off — Canvas reports `missing` (or `late`) for
anything merely past its due date and not handed in, and a first `M` (or `L`) on such a cell
still applies the status rather than flipping it.

These are writes to the Canvas record, not local decoration. `M` sends
`late_policy_status=missing` (removing it sends `null` for work the student handed in, so Canvas
can mark it Late again, and `none` for work that was never handed in), so the submission reads as Missing
everywhere — the Grade Detail Tray, SpeedGrader and the student's own grades page — not only
here. Canvas's editor is closed without committing anything of its own first, so there is never
a second, plain grade write racing ours. The response is then checked: if the status did not
take, it is requested once more on its own, and if Canvas still refuses (a course late policy
can override it) you are told, rather than being left with a silent no-op.

A plain `0` stays an ordinary zero — it never becomes Missing. On letter-graded and
GPA-scale assignments a bare `A`–`F` is treated as the letter grade it is, and the shortcuts
are available as `MISSING`, `EX`, `LATE` instead.

**The designation appears the moment you press the key.** Canvas colours its late / missing /
excused cells, computes its Total and draws the Grade Detail Tray from its own in-page store,
which a write to the Submissions API never reaches. So the extension paints the status itself,
from the record it holds, the instant a key is pressed — and then hands Canvas's answer to
Canvas's own store, through the same method Canvas's tray and its Curve Grades / Set Default Grade
dialogs use (`updateSubmissionsFromExternal`). Canvas's cell, its status icon, its Total and the
Grade Detail Tray (redrawn if it is open on that submission) all show the new grade and status
without a reload, and Canvas's own editor compares your next edit against the right value.

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
- it posts graded submissions, plus ungraded ones that hold a comment from you, exactly like
  Canvas's own default (under a manual posting policy Canvas hides comments until the submission
  is posted, so a note on an ungraded cell also counts toward the button). Students with neither
  a grade nor a comment are not handed an empty grade;
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
- `M`, `E`, `L`, numbers, percents and blanks are understood everywhere; letter grades only
  on letter-grade and GPA columns, and `complete`/`incomplete`/`pass`/`fail` only on
  complete/incomplete columns. Blanks are skipped rather than clearing an existing grade — a
  blank *first* cell included, so every value still lands on its own student
- a single space-separated line (`5 5 M 4 E`) is read as a column, which is what you mean when
  you type it by hand
- the mapping is validated **before** anything is written: if any cell would land on the Total
  column, past the end of the roster, or on a value that isn't a valid grade for its column, the
  whole paste is refused and nothing changes
- every target row is read live from the grid just before writing, so a re-sort or a filter
  change can never send a pasted grade to whoever *used* to sit on that row; if a row can't be
  confirmed, the paste is refused
- one confirmation dialog for large operations (default: more than 25 cells), and for any
  multi-cell paste that would replace a grade already there
- pasting only counts when you're working in the grid; a paste while focused elsewhere on the
  page is left alone

### Multi-cell selection

`Cmd`/`Ctrl`-click cells to add them to a selection; `Shift`-click to extend a rectangle. A plain
click doesn't select anything of its own, but it still sets the point the *next* Shift-click
extends from, the same way a spreadsheet works — so clicking either end of a range first and
Shift-clicking the other always builds the same rectangle, in either direction. Then press `M`,
`E`, `L`, or type a number and press `Enter` to apply it to everything selected. `Escape` clears
the selection. No toolbar appears; the selection is just an outline on the cells.

Grades entered this way are saved straight to Canvas and handed to Canvas's own in-page store,
so Canvas's cells, Total and Grade Detail Tray show them at once. Until Canvas's store confirms it
holds a saved grade, the extension draws that grade over the cell — including the cell you
Shift-clicked, which Canvas treats as its active cell — and the overlay goes as soon as Canvas
confirms. Open one of those cells to change it and the editor starts from the grade Canvas actually
has. Whatever you type replaces it: if Canvas would still skip it as "unchanged" (typing back the
value the cell had before the bulk entry, on a Canvas build where the hand-off could not happen),
the extension saves it instead.

Press `C` with one or more cells selected to add the same comment to every one of them at once —
one small dialog, one Save, written as your own comment on each selected submission individually
(so each student's thread reads exactly as if you'd typed it there yourself). `/snippet` + `Tab`
works in it too.

### Student name + Total, frozen together

The Total percentage is drawn beside the student name in Canvas's own frozen pane, so it stays

The first time the feature runs, Canvas's own Total column (still at the far right by default) is moved in the grid to sit immediately after the frozen student column, so it lands beside the names without any manual step; turning the setting off puts it back. Hovering a Total shows its letter grade, using a scale you can edit under Options → Appearance (the score is rounded half-up to 0.1, then the highest matching minimum applies; defaults A+ 96.5, A 92.5, A- 89.5, B+ 86.5, B 82.5, B- 79.5, C+ 76.5, C 72.5, C- 69.5, D 64.5, F below).
visible no matter how far right you scroll — it does not scroll away with the assignment
columns, and Canvas's own Total column at the far right is hidden so there is never a second,
possibly-different-looking Total competing with it. The values come from Canvas's enrollment
scores — weighting, drop rules and grading schemes are Canvas's own arithmetic, never
recomputed here. Like Canvas's own teacher view, the Total counts grades that are still hidden
from students (Canvas's `unposted_current_score`), so it moves as soon as you enter a grade on
a manually-posted assignment. It follows the grading-period filter, including changes you make
after the page has loaded.

Both of those only happen once the frozen pane has actually been widened to make room: the
widen is measured on every paint, not assumed, because Canvas's exact pane markup cannot be
checked here against a live instance (see "Known limitations" below). If the
measurement doesn't confirm the extra width is really there, nothing is drawn and Canvas's own
Total column is left visible and untouched — you are never left looking at a gap where a Total
used to be. A later paint that measures correctly brings the frozen Total right back with no
reload needed either way.

### The hidden Test Student stays out of your averages

Canvas's Student View "Test Student" is a real enrollment, and whatever sits in its row counts
wherever Canvas averages a column. The row is hidden by default (*Hide the Test Student row*),
and because you can no longer see it, nothing is allowed to fill it in behind your back:

- Canvas's own Enter and arrow-key navigation can no longer walk into the hidden row and take
  the next grade you type: the cursor steps straight past it to the next real student, in the
  direction you were moving. Any keystroke that would edit a Test Student cell (a grade, `M`,
  `E`, `L`, a paste) is stopped, and an editor that opens there is closed without saving.
- Shift-click ranges skip the row, and a paste that would put a value on it is refused with a
  message saying so. The extension's own writes never target it.
- Grades that get there anyway — Canvas's automatic missing-submission policy gives the Test
  Student zeros as due dates pass — are found and cleared automatically in the background when
  the gradebook opens, with no prompt. Clearing empties the grade, removes any excusal, and sets
  "no status" so the missing policy cannot put the zero straight back.

Canvas's own whole-column actions (Set Default Grade, Curve Grades) can still reach the Test
Student; anything they put there is caught the next time the gradebook opens. With the row
shown, none of this applies — it is your row to edit.

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
and double-clicking anywhere in the cell opens the tray instead — a whole-cell target rather than a
~14px one, and the cell gets its width back.

Canvas's own arrow opens the tray *without* saving what is still typed in the cell, so typing a
grade and then opening the tray used to show the grade from before the edit. A double-click now
first saves what you typed — Canvas's own save, exactly as Enter would make it — and then has
Canvas's own Gradebook open the tray, which shows the new grade straight away (pending, then
saved). Where that is not possible, Canvas's own arrow is clicked as before, so nothing about what
it opens is reimplemented or guessed. The button is only hidden, never removed, and only while
double-click is switched on, so the action can never become unreachable; if Canvas ever ships
markup where the button can't be found, double-click falls back to opening SpeedGrader for that
exact submission rather than doing nothing.

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
Canvas's own gradebook-settings gear collapses with the rest of the strip, and a **gear** appears
in the breadcrumb instead, right after **Find student**. Clicking it opens Canvas's own Gradebook
Settings, exactly as Canvas's gear does. Its **View Options** tab holds **Arrange By**, which sorts
the assignment columns by due date, name, points or module (or keeps your own drag order); late
policies and the grade posting policy are there too. It doesn't copy Canvas's settings: the click goes to Canvas's own hidden gear, so
Canvas opens its own dialog and saves your changes itself, and the utility strip stays collapsed.
The breadcrumb gear only shows while the strip is collapsed, so there is never a second one.

(An earlier version kept Canvas's gear visible and moved it next to Apply Filters. It could only be
moved after Canvas had laid out the toolbar, so the gear drew in its usual spot first and then
jumped, again and again as Canvas redrew the toolbar. The breadcrumb never moves.)

Press **Alt+Shift+H** to bring Canvas's controls back for the current page. Turn the whole
behaviour off permanently in the options page.

One smaller, unconditional cleanup applies regardless of that setting: Canvas's own "keyboard
shortcuts" icon button is always hidden.

### Analyze Scores, for a column or the course Total

Every assignment column's `⋮` menu has an **Analyze Scores** item. It opens a panel showing the
mean, median, standard deviation, range, the five highest and five lowest students, and a
histogram grouped by the letter-grade cutoffs under Options → Appearance. Blank and excused cells
are counted but left out of every figure (a blank is not a zero). Anonymous and moderated
assignments don't get it, since the lists name students.

The **Total** gets the same panel. Click the small bar-chart button beside "Total" in the frozen
Total header (or, when Canvas's own Total column is the one showing, use **Analyze Scores** in its
`⋮` menu). The figures are the course totals the Total column shows: Canvas's own weighted scores,
with the same grading-period filter, shown as percentages. Each student in the highest/lowest
lists also gets their letter grade. Students with no graded work yet are counted but not included
in the figures, and the Test Student is never included.

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

A small purple corner wedge in the cell's bottom-left means the student resubmitted after you
graded — Canvas's own `Submission#resubmitted?`: a real student submission that is waiting to be
graded again (`grade_matches_current_submission` false). Canvas only sets that when a student
submits over an existing score, so on-paper and no-submission work, and excused cells, never show
it.

### Every view stays in step

A grade, status or comment is the same wherever you look at it — the grid, the Grade Detail
Tray, SpeedGrader — and you never have to reload a page to see a change made in another one:

- **Gradebook → Grade Detail Tray.** Everything the extension saves (keyboard statuses, pastes,
  multi-cell entry, comments) is handed to Canvas's own in-page store, which the tray is drawn
  from; an open tray on that submission is redrawn, and re-reads its comment thread when a comment
  was added or deleted. A grade typed in the cell and then double-clicked is saved before the tray
  opens (see above).
- **Grade Detail Tray → Gradebook.** Canvas saves those itself; the extension notices and re-reads
  the cell so its own badges and bubbles agree.
- **SpeedGrader → Gradebook.** A grade, status or comment saved in SpeedGrader (classic or the
  newer platform SpeedGrader) is announced to the gradebook tabs of that course, which re-read that
  submission and hand it to Canvas's store — cell, Total and tray included. A column-wide change
  (posting grades, Canvas's Set Default Grade / Curve Grades) re-reads the column.
- **Gradebook → SpeedGrader.** A SpeedGrader opened afterwards always loads what Canvas has. One
  that is already open on the submission you changed is told to refetch it — the same message
  Canvas's own code sends the platform SpeedGrader. Classic SpeedGrader has no such hook, so it
  shows a notice with a **Reload** button instead (unsent comments are kept by the draft
  protection).
- **Coming back to the gradebook tab** (or its window) re-reads the columns on screen, at most every
  15 seconds, and hands anything that changed to Canvas's store — this covers changes no tab could
  announce, such as another teacher grading or a student submitting.

A grade you are in the middle of typing is never disturbed: a change for that student's row waits
until you finish (or, if you leave the edit unsaved for half a minute, skips that row and leaves the
extension's own overlay showing the saved value).

Only ids (course, assignment, student) pass between your tabs, through the extension's own
background worker; nothing is stored. Turn it off with *Keep the gradebook and SpeedGrader up to
date with each other, without reloading* under Grading Input.

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

### Time shortcuts (Assign To time boxes)

When creating or editing an assignment, type a period number — `1`, `2`, `3` or `4` — in a
Due Date / Available from / Until **Time** box, then press `Tab` or `Enter` (or click away) and
it becomes that period's start time (by default 8:55 AM, 10:10 AM, 12:30 PM, 1:45 PM). Only a box
holding nothing but a shortcut is touched, so `12:30` or `1 pm` still mean what they say. Add,
edit or remove shortcuts (any short key, e.g. `lunch` → 11:30 AM) on the **Time Shortcuts** tab of
the options page; the same Assign To card on quizzes, discussions and modules is covered too.

---

## Settings

Everything is in the options page — click the toolbar icon, or `chrome://extensions` →
Canvas Gradebook+ → Details → Extension options. It opens to a sidebar of tabs (Layout &
Display, Cell Indicators, Grading Input, Comment Snippets, Time Shortcuts, Course & Domains, Backup &
Transfer, Diagnostics); Save and Restore defaults stay visible in the sidebar no matter which
tab you're on. Every feature above can be switched off individually. Nothing is configurable
from inside the gradebook, by design.

### The same settings on every computer

Settings, comment snippets included, are saved to your Chrome profile and carried by Chrome sync to
every computer where Chrome is signed in to **the same Google account with sync turned on**,
including **Extensions** (Chrome → Settings → You and Google → Sync → Manage what you sync). A
change made on one computer shows up on the others within a minute or so. An options page
that's already open there updates by itself, and an open gradebook uses the new snippets straight
away.

- Each setting and each snippet is saved as its own entry, so you can keep up to 100 snippets of
  up to 2,000 characters. (Earlier versions put every setting in one entry that Chrome caps at 8 KB,
  which meant 15 short snippets.)
- **Save** writes only what you changed on that page. Earlier versions rewrote everything on every
  save, so saving on a computer that hadn't caught up with sync yet (or a laptop that was offline)
  put its old settings back on every computer. Now different settings changed on two computers,
  and snippets added on both, are all kept. If snippets added on two computers come to more than
  100 together, the second save is refused with a message saying so, instead of some of them
  quietly disappearing.
- A computer that has never saved anything writes nothing, so a fresh install can't overwrite the
  settings that are on their way to it.

What Chrome sync can't do, whatever the extension does:

- It doesn't cross Google accounts. Settings saved in a school account's Chrome profile don't reach
  a personal account's profile, or the other way round. Use **Export** and **Import** under
  Backup & Transfer to copy them across.
- A school can turn Chrome sync off for its accounts (Google Admin console). Then settings stay on
  each computer, and Export / Import is the way to move them.
- A copy loaded with **Load unpacked** is a different extension as far as Chrome is concerned, with
  its own settings.

## Diagnostics

Turn on **Record diagnostics** in the options page, open a gradebook, then come back and press
**Refresh**. You get course id, student and assignment counts, submissions loaded, instructor
comments found, mapped and unmapped cells, failed requests, and a recent event log.

Student names, grades and comment text are never written to the log — only counts and ids.

## Privacy

- All requests go to your own Canvas host, using your existing session cookie and Canvas's own
  CSRF token, exactly as the Canvas web app does.
- No API token, no login, no account.
- No analytics, no telemetry, no external servers of any kind — not even web fonts; the
  extension uses your system fonts. The only network permission is your Canvas domain.
- Settings sync through your Chrome profile (`chrome.storage.sync`; see "The same settings on every
  computer" above); SpeedGrader drafts and the
  diagnostics snapshot stay on the device (`chrome.storage.local`).
- Student data is never persisted. The cross-course student search holds its rosters in memory
  for the life of the page and no longer; the only thing cached on disk from Canvas is your own
  list of course names and terms, for 30 minutes.
- Keeping tabs in step passes only ids (course, assignment, student) between your own Canvas tabs,
  through the extension's background worker, and stores nothing. What is handed to Canvas's own
  page is the grading fields of a submission Canvas itself just returned — never comments, names or
  submission content.

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
  time-shortcuts.js               period key -> start time lookup and formatting
  model.js                        assignments, students, submissions, caches, events
  ui.js                           the one transient toast

src/gradebook/
  dom-adapter.js                  THE ONLY file that knows Canvas's grid markup
  cell-registry.js                element <-> cell identity, paint signatures
  indicators.js                   bubbles, counts, late/missing/excused status, value overrides
  canvas-store.js                 hands saved submissions to Canvas's own in-page store
  live-sync.js                    tells other tabs of the course what changed; follows them
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

src/assignments/time-shortcuts.js period keys in Assign To time boxes (Tab/Enter/blur)
src/speedgrader/content.js        comment draft autosave; live sync with the gradebook
src/page/env-bridge.js            page context: ENV ids, column widths, Canvas's store and tray
src/page/write-watch.js           page context: reports Canvas's own submission writes (ids only)
src/live-relay.js                 service worker: relays change announcements between course tabs
src/options/                      the only settings UI
src/styles/                       all CSS, scoped under html.cgp-*
tests/                            node:vm test harness + suites
```

Design rules the code sticks to:

- **Writes go through Canvas's REST API**, not through simulated clicks. Before any API write,
  any open Canvas cell editor is cancelled so it cannot commit a stale value afterwards. Canvas's
  answer then goes into Canvas's own in-page store, so there is one record, not two.
- **Canvas decides statuses.** Missing, Late and resubmitted are read from what Canvas computes,
  never inferred from a grade; entering a grade never adds a status.
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

456 cases covering the parts where being wrong would be expensive: `M` → Missing and `M`
again → not Missing, `L` → Late and `L` again → not Late, both leaving the grade untouched either
way, `E` → Excused, a grade never adding a status (and lifting an applied Missing only when asked),
statuses read exactly as Canvas computes them, the hand-off to Canvas's own store (and never
without `assignment_visible`), opening the tray on a grade still being typed, change
announcements between tabs, plain `0` is *not* Missing, letter-grade exceptions, clipboard
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
  than only its graded submissions; it says so in the toast when it does. That fallback is
  only used when Canvas positively reports the mutation missing (HTTP 404/501 or a schema
  error), never after a network failure — the post may already have gone through, and the
  column is re-checked instead. If both are refused, nothing is changed and the column's own
  menu still works. The Post button posts every section's graded submissions.
- **Keeping every view in step relies on Canvas's own page objects** — its Gradebook component
  (`updateSubmissionsFromExternal`, `openSubmissionTray`, `renderSubmissionTray`) and the platform
  SpeedGrader's `canvas.refetchSubmission` message — read from Canvas's open-source code but not
  exercised against a live instance here. Each step falls back to the previous behaviour when it
  cannot be reached: patching the grid's rows directly, clicking Canvas's own tray arrow, a reload
  notice in SpeedGrader. Diagnostics counts which path each hand-off took (`canvasStore.stored.*`).
- Changes made by **someone else** (another teacher, a student submitting) are picked up when you
  come back to the gradebook tab, not the instant they happen; only your own tabs announce changes.
- Chrome / Edge (Chromium 116+). Not tested in Firefox, which needs a different manifest.
