# Discovery-tree roadmap: design notes

A short description of how the roadmap page is laid out and what it records. The code is the
source of truth; this file explains the shape.

## 1. Data

The page reads three files from one roadmap directory (`roadmap/` by default, or a product's
`roadmapRoot` from `portfolio/portfolio.json`):

- `roadmap.json`: a goal, a work-in-progress limit, a staleness limit in days, and a list of
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
problem beneath that problem. Siblings are shown in rank order. Each card shows its status and, when
the data has them, its estimate and its forecast working hours. A work-in-progress line counts
the `now` cards against the limit, and parked problems are listed apart from the tree.

A portfolio page (`strip/portfolio.html`) lists every active product in the registry with the
problems it is solving now, and links to each product's tree.

## 3. Audit trail

The "last re-ranked" line is derived from the latest `coach-rerank` entry in the decision log,
never hand-written.

## 4. Untrusted text

All text from the data files is inserted as text, never as HTML.

## 5. Staleness

A roadmap is stale when the more recent of its last re-rank and the newest `statusSince` of a
`now` or `blocked` problem is more than `staleAfterDays` whole days ago. The page then shows a
warning at the top.

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
