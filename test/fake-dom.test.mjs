import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument, ownText } from "./support/fake-dom.mjs";

// The setter only sets the element's own text; the clearing of children a real DOM does is not modelled.
test("fake DOM textContent is the element's own text followed by its children's textContent", () => {
  const document = createFakeDocument();
  const parent = document.createElement("span");
  const child = document.createElement("span");
  parent.textContent = "Started";
  child.textContent = ", x";
  parent.appendChild(child);

  const text = parent.textContent;

  assert.equal(text, "Started, x");
});

test("fake DOM ownText is the element's own text without its children's", () => {
  const document = createFakeDocument();
  const parent = document.createElement("span");
  const child = document.createElement("span");
  parent.textContent = "Started";
  child.textContent = ", x";
  parent.appendChild(child);

  const text = ownText(parent);

  assert.equal(text, "Started");
});

test("fake DOM click calls the listeners added for click in the order they were added", () => {
  const document = createFakeDocument();
  const button = document.createElement("button");
  const calls = [];
  button.addEventListener("click", () => calls.push("first"));
  button.addEventListener("click", () => calls.push("second"));

  button.click();

  assert.deepEqual(calls, ["first", "second"]);
});

test("fake DOM click does not call listeners added for another event type", () => {
  const document = createFakeDocument();
  const button = document.createElement("button");
  const calls = [];
  button.addEventListener("keydown", () => calls.push("keydown"));

  button.click();

  assert.deepEqual(calls, []);
});
