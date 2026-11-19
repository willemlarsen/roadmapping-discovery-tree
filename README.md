# roadmapping-discovery-tree

[![test](https://github.com/willemlarsen/roadmapping-discovery-tree/actions/workflows/test.yml/badge.svg)](https://github.com/willemlarsen/roadmapping-discovery-tree/actions/workflows/test.yml)

**Try it live:** [discovery tree](https://willemlarsen.github.io/roadmapping-discovery-tree/strip/index.html) · [portfolio](https://willemlarsen.github.io/roadmapping-discovery-tree/strip/portfolio.html) (sample data, served by GitHub Pages)

![The discovery tree for the sample Community Garden Planner roadmap](docs/screenshot.jpg)

A roadmap viewer that shows a product's work as a discovery tree: the goal at the root, the user
problems beneath it, and the parts of each problem beneath that. Each card shows its status
(now, next, blocked, paused, parked, done) and its value and size estimate. A decision log
records every change and who made it, and a pace forecast estimates working hours for the cards
ahead from the repository's own commit history. A portfolio page lists several products side by
side.

Plain JavaScript (ES modules), `node --test`, no dependencies. Node 24 is what CI uses.

## Sample data

The repository ships with sample data for two fictional products:

- `roadmap/`: Community Garden Planner (`roadmap.json`, `decisions.jsonl`, `pace.json`)
- `products/seed-library/roadmap/`: Seed Library
- `portfolio/portfolio.json`: the registry that lists both

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
with status `insufficient` and the page shows no forecast, which is what the sample repository
shows until it has that history. Commit `roadmap/pace.json` after regenerating it.

Built by Willem Larsen with AI agents under the ClickChain governance model.

## License

All rights reserved; shared for viewing as a portfolio sample. See `LICENSE`.
