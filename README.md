# roadmapping-discovery-tree

[![test](https://github.com/willemlarsen/roadmapping-discovery-tree/actions/workflows/test.yml/badge.svg)](https://github.com/willemlarsen/roadmapping-discovery-tree/actions/workflows/test.yml)

A small sample of code built by AI agents under the ClickChain governance model. **Read-only view:** [discovery tree](https://willemlarsen.github.io/roadmapping-discovery-tree/strip/index.html) · [portfolio](https://willemlarsen.github.io/roadmapping-discovery-tree/strip/portfolio.html) (sample data, served by GitHub Pages)

![The discovery tree for the sample Community Garden Planner roadmap](docs/screenshot.jpg)

A roadmap viewer that shows a product's work as a discovery tree: the goal at the root, the user
problems beneath it, and the parts of each problem beneath that. Each card shows its status
(now, next, blocked, paused, parked, done) and its value and size estimate. A decision log
records every change and who made it, and a pace forecast estimates working hours for the cards
ahead from the repository's own commit history. A portfolio page lists several products side by
side.

Plain JavaScript (ES modules), `node --test`, no dependencies. Node 24 is what CI uses.

## What it does, and what it doesn't

The pages are a read-only view. In the workflow this app was built for, the roadmap changes
through governed work: product and technical coaches edit `roadmap/roadmap.json` and append to
`roadmap/decisions.jsonl` (adding, re-ranking, re-estimating or confirming cards), the product owner
can override, and people read and steer from the tree. So there is no drag and drop, chat, or in-page editing of cards; adding, re-ranking or
finishing a card is a change to the data files, and the decision log records who made it and why.

## Sample data

The repository ships with sample data for two fictional products:

- `roadmap/`: Community Garden Planner (`roadmap.json`, `decisions.jsonl`, `pace.json`)
- `products/seed-library/roadmap/`: Seed Library
- `portfolio/portfolio.json`: the registry that lists both

The sample forecasts (both `pace.json` files) are computed from a **synthetic** git history, not
from this repository's own commits, which are too few. `scripts/sample-history.mjs` builds that
history in a temporary directory: a fixed made-up author, backdated cycle commits that name the
sample products' own cards, made-up session tokens, a few cycles a day over the last two to three
weeks of workdays. It then runs `scripts/pace.mjs --git <that directory>` for each product and
deletes the history. To regenerate (the page treats a pace file over three days old as out of
date):

```
npm run sample-history                       # the history ends yesterday
npm run sample-history -- --end 2026-11-23   # or on a given day; same day, same files
```

`test/sample-history.test.mjs` fails if the committed sample pace files differ from what the
script writes for their day.

`docs/design.md` describes the data and the layout; `docs/pace-cli.md` and
`docs/pace-backtest.md` describe the forecast.

## Run it

The pages read the data files over HTTP, so serve the repository root with any static server
and open a page in `strip/`:

```
python3 -m http.server 8000
# then open http://localhost:8000/strip/portfolio.html
# or http://localhost:8000/strip/index.html for the Community Garden Planner tree
```

## Tests

```
npm test               # unit tests with line and branch coverage floors
npm run test:browser   # layout checks in headless Chrome (needs a local Chrome; set CHROME_BIN)
```

## Keeping the forecast fresh

The roadmap page reads `roadmap/pace.json`, which `scripts/pace.mjs` writes from this
repository's `git log` and `roadmap/roadmap.json`:

```
npm run pace
```

The page treats a missing, malformed, outdated or more-than-three-days-old file as "forecast
unavailable" and says why. The forecast needs several days of history with cycle commits (a
subject like `C1: <behaviour> (gov-<session id>)`); with too little history the file is written
with status `insufficient` and the page shows no forecast. This repository's own history is that
short, which is why the sample pace files come from the synthetic history described under
[Sample data](#sample-data) instead. Commit the pace file after regenerating it.

Built by Willem Larsen with AI agents under the ClickChain governance model.

## License

MIT. See `LICENSE`.
