import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPortfolio } from "../src/render.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const outline = (item) => item.children.map((child) => `${child.tagName} ${child.textContent}`);

test("renderPortfolio draws one list item per product with name, goal and status words for each state, and one message for a registry failure", () => {
  const results = [
    { id: "a", name: "Alpha", goal: "Alpha goal", state: "ok", solving: { cards: ["Find the pulse", "Fix the gate"] } },
    { id: "b", name: "Beta", goal: "Beta goal", state: "ok", solving: { none: true } },
    { id: "c", name: "Gamma", goal: "Gamma goal", state: "stale", solving: { stale: true } },
    { id: "d", name: "Delta", state: "unavailable" },
  ];

  const list = renderPortfolio(createFakeDocument(), results);
  const failure = renderPortfolio(createFakeDocument(), [{ failure: "registry_invalid" }]);

  assert.equal(list.tagName, "UL");
  assert.deepEqual(list.children.map((item) => item.tagName), ["LI", "LI", "LI", "LI"]);
  assert.deepEqual(list.children.map(outline), [
    ["H2 Alpha", "P Alpha goal", "P Solving now: Find the pulse; Fix the gate"],
    ["H2 Beta", "P Beta goal", "P Nothing is being solved now"],
    ["H2 Gamma", "P Gamma goal", "P Roadmap is stale"],
    ["H2 Delta", "P This product's roadmap could not be read"],
  ]);
  assert.equal(failure.textContent, "The portfolio list could not be read");
  assert.equal(failure.children.length, 0);
});

test("renderPortfolio with no products draws one message and does not throw, while one product still draws a list", () => {
  const one = [{ id: "a", name: "Alpha", goal: "Alpha goal", state: "ok", solving: { none: true } }];

  const empty = renderPortfolio(createFakeDocument(), []);
  const single = renderPortfolio(createFakeDocument(), one);

  assert.equal(empty.tagName, "P");
  assert.equal(empty.textContent, "No products are in active building");
  assert.equal(single.tagName, "UL");
  assert.equal(single.children.length, 1);
});
