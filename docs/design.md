# Discovery-tree roadmap: design notes

A short description of how the roadmap page is laid out and what it records. The code is the
source of truth; this file explains the shape.

## 1. Data

The page reads three files from one roadmap directory (`roadmap/` by default, or a product's
`roadmapRoot` from `portfolio/portfolio.json`):

- `roadmap.json`: a goal, a work-in-progress limit, a staleness limit in days (or `null` for no
  re-rank reminder), and a list of
  problems. Each problem has an id, an optional parent (which makes the list a tree), a status
  (`next`, `now`, `blocked`, `paused`, `merged`, `done` or `parked`), the date it entered that
  status, an order among its siblings, the slices that address it, and an optional value and
  size estimate on the 1, 2, 3, 5, 8 scale. `src/validate.js` enforces the rules.
- `decisions.jsonl`: one line per change to the roadmap (added, re-ranked, status changed, done
  confirmed, estimated), with who made it and why. The latest status and estimate line for each
  problem must agree with `roadmap.json` (`src/decisions.js`).
- `pace.json`: the forecast written by `npm run pace` (see `docs/pace-cli.md`).

## 2. Layout

The page is a discovery tree: the goal at the root, problems beneath it, and the parts of a
problem beneath that problem. Siblings are shown in rank order. Each card shows its state and, when
the data has them, its estimate and its forecast working hours. A work-in-progress line counts
the `now` cards against the limit, and parked problems are listed apart from the tree.

A card with no parts shows the status written for it. A card with parts shows the state its
parts give it, whatever status is written for it (`src/displayed-state.js`). Its parts are read
by what they show, so the rule works up the tree, and parked parts count too. The first line
that fits decides:

1. A part is in progress (`now` or `merged`): the card shows now.
2. A part is blocked: blocked.
3. Every part is done: done.
4. Every part that is not done is parked: parked.
5. A part is done or paused, so work has started: paused.
6. Otherwise: next.

A card showing a state its parts gave it has none of that state's details of its own, so it
reads plainly: "Waiting" rather than "Waiting on …", "Paused" rather than "Resumes after …",
"Solved ✓" without a date, or "Parked". When the card's own status already carries the detail,
the detail shows.

The tree sits in its own region, named "Card tree", which is the only part of the page that
scrolls sideways. When the tree is wider than the window it scrolls inside that region, so the
status line, the goal and everything above the tree stay where they are; at phone width the
tree stacks into a column and nothing scrolls sideways. Tab reaches the region and the arrow
keys scroll it. When the roadmap changes while the page is open, the redrawn tree keeps the
reader's sideways place and focus.

Above the goal, a reading guide says how long ago the roadmap last changed (from the newest
decision-log entry, at the time the page read it) and holds a closed "How to read this
roadmap" section. Opened, it explains each card state in the words the cards use, how a card
with parts takes its state from them, what "85% likely" means when the cards show a forecast,
and that every change is written to the decision log.

A portfolio page (`strip/portfolio.html`) lists every active product in the registry with the
problems it is solving now, and links to each product's tree.

## 3. Audit trail

The "last re-ranked" line is derived from the latest `coach-rerank` entry in the decision log,
never hand-written. Under the tree, a "Recent decisions" list tells the five newest log entries,
newest first, as who did what to which card and how long ago (`src/recent-decisions.js`).

## 4. Untrusted text

All text from the data files is inserted as text, never as HTML.

## 5. Staleness

A roadmap is stale when the more recent of its last re-rank and the newest `statusSince` of a
`now` or `blocked` problem is more than `staleAfterDays` whole days ago. The page then shows a
warning at the top, cards stop pulsing, and the portfolio says the roadmap is stale.

The reminder is optional per roadmap. `"staleAfterDays": null` switches it off: the roadmap is
never stale, so none of the above happens. The key stays required, so a roadmap that leaves it
out is still refused; any other value must be a whole number of days above zero. The two sample
roadmaps switch the reminder off because their dates are frozen, and would otherwise always look
out of date.

A forecast is a different matter. `pace.json` is out of date only when the roadmap changed after
the forecast was computed: when the newest decision-log entry is later than the file's
`generatedAt` (`src/pace/validate.js`, fed by `lastChangedAt` in `src/freshness.js`). The page
then says "Forecast unavailable: the pace file is out of date." on each card and shows no
ranges, and the load event's forecast code is `stale`. A forecast computed at or after the
newest entry stays current however long ago that was. An empty decision log records no change, so
the forecast stays current. A forecast dated in the future (a wrong clock where it was made)
also stays current until a log entry is later than its date.

The decision log is the signal because every change to the roadmap is written there, and the
log must agree with `roadmap.json` (section 1), so it cannot change without a new line. The
dates inside `roadmap.json` (`statusSince`, `doneOn`) are whole days, too coarse to compare with
a forecast's time, and each one is already matched by a log line. Entries are compared as
instants, whatever offset they are written in.

The forecast also reads git history, but new commits alone do not put it out of date: only a
roadmap change does. That is deliberate. A forecast that ignores the last few commits is still
a fair estimate of the cards it names, while one made before a card was started, solved or
re-ranked describes a roadmap that no longer exists. A forecast for a different set of cards
is caught separately, as `outdated` ("the forecast needs refreshing").

## 6. Observability

Every load emits one structured event, `{ "event": "roadmap.load", "at", "outcome", "reason",
"problems" }`, to the console and to a small per-browser ring buffer. `outcome` is `ok` or
`failed`; `reason` is a closed code and never raw error text.

A load that shows the tree also carries one forecast code, `forecast`: `ok`, `missing`, `invalid`, `stale`, `insufficient` or `outdated`. It describes the pace file only and never changes
`outcome` or `reason`; a bad pace file fails the forecast, not the roadmap load. The load
handler lives in the page layer and calls into the domain layer (`src/pace/`) for every forecast
decision; it holds no pace arithmetic of its own.

## 7. Accessibility

Alerts use `role="alert"`, the tree is a nested list, and colours meet contrast checks
(`test/contrast.test.mjs`).
