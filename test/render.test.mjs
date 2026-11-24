import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMotionToggle, renderParked, renderTree } from "../src/render.js";
import { buildTree } from "../src/tree.js";
import { createFakeDocument, allElements } from "./support/fake-dom.mjs";
import { estimateFor, UNRANKED } from "./support/words.mjs";
import { validPace } from "./support/pace.mjs";

const attackPayloads = [
  "<script>alert('pwned')</script>",
  "<img src=x onerror=alert(1)>",
  "<a href=\"javascript:alert(1)\">click</a>",
];

const attackTree = {
  goal: attackPayloads[0],
  children: attackPayloads.map((payload, index) => ({
    id: `up-${index}`, problem: payload, status: "next", order: index + 1, children: [],
  })),
};

const nestedTree = {
  goal: "Willem always knows where we are",
  children: [
    { id: "up-001", problem: "See where we are", status: "now", order: 1, children: [
      { id: "up-003", problem: "Agree how it looks", status: "next", order: 1, children: [] },
    ] },
    { id: "up-002", problem: "Peek under the hood", status: "next", order: 2, children: [] },
  ],
};

const render = (tree) => renderTree(tree, createFakeDocument());
const cardTexts = (item) => item.children[0].children.map((part) => part.textContent);
const forecastTexts = (item) => item.children[0].children.slice(2).flatMap((group) => group.children.map((line) => line.textContent));

test("renderTree shows markup in problems as literal text", () => {
  const texts = allElements(render(attackTree)).map((element) => element.textContent);

  attackPayloads.forEach((payload) => assert.ok(texts.includes(payload), `missing literal text: ${payload}`));
});

test("renderTree creates no elements from markup in problems", () => {
  const tags = allElements(render(attackTree)).map((element) => element.tagName);

  assert.deepEqual(tags.filter((tag) => ["SCRIPT", "IMG", "A"].includes(tag)), []);
});

test("renderTree creates no event, link or source attributes from markup in problems", () => {
  const names = allElements(render(attackTree)).flatMap((element) => Object.keys(element.attributes));

  assert.deepEqual(names.filter((name) => /^on|^href$|^src$/.test(name)), []);
});

test("renderTree returns a section labelled Roadmap", () => {
  const root = render(nestedTree);

  assert.deepEqual([root.tagName, root.attributes["aria-label"]], ["SECTION", "Roadmap"]);
});

test("renderTree shows the goal as the heading", () => {
  const [heading] = render(nestedTree).children;

  assert.deepEqual([heading.tagName, heading.textContent], ["H1", "Willem always knows where we are"]);
});

test("renderTree lists top-level problems as items of a list", () => {
  const topList = render(nestedTree).children[1];

  assert.deepEqual([topList.tagName, ...topList.children.map((item) => item.tagName)], ["UL", "LI", "LI"]);
});

test("renderTree nests child problems in a list inside their parent's item", () => {
  const nestedList = render(nestedTree).children[1].children[0].children[1];

  assert.deepEqual(cardTexts(nestedList.children[0]), ["Next", "Agree how it looks"]);
});

test("renderTree gives a leaf card no empty nested list", () => {
  const leafItem = render(nestedTree).children[1].children[1];

  assert.equal(leafItem.children.length, 1);
});

test("renderTree writes the status in words on a card", () => {
  const firstItem = render(nestedTree).children[1].children[0];

  assert.deepEqual(cardTexts(firstItem), ["Solving now", "See where we are"]);
});

test("siblings appear in DOM order by ascending data-order", () => {
  const roadmap = {
    goal: "Willem always knows where we are",
    problems: [3, 1, 2].map((order) => ({ id: `up-00${order}`, parent: null, order, problem: `Problem ${order}`, status: "next" })),
  };

  const topList = renderTree(buildTree(roadmap), createFakeDocument()).children[1];

  assert.deepEqual(
    topList.children.map((item) => [item.attributes["data-order"], cardTexts(item)[1]]),
    [["1", "Problem 1"], ["2", "Problem 2"], ["3", "Problem 3"]],
  );
});

test("renderTree gives each now and next card its own likely-done range and a done card none", () => {
  const tree = {
    goal: "Willem always knows where we are",
    children: [
      { id: "up-001", problem: "See where we are", status: "now", order: 1, children: [
        { id: "up-003", problem: "Agree how it looks", status: "done", order: 1, children: [] },
      ] },
      { id: "up-002", problem: "Peek under the hood", status: "next", order: 2, children: [] },
    ],
  };
  const forecast = { state: "ok", pace: validPace() };

  const topList = renderTree(tree, createFakeDocument(), { forecast }).children[1];

  const [nowItem, nextItem] = topList.children;
  const doneItem = nowItem.children[1].children[0];
  assert.deepEqual([nowItem, nextItem, doneItem].map(forecastTexts),
    [["Sequence 1 of 2 \u00b7 the order the work follows", "About 2 working hours left (85% likely)"], ["Sequence 2 of 2 \u00b7 the order the work follows", "About 3 working hours left (85% likely)"], []]);
});

test("renderTree labels each range an estimate with the card's remaining-cycle assumption and the planning-safe end", () => {
  const [first, second] = validPace().results;
  const fixedCounts = { ...validPace().inputs, sizeSamples: [] };
  const pace = validPace({ inputs: fixedCounts, results: [{ ...first, remainingCycles: 7 }, { ...second, remainingCycles: 12 }] });
  const tree = {
    goal: "Willem always knows where we are",
    children: [
      { id: "up-001", problem: "See where we are", status: "now", order: 1, children: [] },
      { id: "up-002", problem: "Peek under the hood", status: "next", order: 2, children: [] },
    ],
  };

  const topList = renderTree(tree, createFakeDocument(), { forecast: { state: "ok", pace } }).children[1];

  assert.deepEqual(topList.children.map((item) => forecastTexts(item)[2]), [
    estimateFor(7),
    estimateFor(12),
  ]);
});

test("renderTree marks each forecast card unranked until value and size exist", () => {
  const tree = {
    goal: "Willem always knows where we are",
    children: [
      { id: "up-001", problem: "See where we are", status: "now", order: 1, children: [] },
      { id: "up-002", problem: "Peek under the hood", status: "next", order: 2, children: [] },
    ],
  };

  const cardLines = new Map([["up-001", UNRANKED], ["up-002", UNRANKED]]);

  const topList = renderTree(tree, createFakeDocument(), { forecast: { state: "ok", pace: validPace() }, cardLines }).children[1];

  assert.deepEqual(topList.children.map((item) => item.children[0].children.filter((part) => part.tagName === "P").map((line) => line.textContent)),
    [[UNRANKED], [UNRANKED]]);
});

test("renderTree puts a card's forecast in one labelled group after its status and problem, with meaning in words and no styling attributes", () => {
  const tree = {
    goal: "Willem always knows where we are",
    children: [{ id: "up-001", problem: "See where we are", status: "now", order: 1, children: [] }],
  };
  const forecasts = [{ state: "ok", pace: validPace() }, { state: "stale" }];

  const roots = forecasts.map((forecast) => renderTree(tree, createFakeDocument(), { forecast, cardLines: new Map([["up-001", UNRANKED]]) }));

  const cards = roots.map((root) => root.children[1].children[0].children[0]);
  assert.deepEqual(cards.map((card) => card.children.map((part) => part.tagName)), [["SPAN", "SPAN", "DIV", "P"], ["SPAN", "SPAN", "DIV", "P"]]);
  assert.deepEqual(cards.map((card) => [card.children[2].attributes.role, card.children[2].attributes["aria-label"]]),
    [["group", "Forecast"], ["group", "Forecast"]]);
  assert.deepEqual(cards.map((card) => card.children[2].children.map((line) => line.tagName)),
    [["SPAN", "SPAN"], ["SPAN"]]);
  assert.deepEqual(cards[1].children[2].children.map((line) => line.textContent), ["Forecast unavailable: the pace file is out of date."]);
  const attributeNames = roots.flatMap((root) => allElements(root)).flatMap((element) => Object.keys(element.attributes));
  assert.deepEqual(attributeNames.filter((name) => name === "style" || name === "class"), []);
});

test("renderTree gives a done card Solved, a check mark and its done date", () => {
  const done = { id: "up-011", problem: "Know the real problem", status: "done", order: 1, doneOn: "2026-10-27", children: [] };

  const item = render({ goal: "Goal", children: [done] }).children[1].children[0];

  assert.deepEqual(cardTexts(item), ["Solved ✓ 2026-10-27", "Know the real problem"]);
});

test("renderTree puts each card's status in a data-status attribute for styling", () => {
  const items = render(nestedTree).children[1].children;

  assert.deepEqual(items.map((item) => item.children[0].attributes["data-status"]), ["now", "next"]);
});

test("renderTree shows a card's state from view.shown, in its words and its data-status, over its own status", () => {
  const view = { shown: new Map([["up-001", "next"], ["up-003", "next"], ["up-002", "next"]]) };

  const items = renderTree(nestedTree, createFakeDocument(), view).children[1].children;

  assert.deepEqual(items.map((item) => [item.children[0].attributes["data-status"], item.children[0].children[0].textContent]), [["next", "Next"], ["next", "Next"]]);
});

test("renderTree words a state shown from a card's parts without the details its own status would carry", () => {
  const next = (id, order) => ({ id, problem: `Problem ${id}`, status: "next", order, children: [] });
  const view = { shown: new Map([["up-001", "blocked"], ["up-002", "done"], ["up-003", "parked"]]) };

  const items = renderTree({ goal: "Goal", children: [next("up-001", 1), next("up-002", 2), next("up-003", 3)] }, createFakeDocument(), view).children[1].children;

  assert.deepEqual(items.map((item) => item.children[0].children[0].textContent), ["Waiting", "Solved ✓", "Parked"]);
});

test("renderTree stamps data-started on a card in view.started and on no other card", () => {
  const view = { started: new Map([["up-001", "1 of 2 parts solved"]]) };

  const items = renderTree(nestedTree, createFakeDocument(), view).children[1].children;

  assert.deepEqual(items.map((item) => item.children[0].attributes["data-started"]), ["", undefined]);
});

test("renderTree labels a started card Started with the part count in a visually hidden span", () => {
  const next = (id, order) => ({ id, problem: `Problem ${id}`, status: "next", order, children: [] });
  const view = { started: new Map([["up-001", "1 of 2 parts solved"]]) };

  const items = renderTree({ goal: "Goal", children: [next("up-001", 1), next("up-002", 2)] }, createFakeDocument(), view).children[1].children;

  const labels = items.map((item) => item.children[0].children[0]);
  assert.deepEqual(labels.map((label) => label.textContent), ["Started, 1 of 2 parts solved", "Next"]);
  assert.deepEqual(labels.map((label) => label.children.map((hidden) => [hidden.attributes["data-visually-hidden"], hidden.textContent])), [[["", ", 1 of 2 parts solved"]], []]);
});

test("renderTree gives a blocked card the words waiting on and what it waits on", () => {
  const blocked = { id: "up-020", problem: "Ship the preview", status: "blocked", order: 1, waitingOn: "a Pages account", children: [] };

  const item = render({ goal: "Goal", children: [blocked] }).children[1].children[0];

  assert.deepEqual(cardTexts(item), ["Waiting on a Pages account", "Ship the preview"]);
});

test("renderTree gives a paused card the words resumes after and the text of the problem it resumes after", () => {
  const entry = (fields) => ({ parent: null, resumesAfter: null, ...fields });
  const roadmap = { goal: "Goal", problems: [
    entry({ id: "up-030", problem: "Fix the build", status: "now", order: 1 }),
    entry({ id: "up-031", problem: "Polish the page", status: "paused", order: 2, resumesAfter: "up-030" }),
  ] };

  const items = render(buildTree(roadmap)).children[1].children;

  assert.deepEqual(cardTexts(items[1]), ["Resumes after Fix the build⏸", "Polish the page"]);
});

test("renderTree gives a paused card's label a pause mark named Paused, and a next card's label none", () => {
  const entry = (fields) => ({ parent: null, resumesAfter: null, ...fields });
  const roadmap = { goal: "Goal", problems: [
    entry({ id: "up-030", problem: "Fix the build", status: "next", order: 1 }),
    entry({ id: "up-031", problem: "Polish the page", status: "paused", order: 2, resumesAfter: "up-030" }),
  ] };

  const [next, paused] = render(buildTree(roadmap)).children[1].children;

  const labelMarks = [next, paused].map((item) => item.children[0].children[0].children.map((mark) => [mark.textContent, mark.attributes.role, mark.attributes["aria-label"]]));
  assert.deepEqual(labelMarks, [[], [["⏸", "img", "Paused"]]]);
});

test("renderTree gives a merged card the words merged, awaiting check", () => {
  const merged = { id: "up-040", problem: "Check the preview", status: "merged", order: 1, children: [] };

  const item = render({ goal: "Goal", children: [merged] }).children[1].children[0];

  assert.deepEqual(cardTexts(item), ["Merged, awaiting check", "Check the preview"]);
});

test("renderTree warns on a done card that still has an open part, and on no other card", () => {
  const done = { id: "up-050", problem: "Whole thing", status: "done", order: 1, doneOn: "2026-10-27", children: [], doneWithOpenChild: true };
  const closed = { id: "up-051", problem: "Finished thing", status: "done", order: 2, doneOn: "2026-10-28", children: [], doneWithOpenChild: false };

  const [flagged, clean] = render({ goal: "Goal", children: [done, closed] }).children[1].children;

  assert.deepEqual([cardTexts(flagged), cardTexts(clean)], [
    ["Solved ✓ 2026-10-27", "Whole thing", "Marked solved, but a part is not solved yet"],
    ["Solved ✓ 2026-10-28", "Finished thing"],
  ]);
});

test("renderParked starts the region with a visible heading that names it", () => {
  const tree = { parked: [{ problem: "Share the roadmap with a guest" }] };

  const region = renderParked(tree, createFakeDocument());

  const [heading, list] = region.children;
  assert.deepEqual([heading.tagName, heading.textContent, list.tagName], ["H2", "Parked for later", "UL"]);
});

test("renderMotionToggle returns a button named Pause motion that is not pressed", () => {
  const document = createFakeDocument();

  const button = renderMotionToggle(document, () => {});

  assert.deepEqual(
    [button.tagName, button.textContent, button.attributes["aria-pressed"]],
    ["BUTTON", "Pause motion", "false"],
  );
});

test("renderMotionToggle pressed once sets aria-pressed true and tells onChange off", () => {
  const document = createFakeDocument();
  const states = [];
  const button = renderMotionToggle(document, (state) => states.push(state));

  button.click();

  assert.deepEqual([button.attributes["aria-pressed"], states], ["true", ["off"]]);
});

test("renderMotionToggle pressed twice sets aria-pressed back to false and tells onChange on", () => {
  const document = createFakeDocument();
  const states = [];
  const button = renderMotionToggle(document, (state) => states.push(state));

  button.click();
  button.click();

  assert.deepEqual([button.attributes["aria-pressed"], states], ["false", ["off", "on"]]);
});

test("renderMotionToggle returns null when the button cannot listen for events", () => {
  const fake = createFakeDocument();
  const document = {
    createElement: (tagName) => {
      const { addEventListener, ...element } = fake.createElement(tagName);
      return element;
    },
  };

  const button = renderMotionToggle(document, () => {});

  assert.equal(button, null);
});
