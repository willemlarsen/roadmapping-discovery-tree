import { test } from "node:test";
import assert from "node:assert/strict";
import { renderWip } from "../src/render.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const wipWords = (status) => renderWip(status, createFakeDocument()).textContent;

test("renderWip says nothing is in progress when the count is zero", () => {
  assert.equal(wipWords({ count: 0, limit: 1 }), "Nothing in progress");
});

test("renderWip marks only an over-the-limit line as an alert", () => {
  const roleOf = (status) => renderWip(status, createFakeDocument()).attributes.role;

  const roles = [roleOf({ count: 2, limit: 1 }), roleOf({ count: 1, limit: 1 }), roleOf({ count: 0, limit: 1 })];

  assert.deepEqual(roles, ["alert", undefined, undefined]);
});

test("renderWip says the count over the limit in one sentence with a single colon-free phrase", () => {
  assert.equal(wipWords({ count: 2, limit: 1 }), "Work in progress 2 of 1, over the limit");
});
