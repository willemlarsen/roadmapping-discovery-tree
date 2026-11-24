import { buildTree } from "./tree.js";
import { renderForecastInputs, renderParked, renderStaleness, renderTree, renderWip } from "./render.js";
import { wipStatus } from "./wip.js";
import { pulsingIds } from "./pulse.js";
import { staleness } from "./stale.js";
import { validateRoadmap } from "./validate.js";
import { deriveLastEstimate, deriveLastRerank, validateDecisionLog } from "./decisions.js";
import { forecastOf } from "./pace/forecast.js";
import { activeProblems } from "./pace/order.js";
import { rankProblems } from "./rank.js";
import { partLine, rankLine } from "./rank-words.js";
import { startedParts } from "./started-words.js";
import { displayedStates } from "./displayed-state.js";

const DEFAULT_ROOT = "roadmap";

const NOT_JSON = Symbol("not json");

const REASON_WORDS = {
  "fetch-failed": "The roadmap could not be loaded.",
  "invalid-json": "The roadmap file is not readable.",
  "invalid-schema": "The roadmap file has mistakes, so it is not shown.",
  "log-mismatch": "The roadmap and its decision log disagree, so it is not shown.",
};

export function fileSource(fetch, root = DEFAULT_ROOT) {
  return {
    async read() {
      const [roadmapText, logText, paceText] = await Promise.all([
        fetchText(fetch, `${root}/roadmap.json`), fetchText(fetch, `${root}/decisions.jsonl`), fetchText(fetch, `${root}/pace.json`),
      ]);
      return Object.freeze({ roadmapText, logText, paceText });
    },
  };
}

export async function showRoadmap(io) {
  return showSnapshot(await fileSource(io.fetch).read(), io);
}

export function showSnapshot({ roadmapText, logText, paceText }, io) {
  const loaded = readRoadmap(roadmapText, logText);
  return loaded.failure ? showFailure(loaded.failure, io) : showTree(loaded, viewOf(forecastOf(paceText, loaded.roadmap, io.now()), loaded.roadmap), io);
}

function viewOf(forecast, roadmap) {
  const sequence = activeProblems(roadmap.problems);
  const ranking = rankProblems(sequence);
  const cardLines = new Map(sequence.map((problem) => [problem.id, cardLineOf(problem, ranking, roadmap.problems)]));
  return Object.freeze({ forecast, ranking, cardLines, started: startedOf(roadmap.problems), shown: displayedStates(roadmap.problems) });
}

function startedOf(problems) {
  const words = problems.map((problem) => [problem.id, startedParts(problem, problems)]);
  return new Map(words.filter(([, parts]) => parts !== null));
}

function cardLineOf(problem, ranking, problems) {
  return problem.parent ? partLine(problem, problems) : rankLine(problem.id, ranking);
}

export function isValidSnapshot({ roadmapText, logText }) {
  return !readRoadmap(roadmapText, logText).failure;
}

export function readRoadmap(roadmapText, logText) {
  if (roadmapText === null || logText === null) return { failure: "fetch-failed" };
  const roadmap = parseJson(roadmapText);
  const entries = parseJsonLines(logText);
  if (roadmap === NOT_JSON || entries === NOT_JSON) return { failure: "invalid-json" };
  if (!validateRoadmap(roadmap).valid) return { failure: "invalid-schema" };
  if (!validateDecisionLog(entries, roadmap).valid) return { failure: "log-mismatch" };
  return { roadmap, entries };
}

function showTree({ roadmap, entries }, cardView, { document, emit, now, showReadAt }) {
  const { forecast } = cardView;
  const at = now();
  const lastRerank = deriveLastRerank(entries);
  const age = staleness(roadmap, at, lastRerank);
  emit({ event: "roadmap.load", at, outcome: "ok", reason: "none", problems: roadmap.problems.length, forecast: forecast.state, staleDays: age.days });
  const view = document.createElement("div");
  const tree = buildTree(roadmap);
  const pulsing = pulsingIds(roadmap, age.stale);
  appendIfShown(view, renderStaleness(age, document));
  view.appendChild(renderWip(wipStatus(roadmap), document));
  view.appendChild(renderTree(tree, document, { ...cardView, pulsing }));
  showReadAt(renderReadAt(document, at, entries), at, entries);
  appendIfShown(view, renderForecastInputs(forecast, document));
  appendIfShown(view, renderParked(tree, document));
  return view;
}

export function renderReadAt(document, at, entries) {
  const line = document.createElement("p");
  line.textContent = readAtWords(at, deriveLastRerank(entries), deriveLastEstimate(entries));
  return line;
}

export function createReadAtStatus(document) {
  const element = document.createElement("p");
  element.setAttribute("role", "status");
  let readAt = null;
  return {
    element,
    showRead(at, entries) {
      readAt = at;
      element.textContent = renderReadAt(document, at, entries).textContent;
    },
    showFailure() {
      if (readAt === null) {
        element.textContent = "Could not refresh; no roadmap has been read yet";
        return;
      }
      element.textContent = `Could not refresh; showing the roadmap read at ${new Date(readAt).toLocaleTimeString()}`;
    },
  };
}

function readAtWords(at, lastRerank, lastEstimate) {
  const read = `Roadmap read at ${new Date(at).toLocaleTimeString()}`;
  return [read, rerankWords(lastRerank), estimateWords(lastEstimate)].filter(Boolean).join(" \u00b7 ");
}

function rerankWords(lastRerank) {
  return lastRerank && `Last re-ranked by ${lastRerank.by} on ${lastRerank.at.slice(0, 10)}: ${lastRerank.why}`;
}

function estimateWords(lastEstimate) {
  return lastEstimate && `Last estimate change by ${lastEstimate.by} on ${lastEstimate.at.slice(0, 10)}`;
}

function appendIfShown(view, part) {
  if (part !== null) view.appendChild(part);
}

export async function fetchText(fetch, path) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

function parseJsonLines(text) {
  const entries = text.split("\n").filter((line) => line.trim() !== "").map(parseJson);
  return entries.includes(NOT_JSON) ? NOT_JSON : entries;
}

function showFailure(reason, { document, emit, now }) {
  emit({ event: "roadmap.load", at: now(), outcome: "failed", reason, problems: 0 });
  const banner = document.createElement("div");
  banner.setAttribute("role", "alert");
  banner.textContent = REASON_WORDS[reason];
  return banner;
}
