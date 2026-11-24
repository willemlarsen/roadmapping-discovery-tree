import { forecastLines, inputLines } from "./pace/lines.js";
import { productHref, statusWords as portfolioStatusWords } from "./portfolio.js";

const STATUS_LINES = {
  now: () => "Solving now",
  next: () => "Next",
  done: (node) => `Solved ✓ ${node.doneOn}`,
  blocked: (node) => `Waiting on ${node.waitingOn}`,
  merged: () => "Merged, awaiting check",
  paused: (node) => `Resumes after ${node.resumesAfterProblem}`,
};
export function renderTree(tree, document, view = {}) {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Roadmap");
  root.appendChild(textElement(document, "h1", tree.goal));
  root.appendChild(renderList(tree.children, document, view));
  return root;
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
  if (view.started?.has(node.id)) card.setAttribute("data-started", "");
  if (view.pulsing?.has(node.id)) card.setAttribute("data-pulse", "");
}

function renderLabel(node, document, view) {
  const label = textElement(document, "span", statusWords(node, view));
  const startedWords = view.started?.get(node.id);
  if (startedWords !== undefined) label.appendChild(hiddenText(document, `, ${startedWords}`));
  if (node.status === "paused") label.appendChild(pauseMark(document));
  return label;
}

function statusWords(node, view) {
  return view.started?.has(node.id) ? "Started" : STATUS_LINES[shownState(node, view)](node);
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
