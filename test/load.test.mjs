import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadAtStatus, fileSource, renderReadAt, showRoadmap } from "../src/load.js";
import { createFakeDocument, allElements } from "./support/fake-dom.mjs";
import { estimateFor, UNRANKED } from "./support/words.mjs";
import { insufficientPace, validPace } from "./support/pace.mjs";

const AT = "2026-11-01T12:00:00Z";

const failures = [
  { name: "fetch rejects", fetch: async () => { throw new Error("ECONNREFUSED 10.0.0.7:8080 secret-path"); }, reason: "fetch-failed", words: "The roadmap could not be loaded." },
  { name: "non-OK response", fetch: async () => ({ ok: false, status: 500, text: async () => "stack trace here" }), reason: "fetch-failed", words: "The roadmap could not be loaded." },
  { name: "invalid JSON", fetch: async () => ({ ok: true, text: async () => "{ not json" }), reason: "invalid-json", words: "The roadmap file is not readable." },
];

const roadmap = {
  version: 1, goal: "Willem always knows where we are", wipLimit: 1, staleAfterDays: 3,
  problems: [
    { id: "up-001", parent: null, problem: "See where we are", status: "now", statusSince: "2026-10-28", order: 1, slices: ["skin-roadmap-bar"], waitingOn: null, resumesAfter: null, doneOn: null, confirmedBy: null },
    { id: "up-002", parent: null, problem: "Peek under the hood", status: "next", statusSince: "2026-10-28", order: 2, slices: ["skin-roadmap-bar"], waitingOn: null, resumesAfter: null, doneOn: null, confirmedBy: null },
  ],
};
const logLine = (problemId, action, after) =>
  ({ at: AT, problemId, actor: "Amal", action, before: null, after, why: "Seeded from the approved design" });
const decisionLogText = [logLine("up-001", "coach-add", "now"), logLine("up-002", "coach-add", "next")]
  .map((line) => JSON.stringify(line)).join("\n");
const rerankLine = (at, actor, why) => JSON.stringify({ ...logLine("up-001", "coach-rerank", "now"), at, actor, why });
const logWithRerank = (at, actor, why) => [rerankLine(at, actor, why), decisionLogText].join("\n");
const seededLogText = logWithRerank(AT, "Amal", "seed");
const staleLogText = logWithRerank("2026-10-20T10:00:00Z", "Amal", "seed");
const okFetch = async (path) => ({ ok: true, text: async () => (path.endsWith(".jsonl") ? seededLogText : JSON.stringify(roadmap)) });

const servingLog = (logText) => async (path) =>
  (path.endsWith(".jsonl") ? { ok: true, text: async () => logText } : okFetch(path));

const partNamed = (shown, label) => shown.children.find((part) => part.attributes["aria-label"] === label);
const treeOf = (shown) => partNamed(shown, "Roadmap");
const inputsOf = (shown) => partNamed(shown, "Forecast inputs");
const readAts = new WeakMap();
async function showWithReadAt(io) {
  const holder = {};
  const shown = await showRoadmap({ ...io, showReadAt: (line) => { holder.line = line; } });
  readAts.set(shown, holder);
  return shown;
}
const readAtOf = (shown) => readAts.get(shown)?.line;

async function load(fetch) {
  const events = [];
  const shown = await showWithReadAt({ fetch, document: createFakeDocument(), emit: (event) => events.push(event), now: () => AT });
  return { shown, events };
}

test("a failed load shows an alert with its fixed words", async () => {
  for (const failure of failures) {
    const { shown } = await load(failure.fetch);
    assert.deepEqual({ role: shown.attributes.role, words: shown.textContent }, { role: "alert", words: failure.words }, failure.name);
  }
});

test("a failed load shows no tree", async () => {
  for (const failure of failures) {
    const { shown } = await load(failure.fetch);
    assert.deepEqual(allElements(shown).filter((element) => element.tagName === "UL"), [], failure.name);
  }
});

test("a failed load emits one failed event with a closed reason code", async () => {
  for (const failure of failures) {
    const { events } = await load(failure.fetch);
    assert.deepEqual(events, [{ event: "roadmap.load", at: AT, outcome: "failed", reason: failure.reason, problems: 0 }], failure.name);
  }
});

test("a failed load leaks no raw error internals", async () => {
  for (const failure of failures) {
    const { shown, events } = await load(failure.fetch);
    const visible = JSON.stringify(events) + allElements(shown).map((element) => element.textContent).join(" ");
    assert.doesNotMatch(visible, /ECONNREFUSED|10\.0\.0\.7|secret-path|stack trace/, failure.name);
  }
});

test("a successful load shows the tree", async () => {
  const { shown } = await load(okFetch);

  assert.equal(treeOf(shown).tagName, "SECTION");
});

test("a successful load shows when the roadmap was read", async () => {
  const { shown } = await load(okFetch);

  assert.match(readAtOf(shown).textContent, /^Roadmap read at /);
});

test("the read-at line says who last re-ranked the roadmap, when and why, and says nothing of a re-rank when there is none", async () => {
  const { shown } = await load(okFetch);
  const { shown: shownWithoutRerank } = await load(servingLog(decisionLogText));

  assert.match(readAtOf(shown).textContent, / · Last re-ranked by Amal on 2026-11-01: seed$/);
  assert.doesNotMatch(readAtOf(shownWithoutRerank).textContent, /re-ranked/);
});

test("the read-at line shows the re-rank derived from the decision log, not the hand-written one, and no re-rank words when the log has none", async () => {
  const rerank = { ...logLine("up-001", "coach-rerank", "now"), at: "2026-11-02T09:00:00Z", actor: "Amaya", why: "from the log" };
  const loggedText = [decisionLogText, JSON.stringify(rerank)].join("\n");

  const { shown } = await load(servingLog(loggedText));
  const { shown: shownWithoutRerank } = await load(servingLog(decisionLogText));

  assert.match(readAtOf(shown).textContent, / · Last re-ranked by Amaya on 2026-11-02: from the log$/);
  assert.doesNotMatch(readAtOf(shownWithoutRerank).textContent, /re-ranked/);
});

test("a successful load emits one ok event with the problem count", async () => {
  const { events } = await load(okFetch);

  assert.deepEqual(events, [{ event: "roadmap.load", at: AT, outcome: "ok", reason: "none", problems: 2, forecast: "invalid", staleDays: 0 }]);
});

test("an invalid roadmap is refused with the invalid-schema alert and event, and no tree", async () => {
  const invalid = { ...roadmap, problems: [roadmap.problems[0], { ...roadmap.problems[1], status: "maybe" }] };
  const invalidFetch = async () => ({ ok: true, text: async () => JSON.stringify(invalid) });

  const { shown, events } = await load(invalidFetch);

  assert.deepEqual({
    role: shown.attributes.role,
    words: shown.textContent,
    trees: allElements(shown).filter((element) => element.tagName === "UL").length,
    events,
  }, {
    role: "alert",
    words: "The roadmap file has mistakes, so it is not shown.",
    trees: 0,
    events: [{ event: "roadmap.load", at: AT, outcome: "failed", reason: "invalid-schema", problems: 0 }],
  });
});

test("a roadmap whose part has an unknown parent shows the invalid-schema failure and no rank or part words", async () => {
  const orphan = { ...roadmap.problems[1], id: "up-003", parent: "up-999", value: 5, size: 2 };
  const invalid = { ...roadmap, problems: [roadmap.problems[0], orphan] };
  const invalidFetch = async () => ({ ok: true, text: async () => JSON.stringify(invalid) });

  const { shown } = await load(invalidFetch);

  assert.equal(shown.textContent, "The roadmap file has mistakes, so it is not shown.");
  assert.doesNotMatch(shown.textContent, /Priority|Unranked|Part \d/);
});

test("a roadmap with a next problem that has a now part shows the invalid-schema alert and event, and no tree", async () => {
  const part = { ...roadmap.problems[0], id: "up-003", parent: "up-002", order: 1 };
  const invalid = { ...roadmap, problems: [roadmap.problems[0], roadmap.problems[1], part] };
  const invalidFetch = async () => ({ ok: true, text: async () => JSON.stringify(invalid) });

  const { shown, events } = await load(invalidFetch);

  assert.deepEqual({
    role: shown.attributes.role,
    words: shown.textContent,
    events,
  }, {
    role: "alert",
    words: "The roadmap file has mistakes, so it is not shown.",
    events: [{ event: "roadmap.load", at: AT, outcome: "failed", reason: "invalid-schema", problems: 0 }],
  });
});

test("a roadmap whose part sits in a parent loop shows the invalid-schema failure and no rank or part words", async () => {
  const looped = [["up-003", "up-004"], ["up-004", "up-003"]]
    .map(([id, parent], index) => ({ ...roadmap.problems[1], id, parent, order: index + 1, value: 5, size: 2 }));
  const invalid = { ...roadmap, problems: [roadmap.problems[0], ...looped] };
  const invalidFetch = async () => ({ ok: true, text: async () => JSON.stringify(invalid) });

  const { shown } = await load(invalidFetch);

  assert.equal(shown.textContent, "The roadmap file has mistakes, so it is not shown.");
  assert.doesNotMatch(shown.textContent, /Priority|Unranked|Part \d/);
});

test("a load fetches the roadmap, its decision log and the pace file, all with no-store", async () => {
  const requests = [];
  const recordingFetch = async (path, options) => { requests.push([path, options]); return okFetch(path); };

  await load(recordingFetch);

  assert.deepEqual(requests, [
    ["roadmap/roadmap.json", { cache: "no-store" }],
    ["roadmap/decisions.jsonl", { cache: "no-store" }],
    ["roadmap/pace.json", { cache: "no-store" }],
  ]);
});

test("a roadmap file holding JSON null is refused as invalid-schema", async () => {
  const nullFetch = async () => ({ ok: true, text: async () => "null" });

  const { shown, events } = await load(nullFetch);

  assert.deepEqual({ words: shown.textContent, reasons: events.map((event) => event.reason) },
    { words: "The roadmap file has mistakes, so it is not shown.", reasons: ["invalid-schema"] });
});

test("a decision log that can't be fetched fails the load as fetch-failed", async () => {
  const logFailures = [async () => { throw new Error("offline"); }, async () => ({ ok: false, text: async () => "" })];
  const fetches = logFailures.map((failLog) => async (path) => (path.endsWith(".jsonl") ? failLog() : okFetch(path)));

  const loads = await Promise.all(fetches.map((fetch) => load(fetch)));

  assert.deepEqual(loads.map(({ shown, events }) => ({ words: shown.textContent, reasons: events.map((event) => event.reason) })),
    logFailures.map(() => ({ words: "The roadmap could not be loaded.", reasons: ["fetch-failed"] })));
});

test("a decision log with a line that isn't JSON fails the load as invalid-json", async () => {
  const logTexts = [`${decisionLogText}\n{ broken`, `${decisionLogText}\n`];
  const fetches = logTexts.map(servingLog);

  const loads = await Promise.all(fetches.map((fetch) => load(fetch)));

  assert.deepEqual(loads.map(({ events }) => events.map((event) => event.reason)), [["invalid-json"], ["none"]]);
});

test("a decision log that fails its checks refuses the load as log-mismatch", async () => {
  const badLogs = [{ action: "coach-add" }, logLine("up-001", "coach-status", "done")].map((line) => JSON.stringify(line));
  const fetches = badLogs.map((badLine) => servingLog(`${decisionLogText}\n${badLine}`));

  const loads = await Promise.all(fetches.map((fetch) => load(fetch)));

  assert.deepEqual(loads.map(({ shown, events }) => ({ words: shown.textContent, reasons: events.map((event) => event.reason) })),
    badLogs.map(() => ({ words: "The roadmap and its decision log disagree, so it is not shown.", reasons: ["log-mismatch"] })));
});

const servingPace = (paceFetch) => async (path) => (path.endsWith("pace.json") ? paceFetch() : okFetch(path));
const forecastNotes = (shown) => allElements(treeOf(shown)).filter((element) => element.tagName === "LI")
  .map((item) => item.children[0].children.slice(2).flatMap((group) => group.children.map((note) => note.textContent)));

test("a missing or invalid pace file keeps the tree and marks each now and next card forecast unavailable with a fixed reason", async () => {
  const paceFailures = [
    [async () => { throw new Error("ECONNREFUSED 10.0.0.7:8080"); }, "the pace file could not be loaded"],
    [async () => ({ ok: false, text: async () => "stack trace here" }), "the pace file could not be loaded"],
    [async () => ({ ok: true, text: async () => "{ not json" }), "the pace file has mistakes"],
    [async () => ({ ok: true, text: async () => JSON.stringify({ results: [] }) }), "the pace file has mistakes"],
  ];

  const loads = await Promise.all(paceFailures.map(([paceFetch]) => load(servingPace(paceFetch))));

  loads.forEach(({ shown, events }, index) => {
    const reason = `Forecast unavailable: ${paceFailures[index][1]}.`;
    assert.equal(treeOf(shown).tagName, "SECTION");
    assert.deepEqual(forecastNotes(shown), [[reason], [reason]]);
    assert.doesNotMatch(JSON.stringify(events) + shown.textContent, /ECONNREFUSED|10\.0\.0\.7|stack trace/);
  });
});

test("the load event carries a closed forecast code and never the pace file's text", async () => {
  const paceResponses = [
    [async () => { throw new Error("ECONNREFUSED 10.0.0.7:8080"); }, "missing"],
    [async () => ({ ok: true, text: async () => "{ not json <script>alert(1)</script>" }), "invalid"],
  ];

  const loads = await Promise.all(paceResponses.map(([paceFetch]) => load(servingPace(paceFetch))));

  assert.deepEqual(loads.map(({ events }) => events), paceResponses.map(([, forecast]) => [
    { event: "roadmap.load", at: AT, outcome: "ok", reason: "none", problems: 2, forecast, staleDays: 0 },
  ]));
});

test("an insufficient pace file shows no range, says not enough history and emits the insufficient code", async () => {
  const reasons = ["too_few_active_days", "no_cycle_intervals"];
  const fetches = reasons.map((reason) => servingPace(async () => ({ ok: true, text: async () => JSON.stringify(insufficientPace(reason)) })));

  const loads = await Promise.all(fetches.map((fetch) => load(fetch)));

  const note = "Forecast unavailable: not enough history yet.";
  assert.deepEqual(loads.map(({ shown, events }) => [forecastNotes(shown), events.map((event) => event.forecast)]),
    reasons.map(() => [[[note], [note]], ["insufficient"]]));
});

test("a pace file older than three days is stale and shows no range, while one exactly three days old is fresh", async () => {
  const generatedAt = validPace().generatedAt;
  const clocks = ["2026-11-03T20:33:30Z", "2026-11-03T20:33:29Z"];
  const paceFetch = servingPace(async () => ({ ok: true, text: async () => JSON.stringify(validPace()) }));

  const loads = await Promise.all(clocks.map(async (clock) => {
    const events = [];
    const shown = await showWithReadAt({ fetch: paceFetch, document: createFakeDocument(), emit: (event) => events.push(event), now: () => clock });
    return [forecastNotes(shown), events.map((event) => event.forecast)];
  }));

  const note = "Forecast unavailable: the pace file is out of date.";
  assert.equal(generatedAt, "2026-10-31T20:33:29Z");
  assert.deepEqual(loads, [[[[note], [note]], ["stale"]], [[["Sequence 1 of 2 \u00b7 the order the work follows", "About 2 working hours left (85% likely)"], ["Sequence 2 of 2 \u00b7 the order the work follows", "About 3 working hours left (85% likely)"]], ["ok"]]]);
});

test("results must follow the forecast order, now before next, and each card shows its place in it", async () => {
  const [first, second] = validPace().results;
  const paces = [validPace(), validPace({ results: [second, first] }), validPace({ results: [first] })];
  const fetches = paces.map((pace) => servingPace(async () => ({ ok: true, text: async () => JSON.stringify(pace) })));

  const loads = await Promise.all(fetches.map((fetch) => load(fetch)));

  const invalid = ["Forecast unavailable: the pace file has mistakes."];
  const refresh = ["Forecast unavailable: the forecast needs refreshing."];
  assert.deepEqual(loads.map(({ shown, events }) => [forecastNotes(shown), events.map((event) => event.forecast)]), [
    [[["Sequence 1 of 2 \u00b7 the order the work follows", "About 2 working hours left (85% likely)"], ["Sequence 2 of 2 \u00b7 the order the work follows", "About 3 working hours left (85% likely)"]], ["ok"]],
    [[invalid, invalid], ["invalid"]],
    [[refresh, refresh], ["outdated"]],
  ]);
});

const servedAs = (pace) => servingPace(async () => ({ ok: true, text: async () => JSON.stringify(pace) }));
const loadAt = async (fetch, clock) => showWithReadAt({ fetch, document: createFakeDocument(), emit: () => {}, now: () => clock });

test("the page shows the forecast's inputs whenever the pace file is valid and none when it is missing or invalid", async () => {
  const inputLines = (shown) => {
    const inputs = inputsOf(shown);
    return inputs ? [inputs.attributes["aria-label"], ...allElements(inputs).filter((element) => element.tagName === "LI").map((item) => item.textContent)] : [];
  };

  const ok = await loadAt(servedAs(validPace()), AT);
  const stale = await loadAt(servedAs(validPace()), "2026-11-04T00:00:00Z");
  const insufficient = await loadAt(servedAs(insufficientPace()), AT);
  const missing = await loadAt(servingPace(async () => { throw new Error("offline"); }), AT);
  const invalid = await loadAt(servedAs({ results: [] }), AT);

  const counts = "History read: 125 commits, 72 cycle commits, 71 cycle intervals, 4 active days";
  const window = "Window: the last 4 active days within the last 14 days, sessions split at gaps over 60 minutes, each day capped at 10 hours";
  const sizes = "Cycles per card: sizes from 3 finished builds, 6 to 14 cycles.";
  const generated = "Pace file generated 2026-10-31T20:33:29Z";
  const hours = "Hours are working hours at the measured pace, counted from now, one card after another.";
  assert.deepEqual([ok, stale, insufficient, missing, invalid].map(inputLines), [
    ["Forecast inputs", "Pace: 1.45 hours of work per active day", window, sizes, counts, generated, hours],
    ["Forecast inputs", "Pace: 1.45 hours of work per active day", window, sizes, counts, generated, hours],
    ["Forecast inputs", window, sizes, counts, generated],
    [],
    [],
  ]);
});

test("the reading guide sits just before the tree, says how long ago the log last changed, and explains 85% likely only when the forecast is shown", async () => {
  const guideOf = (shown) => {
    const guide = partNamed(shown, "Reading guide");
    return { beforeTree: shown.children.indexOf(guide) === shown.children.indexOf(treeOf(shown)) - 1, freshness: guide.children[0].textContent, explainsForecast: guide.textContent.includes("85% likely") };
  };

  const forecasted = await loadAt(servedAs(validPace()), "2026-11-01T15:00:00Z");
  const unforecast = await loadAt(servedAs(insufficientPace()), "2026-11-03T12:00:00Z");

  assert.deepEqual([forecasted, unforecast].map(guideOf), [
    { beforeTree: true, freshness: "Roadmap last changed 3 hours ago", explainsForecast: true },
    { beforeTree: true, freshness: "Roadmap last changed 2 days ago", explainsForecast: false },
  ]);
});

test("the forecast inputs say that hours are working hours counted from now, only when there is a pace", async () => {
  const inputWords = (shown) => allElements(inputsOf(shown)).filter((element) => element.tagName === "LI").map((item) => item.textContent);
  const hoursWords = "Hours are working hours at the measured pace, counted from now, one card after another.";

  const withDates = await loadAt(servedAs(validPace()), AT);
  const withoutDates = await loadAt(servedAs(insufficientPace()), AT);

  assert.equal(inputWords(withDates).includes(hoursWords), true);
  assert.equal(inputWords(withoutDates).includes(hoursWords), false);
});

test("the forecast inputs no longer say the planning-safe end, and the cards do not either", async () => {
  const inputWords = (shown) => allElements(inputsOf(shown)).filter((element) => element.tagName === "LI").map((item) => item.textContent);
  const planningSafe = "The later date of each range is the planning-safe end.";

  const shown = await loadAt(servedAs(validPace()), AT);

  assert.equal(inputWords(shown).filter((line) => line === planningSafe).length, 0);
  assert.deepEqual(forecastNotes(shown).flat().filter((note) => note.includes("planning-safe")), []);
});

test("the forecast inputs no longer repeat the Sequence order or the date sentences, since each card says it", async () => {
  const inputWords = (shown) => allElements(inputsOf(shown)).filter((element) => element.tagName === "LI").map((item) => item.textContent);
  const sequenceWords = "Dates follow the Sequence order, not Priority.";

  const withDates = await loadAt(servedAs(validPace()), AT);
  const withoutDates = await loadAt(servedAs(insufficientPace()), AT);

  assert.equal(inputWords(withDates).includes(sequenceWords), false);
  assert.equal(inputWords(withoutDates).includes(sequenceWords), false);
});

test("the forecast inputs name the rolling window", async () => {
  const inputWords = (shown) => allElements(inputsOf(shown)).filter((element) => element.tagName === "LI").map((item) => item.textContent);
  const windowWords = "Window: the last 4 active days within the last 14 days, sessions split at gaps over 60 minutes, each day capped at 10 hours";

  const shown = await loadAt(servedAs(validPace()), AT);
  const withoutDates = await loadAt(servedAs(insufficientPace()), AT);

  assert.deepEqual(inputWords(shown).filter((line) => line.startsWith("Window")), [windowWords]);
  assert.deepEqual(inputWords(withoutDates).filter((line) => line.startsWith("Window")), [windowWords]);
});

test("a pace file for other cards says the forecast needs refreshing", async () => {
  const otherCards = validPace({ results: validPace().results.map((result) => ({ ...result, id: `${result.id}-old` })) });

  const { shown, events } = await load(servingPace(async () => ({ ok: true, text: async () => JSON.stringify(otherCards) })));

  const note = ["Forecast unavailable: the forecast needs refreshing."];
  assert.deepEqual(forecastNotes(shown), [note, note]);
  assert.deepEqual(events.map((event) => event.forecast), ["outdated"]);
  assert.equal(inputsOf(shown).attributes["aria-label"], "Forecast inputs");
});

test("the forecast inputs name the sizes of the finished builds that cards are sampled from, or say there are too few", async () => {
  const sizeWords = async (sizeSamples) => {
    const pace = validPace();
    const shown = await loadAt(servedAs({ ...pace, inputs: { ...pace.inputs, sizeSamples } }), AT);
    return allElements(inputsOf(shown)).filter((element) => element.tagName === "LI").map((item) => item.textContent)
      .filter((line) => line.startsWith("Cycles per card"));
  };
  const fewWords = ["Cycles per card: fewer than 3 finished builds are known, so each card uses its fixed cycle count."];

  const sampled = await sizeWords([6, 11, 14]);
  const exactlyThree = await sizeWords([5, 5, 200]);
  const two = await sizeWords([6, 11]);
  const none = await sizeWords([]);

  assert.deepEqual(sampled, ["Cycles per card: sizes from 3 finished builds, 6 to 14 cycles."]);
  assert.deepEqual(exactlyThree, ["Cycles per card: sizes from 3 finished builds, 5 to 200 cycles."]);
  assert.deepEqual([two, none], [fewWords, fewWords]);
});

test("a card's estimate is left out when sizes are sampled, and names the fixed count otherwise", async () => {
  const estimateOf = async (sizeSamples) => {
    const pace = validPace();
    const shown = await loadAt(servedAs({ ...pace, inputs: { ...pace.inputs, sizeSamples } }), AT);
    return forecastNotes(shown).map((notes) => notes[2]);
  };

  const sampled = await estimateOf([6, 11, 14]);
  const twoSizes = await estimateOf([6, 11]);
  const noSizes = await estimateOf([]);

  assert.deepEqual(sampled, [undefined, undefined]);
  assert.deepEqual([twoSizes, noSizes], [[estimateFor(16), estimateFor(16)], [estimateFor(16), estimateFor(16)]]);
});

const parkedIdea = { id: "up-009", parent: null, problem: "Someday: share the roadmap with a guest", status: "parked", statusSince: "2026-10-30", order: 3, slices: ["skin-roadmap-bar"], waitingOn: null, resumesAfter: null, doneOn: null, confirmedBy: null };
const servingWithParkedIdea = async (path) => ({
  ok: true,
  text: async () => (path.endsWith(".jsonl")
    ? `${decisionLogText}\n${JSON.stringify(logLine("up-009", "coach-add", "parked"))}`
    : JSON.stringify({ ...roadmap, problems: [...roadmap.problems, parkedIdea] })),
});

test("a successful load lists parked problems in their own labelled region after the tree", async () => {
  const { shown } = await load(servingWithParkedIdea);

  const region = partNamed(shown, "Parked for later");
  assert.deepEqual(allElements(region).filter((element) => element.tagName === "LI").map((item) => item.textContent), ["Someday: share the roadmap with a guest"]);
});

test("a successful load with nothing parked shows no Parked for later region", async () => {
  const { shown } = await load(okFetch);

  const region = partNamed(shown, "Parked for later");

  assert.equal(region, undefined);
});

test("a successful load says how much work is in progress against the limit", async () => {
  const { shown } = await load(okFetch);

  assert.ok(shown.children.map((part) => part.textContent).includes("Work in progress 1 of 1"));
});

test("a stale roadmap shows a warning alert with the days since the last re-rank or work, and a fresh one shows none", async () => {
  const alertsOf = async (serving) => (await load(serving)).shown.children.filter((part) => part.attributes.role === "alert");

  const [staleAlerts, freshAlerts] = [await alertsOf(servingLog(staleLogText)), await alertsOf(okFetch)];

  assert.deepEqual([staleAlerts.map((part) => part.textContent), freshAlerts], [["This roadmap may be out of date: last re-ranked or worked on 4 days ago"], []]);
});

test("the stale warning counts days since the last re-rank or work, the two things the rule reads", async () => {
  const { shown } = await load(servingLog(staleLogText));

  const alert = shown.children.find((part) => part.attributes.role === "alert");

  assert.equal(alert.textContent, "This roadmap may be out of date: last re-ranked or worked on 4 days ago");
});

test("the stale warning and the work-in-progress line come before the roadmap tree", async () => {
  const { shown } = await load(servingLog(staleLogText));

  const positionOf = (isPart) => shown.children.findIndex(isPart);
  const [alertAt, wipAt, treeAt] = [
    positionOf((part) => part.attributes.role === "alert"),
    positionOf((part) => part.textContent.startsWith("Work in progress")),
    positionOf((part) => part.attributes["aria-label"] === "Roadmap"),
  ];
  assert.ok(alertAt >= 0 && alertAt < wipAt && wipAt < treeAt, `alert ${alertAt}, wip ${wipAt}, tree ${treeAt}`);
});

test("the ok load event carries staleDays, the whole days since the roadmap last changed", async () => {
  const staleDaysOf = async (serving) => (await load(serving)).events.map((event) => event.staleDays);

  const [staleEvents, freshEvents] = [await staleDaysOf(servingLog(staleLogText)), await staleDaysOf(okFetch)];

  assert.deepEqual([staleEvents, freshEvents], [[4], [0]]);
});

test("a ranked card says its priority among the ranked problems with its value and size in place of the unranked words, and an unranked card keeps them", async () => {
  const [first, second] = roadmap.problems;
  const estimated = { ...roadmap, problems: [{ ...first, value: 8, size: 2 }, second] };
  const estimateLine = JSON.stringify(logLine("up-001", "coach-estimate", { value: 8, size: 2 }));
  const fetch = async (path) => (path.endsWith("roadmap.json")
    ? { ok: true, text: async () => JSON.stringify(estimated) }
    : servingLog(`${seededLogText}\n${estimateLine}`)(path));
  const paceFetch = servingPace(async () => ({ ok: true, text: async () => JSON.stringify(validPace()) }));

  const { shown } = await load(async (path) => (path.endsWith("pace.json") ? paceFetch(path) : fetch(path)));

  assert.deepEqual(rankParagraphs(shown), [["Priority 1 of 1 · value for size: value 8, size 2"], [UNRANKED]]);
});

test("a forecast card names its working order Sequence N of M, not Forecast order", async () => {
  const paceFetch = servingPace(async () => ({ ok: true, text: async () => JSON.stringify(validPace()) }));

  const { shown } = await load(paceFetch);

  assert.deepEqual(forecastNotes(shown).map((notes) => notes[0]), ["Sequence 1 of 2 \u00b7 the order the work follows", "Sequence 2 of 2 \u00b7 the order the work follows"]);
});

test("a forecast card's likely-done note names the 50% and 85% ends of its range", async () => {
  const paceFetch = servingPace(async () => ({ ok: true, text: async () => JSON.stringify(validPace()) }));

  const { shown } = await load(paceFetch);

  assert.deepEqual(forecastNotes(shown).map((notes) => notes[1]), ["About 2 working hours left (85% likely)", "About 3 working hours left (85% likely)"]);
});

test("the under-limit work-in-progress line has no colon", async () => {
  const { shown } = await load(okFetch);

  const words = shown.children.map((part) => part.textContent);

  assert.ok(words.includes("Work in progress 1 of 1"));
});

const rankParagraphs = (shown) => allElements(treeOf(shown)).filter((element) => element.tagName === "LI")
  .map((item) => item.children[0].children.filter((part) => part.tagName === "P").map((line) => line.textContent));

test("every now and next card shows its rank line as its own paragraph whatever the pace state, beside the forecast note", async () => {
  const [first, second] = validPace().results;
  const paceStates = [
    ["missing", servingPace(async () => { throw new Error("down"); }), AT],
    ["invalid", servingPace(async () => ({ ok: true, text: async () => "{ not json" })), AT],
    ["insufficient", servedAs(insufficientPace("too_few_active_days")), AT],
    ["stale", servedAs(validPace()), "2026-11-03T20:33:30Z"],
    ["outdated", servedAs(validPace({ results: [first] })), AT],
    ["ok", servedAs(validPace({ results: [first, second] })), AT],
  ];

  const loads = await Promise.all(paceStates.map(([, fetch, clock]) => loadAt(fetch, clock)));

  assert.deepEqual(loads.map(rankParagraphs), paceStates.map(() => [[UNRANKED], [UNRANKED]]));
  assert.ok(loads.every((shown) => forecastNotes(shown).every((notes) => notes.length > 0)));
});

test("across every pace state a feature card shows exactly its rank line and a part card exactly its Part line, never priority, unranked, value or size", async () => {
  const entry = (id, parent, order, status, estimate = {}) =>
    ({ ...roadmap.problems[0], id, parent, order, status, ...estimate });
  const problems = [
    entry("up-001", null, 1, "now", { value: 8, size: 2 }),
    entry("up-002", null, 2, "next"),
    entry("up-003", "up-001", 1, "next", { value: 5, size: 3 }),
    entry("up-004", "up-001", 2, "next"),
  ];
  const estimateLines = [["up-001", { value: 8, size: 2 }], ["up-003", { value: 5, size: 3 }]]
    .map(([id, after]) => JSON.stringify(logLine(id, "coach-estimate", after)));
  const statusLines = problems.map(({ id, status }) => JSON.stringify(logLine(id, "coach-add", status)));
  const logText = [...statusLines, ...estimateLines].join("\n");
  const cardResults = problems.map(({ id }) => ({ ...validPace().results[0], id }));
  const served = (pace) => servingPace(async () => ({ ok: true, text: async () => JSON.stringify(pace) }));
  const fetchWith = (paceFetch) => async (path) => {
    if (path.endsWith("pace.json")) return paceFetch(path);
    return path.endsWith("roadmap.json") ? { ok: true, text: async () => JSON.stringify({ ...roadmap, wipLimit: 4, problems }) } : servingLog(logText)(path);
  };
  const paceStates = [
    ["missing", servingPace(async () => { throw new Error("down"); }), AT],
    ["invalid", servingPace(async () => ({ ok: true, text: async () => "{ not json" })), AT],
    ["insufficient", served(insufficientPace()), AT],
    ["stale", served(validPace({ results: cardResults })), "2026-11-03T20:33:30Z"],
    ["outdated", served(validPace()), AT],
    ["ok", served(validPace({ results: cardResults })), AT],
  ];

  const loads = await Promise.all(paceStates.map(([, paceFetch, clock]) => loadAt(fetchWith(paceFetch), clock)));

  const expected = [["Priority 1 of 1 · value for size: value 8, size 2"], ["Part 1 of 2, next"], ["Part 2 of 2, next"], [UNRANKED]];
  assert.deepEqual(loads.map(rankParagraphs), paceStates.map(() => expected));
});

test("the read-at line names the last estimate change beside the last re-rank in four cases: both, re-rank only, estimate only, none", async () => {
  const estimated = { ...roadmap, problems: [{ ...roadmap.problems[0], value: 8, size: 2 }, roadmap.problems[1]] };
  const estimateLine = (action, actor) => JSON.stringify({ ...logLine("up-001", action, { value: 8, size: 2 }), actor });
  const servingWith = (roadmapShown, logText) => async (path) =>
    (path.endsWith("roadmap.json") ? { ok: true, text: async () => JSON.stringify(roadmapShown) } : servingLog(logText)(path));
  const afterTime = async (fetch) => readAtOf((await load(fetch)).shown).textContent.replace(/^Roadmap read at [^·]*?(?= · |$)/, "Roadmap read at T");
  const cases = [
    ["both", servingWith(estimated, `${seededLogText}\n${estimateLine("coach-estimate", "Amaya")}`), "Roadmap read at T · Last re-ranked by Amal on 2026-11-01: seed · Last estimate change by Amaya on 2026-11-01"],
    ["re-rank only", servingLog(seededLogText), "Roadmap read at T · Last re-ranked by Amal on 2026-11-01: seed"],
    ["estimate only", servingWith(estimated, `${decisionLogText}\n${estimateLine("willem-estimate-override", "Willem")}`), "Roadmap read at T · Last estimate change by Willem on 2026-11-01"],
    ["none", servingLog(decisionLogText), "Roadmap read at T"],
  ];

  const words = await Promise.all(cases.map(([, fetch]) => afterTime(fetch)));

  assert.deepEqual(words, cases.map(([, , expected]) => expected));
});

test("an estimate-only decision log leaves the load event's staleDays equal to the log without an estimate", async () => {
  const estimated = { ...roadmap, problems: [{ ...roadmap.problems[0], value: 8, size: 2 }, roadmap.problems[1]] };
  const lateEstimate = JSON.stringify({ ...logLine("up-001", "coach-estimate", { value: 8, size: 2 }), at: "2026-11-01T11:00:00Z" });
  const oldLog = [rerankLine("2026-10-20T10:00:00Z", "Amal", "seed"), decisionLogText].join("\n").replace(/2026-11-01T12:00:00Z/g, "2026-10-20T10:00:00Z");
  const serving = (roadmapShown, logText) => async (path) =>
    (path.endsWith("roadmap.json") ? { ok: true, text: async () => JSON.stringify(roadmapShown) } : servingLog(logText)(path));

  const without = (await load(serving(roadmap, oldLog))).events[0].staleDays;
  const withEstimate = (await load(serving(estimated, `${oldLog}\n${lateEstimate}`))).events[0].staleDays;

  assert.deepEqual([withEstimate, without], [without, without]);
});

test("card contract table: scheduled card, rolled-up feature, missing pace data and a hostile actor string each show exactly their lines", async () => {
  const HOSTILE = "<img src=x onerror=alert(1)>";
  const entry = (id, parent, order, status, estimate = {}) => ({ ...roadmap.problems[0], id, parent, order, status, ...estimate });
  const problems = [
    entry("up-001", null, 1, "now", { value: 8, size: 2 }),
    entry("up-002", null, 2, "next", { value: 5, size: 3 }),
    entry("up-003", "up-001", 1, "next"),
    entry("up-004", "up-001", 2, "next"),
  ];
  const logText = [
    ...problems.map(({ id, status }) => JSON.stringify(logLine(id, "coach-add", status))),
    JSON.stringify(logLine("up-001", "coach-estimate", { value: 8, size: 2 })),
    JSON.stringify({ ...logLine("up-002", "coach-estimate", { value: 5, size: 3 }), actor: HOSTILE }),
  ].join("\n");
  const [template] = validPace().results;
  const dated = (id, p50Date, p85Date) => ({ ...template, id, p50Date, p85Date });
  const pace = validPace({ results: [dated("up-003", "2026-11-01", "2026-11-02"), dated("up-004", "2026-11-03", "2026-11-04"), dated("up-002", "2026-11-05", "2026-11-06")] });
  const fetchWith = (paceFetch) => async (path) => {
    if (path.endsWith("pace.json")) return paceFetch();
    return path.endsWith("roadmap.json") ? { ok: true, text: async () => JSON.stringify({ ...roadmap, wipLimit: 4, problems }) } : { ok: true, text: async () => logText };
  };
  const cardLines = (shown) => allElements(treeOf(shown)).filter((element) => element.tagName === "LI")
    .map((item) => item.children[0].children.slice(2).flatMap((part) => (part.tagName === "DIV" ? part.children : [part]).map((line) => line.textContent)));

  const scheduled = await loadAt(fetchWith(async () => ({ ok: true, text: async () => JSON.stringify(pace) })), AT);
  const unavailable = await loadAt(fetchWith(async () => { throw new Error("down"); }), AT);

  const featurePriority = "Priority 1 of 2 · value for size: value 8, size 2";
  const soloPriority = "Priority 2 of 2 · value for size: value 5, size 3";
  const sequence = (n) => `Sequence ${n} of 3 · the order the work follows`;
  const hours = "About 2 working hours left (85% likely)";
  assert.deepEqual(cardLines(scheduled), [
    ["About 2 working hours left in total (85% likely)", featurePriority],
    [sequence(1), hours, "Part 1 of 2, next"],
    [sequence(2), hours, "Part 2 of 2, next"],
    [sequence(3), hours, soloPriority],
  ]);
  const gone = "Forecast unavailable: the pace file could not be loaded.";
  assert.deepEqual(cardLines(unavailable), [
    [gone, featurePriority],
    [gone, "Part 1 of 2, next"],
    [gone, "Part 2 of 2, next"],
    [gone, soloPriority],
  ]);
  const readAt = readAtOf(scheduled).textContent.replace(/^Roadmap read at [^·]*?(?= · |$)/, "Roadmap read at T");
  assert.equal(readAt, `Roadmap read at T · Last estimate change by ${HOSTILE} on 2026-11-01`);
  assert.deepEqual(allElements(scheduled).filter((element) => element.tagName === "IMG"), []);

  const solved = { doneOn: "2026-10-30", confirmedBy: "Willem" };
  const features = [
    entry("up-001", null, 1, "next"), entry("up-002", "up-001", 1, "done", solved), entry("up-003", "up-001", 2, "next"),
    entry("up-004", null, 2, "next"), entry("up-005", "up-004", 1, "next"), entry("up-006", "up-004", 2, "next"),
  ];
  const featureLog = features.map(({ id, status }) => JSON.stringify(logLine(id, "coach-add", status))).join("\n");
  const featureFetch = async (path) => (path.endsWith("roadmap.json") ? { ok: true, text: async () => JSON.stringify({ ...roadmap, wipLimit: 4, problems: features }) } : { ok: true, text: async () => featureLog });
  const featureCards = allElements(treeOf((await loadAt(featureFetch, AT)))).filter((element) => element.tagName === "LI")
    .map((item) => item.children[0]).filter((card) => card.children.length > 1);
  const labelled = (card) => [card.attributes["data-status"], card.children[0].textContent];
  assert.deepEqual([featureCards[0], featureCards[3]].map(labelled), [["paused", "Paused, 1 of 2 parts solved⏸"], ["next", "Next"]]);
});

test("a next feature with one done and one next part shows Paused as its label with 1 of 2 parts solved hidden", async () => {
  const entry = (id, parent, order, status, solved = {}) => ({ ...roadmap.problems[0], id, parent, order, status, ...solved });
  const problems = [
    entry("up-001", null, 1, "next"),
    entry("up-002", "up-001", 1, "done", { doneOn: "2026-10-30", confirmedBy: "Willem" }),
    entry("up-003", "up-001", 2, "next"),
  ];
  const logText = problems.map(({ id, status }) => JSON.stringify(logLine(id, "coach-add", status))).join("\n");
  const fetch = async (path) => (path.endsWith("roadmap.json") ? { ok: true, text: async () => JSON.stringify({ ...roadmap, wipLimit: 4, problems }) } : { ok: true, text: async () => logText });

  const { shown } = await load(fetch);

  const feature = allElements(treeOf(shown)).find((element) => element.tagName === "LI");
  const label = feature.children[0].children[0];
  assert.deepEqual([label.textContent, label.children[0].textContent], ["Paused, 1 of 2 parts solved⏸", ", 1 of 2 parts solved"]);
});

test("after a load a parent card shows the state its parts give it, not its own status", async () => {
  const entry = (id, parent, order, status, fields = {}) => ({ ...roadmap.problems[0], id, parent, order, status, ...fields });
  const problems = [
    entry("up-001", null, 1, "now"),
    entry("up-002", "up-001", 1, "blocked", { waitingOn: "a Pages account" }),
    entry("up-003", "up-001", 2, "next"),
  ];
  const logText = problems.map(({ id, status }) => JSON.stringify(logLine(id, "coach-add", status))).join("\n");
  const fetch = async (path) => (path.endsWith("roadmap.json") ? { ok: true, text: async () => JSON.stringify({ ...roadmap, wipLimit: 4, problems }) } : { ok: true, text: async () => logText });

  const { shown } = await load(fetch);

  const parent = allElements(treeOf(shown)).find((element) => element.tagName === "LI").children[0];
  assert.deepEqual([parent.attributes["data-status"], parent.children[0].textContent], ["blocked", "Waiting"]);
});

const nestedPulseServing = (log) => {
  const child = { ...roadmap.problems[0], id: "up-003", parent: "up-001", problem: "Pulse the card", order: 1 };
  const nested = { ...roadmap, problems: [...roadmap.problems, child] };
  const nestedLog = `${log}\n${JSON.stringify(logLine("up-003", "coach-add", "now"))}`;
  return async (path) => (path.endsWith("roadmap.json")
    ? { ok: true, text: async () => JSON.stringify(nested) }
    : servingLog(nestedLog)(path));
};
const pulsingCards = (shown) => allElements(shown)
  .filter((element) => element.attributes["data-status"] !== undefined && "data-pulse" in element.attributes)
  .map((card) => card.textContent);

test("after a load the innermost now card carries data-pulse and its now parent does not", async () => {
  const { shown } = await load(nestedPulseServing(seededLogText));

  const pulsing = pulsingCards(shown);
  assert.equal(pulsing.length, 1, `pulsing cards: ${JSON.stringify(pulsing)}`);
  assert.ok(pulsing[0].includes("Pulse the card"));
});

test("a load of a stale roadmap pulses no card", async () => {
  const { shown } = await load(nestedPulseServing(staleLogText));

  assert.deepEqual(pulsingCards(shown), []);
});

test("fileSource reads the roadmap, its decision log and the pace file as one frozen snapshot", async () => {
  const source = fileSource(async (path) => ({ ok: true, text: async () => `text of ${path}` }));

  const snapshot = await source.read();

  assert.deepEqual(snapshot, { roadmapText: "text of roadmap/roadmap.json", logText: "text of roadmap/decisions.jsonl", paceText: "text of roadmap/pace.json" });
  assert.equal(Object.isFrozen(snapshot), true);
});

test("fileSource with a root reads that root's three files, and with no root reads roadmap/", async () => {
  const fetched = [];
  const recordingFetch = async (path) => { fetched.push(path); return { ok: true, text: async () => "" }; };

  await fileSource(recordingFetch, "products/p/roadmap").read();
  const rooted = fetched.splice(0);
  await fileSource(recordingFetch).read();

  assert.deepEqual(rooted, ["products/p/roadmap/roadmap.json", "products/p/roadmap/decisions.jsonl", "products/p/roadmap/pace.json"]);
  assert.deepEqual(fetched, ["roadmap/roadmap.json", "roadmap/decisions.jsonl", "roadmap/pace.json"]);
});

test("showRoadmap leaves the read-at line out of its view and renderReadAt returns it", async () => {
  const { shown } = await load(okFetch);

  const line = renderReadAt(createFakeDocument(), AT, []);

  assert.equal(allElements(shown).some((part) => /^Roadmap read at /.test(part.textContent)), false);
  assert.match(line.textContent, /^Roadmap read at /);
});

test("createReadAtStatus keeps role status while its text goes read-at, failure text, read-at again", () => {
  const status = createReadAtStatus(createFakeDocument());
  const time = new Date(AT).toLocaleTimeString();
  const states = [];

  states.push([status.element.attributes.role, status.element.textContent]);
  status.showRead(AT, []);
  states.push([status.element.attributes.role, status.element.textContent]);
  status.showFailure();
  states.push([status.element.attributes.role, status.element.textContent]);
  status.showRead(AT, []);
  states.push([status.element.attributes.role, status.element.textContent]);

  assert.deepEqual(states, [
    ["status", ""],
    ["status", `Roadmap read at ${time}`],
    ["status", `Could not refresh; showing the roadmap read at ${time}`],
    ["status", `Roadmap read at ${time}`],
  ]);
});

test("createReadAtStatus shows the latest read time in the failure text after two reads", () => {
  const status = createReadAtStatus(createFakeDocument());
  const firstRead = "2026-11-01T12:00:00Z";
  const secondRead = "2026-11-01T13:05:09Z";

  status.showRead(firstRead, []);
  status.showRead(secondRead, []);
  status.showFailure();

  assert.equal(status.element.textContent, `Could not refresh; showing the roadmap read at ${new Date(secondRead).toLocaleTimeString()}`);
  assert.notEqual(new Date(firstRead).toLocaleTimeString(), new Date(secondRead).toLocaleTimeString());
});

test("createReadAtStatus says no roadmap has been read yet when it fails before any read, and shows the read time once there is one", () => {
  const status = createReadAtStatus(createFakeDocument());
  const readTime = "2026-11-01T14:07:03Z";
  const texts = [];

  status.showFailure();
  texts.push(status.element.textContent);
  status.showRead(readTime, []);
  status.showFailure();
  texts.push(status.element.textContent);

  assert.deepEqual(texts, [
    "Could not refresh; no roadmap has been read yet",
    `Could not refresh; showing the roadmap read at ${new Date(readTime).toLocaleTimeString()}`,
  ]);
});

test("an empty decision log shows no Recent decisions section", async () => {
  const { shown } = await load(servingLog(""));

  assert.equal(partNamed(shown, "Recent decisions"), undefined);
});

test("the page lists the newest decisions after the tree, under a Recent decisions heading, newest first", async () => {
  const log = [
    { at: "2026-11-01T09:00:00Z", problemId: "up-001", actor: "Product Coach", action: "coach-add", before: null, after: "now", why: "Seeded" },
    { at: "2026-11-01T11:00:00Z", problemId: "up-002", actor: "Tech Coach", action: "coach-add", before: null, after: "next", why: "Seeded" },
  ].map((line) => JSON.stringify(line)).join("\n");

  const { shown } = await load(servingLog(log));

  const recent = partNamed(shown, "Recent decisions");
  assert.ok(shown.children.indexOf(recent) > shown.children.indexOf(treeOf(shown)));
  assert.equal(recent.children[0].tagName, "H2");
  assert.equal(recent.children[0].textContent, "Recent decisions");
  assert.deepEqual(allElements(recent).filter((element) => element.tagName === "LI").map((item) => item.textContent), [
    "Tech Coach added “Peek under the hood” as next, 1 hour ago",
    "Product Coach added “See where we are” as now, 3 hours ago",
  ]);
});
