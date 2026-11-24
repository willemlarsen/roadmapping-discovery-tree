import { forecastLines, inputLines } from "./pace/lines.js";
import { productHref, statusWords as portfolioStatusWords } from "./portfolio.js";

const STATUS_LINES = {
  now: () => "Solving now",
  next: () => "Next",
  done: (node) => (node.doneOn ? `Solved ✓ ${node.doneOn}` : "Solved ✓"),
  blocked: (node) => (node.waitingOn ? `Waiting on ${node.waitingOn}` : "Waiting"),
  merged: () => "Merged, awaiting check",
  parked: () => "Parked",
  paused: (node) => (node.resumesAfterProblem ? `Resumes after ${node.resumesAfterProblem}` : "Paused"),
};

export function renderTree(tree, document, view = {}) {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Roadmap");
  root.appendChild(textElement(document, "h1", tree.goal));
  root.appendChild(cardTreeScroller(document, renderList(tree.children, document, view)));
  return root;
}

// The only part of the page that scrolls sideways: a tree wider than the window scrolls inside
// it, so the heading and everything above stay put. Tab reaches it; the arrow keys scroll it.
function cardTreeScroller(document, list) {
  const scroller = document.createElement("div");
  scroller.setAttribute("role", "region");
  scroller.setAttribute("aria-label", "Card tree");
  scroller.setAttribute("tabindex", "0");
  scroller.appendChild(list);
  return scroller;
}

export function renderPortfolio(document, results) {
  if (results.length === 0) return textElement(document, "p", "No products are in active building");
  if (results[0].failure) return textElement(document, "p", "The portfolio list could not be read");
  const list = document.createElement("ul");
  results.forEach((result) => list.appendChild(renderProduct(document, result)));
  return list;
}

function productHeading(document, result) {
  const heading = document.createElement("h2");
  const link = textElement(document, "a", result.name);
  link.setAttribute("href", productHref(result.id));
  heading.appendChild(link);
  return heading;
}

function renderProduct(document, result) {
  const item = document.createElement("li");
  item.appendChild(productHeading(document, result));
  if (result.state !== "unavailable") item.appendChild(textElement(document, "p", result.goal));
  item.appendChild(textElement(document, "p", portfolioStatusWords(result)));
  return item;
}

export function renderForecastInputs(forecast, document) {
  if (!forecast.pace) return null;
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Forecast inputs");
  const list = document.createElement("ul");
  inputLines(forecast.pace).forEach((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    list.appendChild(item);
  });
  section.appendChild(list);
  return section;
}

export function renderWip({ count, limit }, document) {
  if (count === 0) return textElement(document, "p", "Nothing in progress");
  if (count <= limit) return textElement(document, "p", `Work in progress ${count} of ${limit}`);
  const warning = textElement(document, "p", `Work in progress ${count} of ${limit}, over the limit`);
  warning.setAttribute("role", "alert");
  return warning;
}

export function renderMotionToggle(document, onChange) {
  const button = textElement(document, "button", "Pause motion");
  if (typeof button.addEventListener !== "function") return null;
  button.setAttribute("aria-pressed", "false");
  let paused = false;
  button.addEventListener("click", () => {
    paused = !paused;
    button.setAttribute("aria-pressed", String(paused));
    onChange(paused ? "off" : "on");
  });
  return button;
}

export function renderStaleness({ days, stale }, document) {
  if (!stale) return null;
  const warning = textElement(document, "div", `This roadmap may be out of date: last re-ranked or worked on ${days} days ago`);
  warning.setAttribute("role", "alert");
  return warning;
}

// What each state means, in the order a card moves through them. The guide names each state
// in the words a card with no details of its own shows.
const STATE_MEANINGS = [
  ["now", "work on it is under way."],
  ["next", "not started yet; it waits its turn."],
  ["blocked", "held up by something outside it, named on the card when it is known."],
  ["paused", "work started and stopped; the card says what it resumes after when it is known."],
  ["merged", "the work is in and waits for someone to confirm it solves the problem."],
  ["done", "confirmed solved."],
  ["parked", "set aside for later, and listed under the tree."],
];

const PARENT_STATE_WORDS = "A card with parts shows the state its parts give it: in progress if any part is, otherwise waiting if any part is blocked, and solved only when every part is.";

const FORECAST_NOTE = "“85% likely” means 85 in 100 simulated runs of the work ahead, at the pace measured from this repository's history, finished the card within that many working hours, counted from now.";

const DECISION_LOG_WORDS = "Every change to the roadmap is written to its decision log, with who made it and why. The line at the top of the page names the last re-rank and the last estimate change.";

export function renderReadingGuide(document, { freshness, forecasted }) {
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Reading guide");
  section.appendChild(textElement(document, "p", freshness));
  const details = document.createElement("details");
  details.appendChild(textElement(document, "summary", "How to read this roadmap"));
  details.appendChild(stateList(document));
  details.appendChild(textElement(document, "p", PARENT_STATE_WORDS));
  if (forecasted) details.appendChild(textElement(document, "p", FORECAST_NOTE));
  details.appendChild(textElement(document, "p", DECISION_LOG_WORDS));
  section.appendChild(details);
  return section;
}

function stateList(document) {
  const list = document.createElement("ul");
  STATE_MEANINGS.forEach(([state, meaning]) => list.appendChild(textElement(document, "li", `${STATUS_LINES[state]({})}: ${meaning}`)));
  return list;
}

export function renderParked(tree, document) {
  if (tree.parked.length === 0) return null;
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Parked for later");
  section.appendChild(textElement(document, "h2", "Parked for later"));
  const list = document.createElement("ul");
  tree.parked.forEach((node) => list.appendChild(textElement(document, "li", node.problem)));
  section.appendChild(list);
  return section;
}

function renderList(nodes, document, view) {
  const list = document.createElement("ul");
  nodes.forEach((node) => list.appendChild(renderNode(node, document, view)));
  return list;
}

function renderNode(node, document, view) {
  const item = document.createElement("li");
  item.setAttribute("data-order", node.order);
  item.appendChild(renderCard(node, document, view));
  if (node.children.length > 0) item.appendChild(renderList(node.children, document, view));
  return item;
}

function renderCard(node, document, view) {
  const card = document.createElement("div");
  stampCard(card, node, view);
  card.appendChild(renderLabel(node, document, view));
  card.appendChild(textElement(document, "span", node.problem));
  if (node.doneWithOpenChild) card.appendChild(textElement(document, "span", "Marked solved, but a part is not solved yet"));
  const lines = forecastLines(node, view.forecast ?? null);
  if (lines.length > 0) card.appendChild(forecastGroup(lines, document));
  const rank = view.cardLines?.get(node.id) ?? null;
  if (rank !== null) card.appendChild(textElement(document, "p", rank));
  return card;
}

function shownState(node, view) {
  return view.shown?.get(node.id) ?? node.status;
}

function stampCard(card, node, view) {
  card.setAttribute("data-status", shownState(node, view));
  if (view.pulsing?.has(node.id)) card.setAttribute("data-pulse", "");
}

function renderLabel(node, document, view) {
  const label = textElement(document, "span", STATUS_LINES[shownState(node, view)](node));
  const startedWords = view.started?.get(node.id);
  if (startedWords !== undefined) label.appendChild(hiddenText(document, `, ${startedWords}`));
  if (shownState(node, view) === "paused") label.appendChild(pauseMark(document));
  return label;
}

function hiddenText(document, text) {
  const hidden = textElement(document, "span", text);
  hidden.setAttribute("data-visually-hidden", "");
  return hidden;
}

function pauseMark(document) {
  const mark = textElement(document, "span", "\u23F8");
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", "Paused");
  return mark;
}

function forecastGroup(lines, document) {
  const group = document.createElement("div");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Forecast");
  lines.forEach((line) => group.appendChild(textElement(document, "span", line)));
  return group;
}

function textElement(document, tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}
