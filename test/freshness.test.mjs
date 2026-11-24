import { test } from "node:test";
import assert from "node:assert/strict";
import { freshnessLine } from "../src/freshness.js";

const NOW = "2026-11-20T12:00:00Z";
const entryAt = (at) => ({ at, problemId: "fx-1", actor: "Amal", action: "coach-status", before: "next", after: "now", why: "Started" });

test("freshnessLine counts whole days since the newest decision, wherever it sits in the log", () => {
  const entries = [entryAt("2026-11-10T09:00:00Z"), entryAt("2026-11-17T09:00:00Z"), entryAt("2026-11-12T09:00:00Z")];

  assert.equal(freshnessLine(entries, NOW), "Roadmap last changed 3 days ago");
});

test("freshnessLine counts whole hours when the newest decision is less than a day old", () => {
  assert.equal(freshnessLine([entryAt("2026-11-20T06:30:00Z")], NOW), "Roadmap last changed 5 hours ago");
});

test("freshnessLine counts whole minutes when the newest decision is less than an hour old", () => {
  assert.equal(freshnessLine([entryAt("2026-11-20T11:47:30Z")], NOW), "Roadmap last changed 12 minutes ago");
});
