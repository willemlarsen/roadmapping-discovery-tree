import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMotion, mountMotionToggle } from "../src/motion.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const fakeRoot = () => {
  const attributes = {};
  return {
    attributes,
    setAttribute: (name, value) => { attributes[name] = String(value); },
    removeAttribute: (name) => { delete attributes[name]; },
  };
};

test("applyMotion off sets data-motion off on the root", () => {
  const paused = fakeRoot();
  const running = fakeRoot();

  applyMotion(paused, "off");
  applyMotion(running, "on");

  assert.equal(paused.attributes["data-motion"], "off");
  assert.equal("data-motion" in running.attributes, false);
});

test("mountMotionToggle turns motion off and appends nothing when the toggle cannot be made", () => {
  const fake = createFakeDocument();
  const withoutListeners = { documentElement: fakeRoot(), createElement: (tagName) => {
    const { addEventListener, ...element } = fake.createElement(tagName);
    return element;
  } };
  const withListeners = { documentElement: fakeRoot(), createElement: fake.createElement };
  const stuck = fake.createElement("main");
  const working = fake.createElement("main");

  mountMotionToggle(withoutListeners, stuck);
  mountMotionToggle(withListeners, working);

  assert.deepEqual(
    [stuck.children.length, withoutListeners.documentElement.attributes["data-motion"]],
    [0, "off"],
  );
  assert.deepEqual(
    [working.children.length, "data-motion" in withListeners.documentElement.attributes],
    [1, false],
  );
});
