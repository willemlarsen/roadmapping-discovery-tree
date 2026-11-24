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

test("freshnessLine names one of a unit in the singular", () => {
  const ages = ["2026-11-19T11:00:00Z", "2026-11-20T10:30:00Z", "2026-11-20T11:58:30Z"];

  assert.deepEqual(ages.map((at) => freshnessLine([entryAt(at)], NOW)), [
    "Roadmap last changed 1 day ago",
    "Roadmap last changed 1 hour ago",
    "Roadmap last changed 1 minute ago",
  ]);
});

test("freshnessLine has no line for an empty decision log", () => {
  assert.equal(freshnessLine([], NOW), null);
});

test("freshnessLine says just now under a minute, and for a decision stamped ahead of this clock", () => {
  const ages = ["2026-11-20T11:59:30Z", "2026-11-20T12:05:00Z"];

  assert.deepEqual(ages.map((at) => freshnessLine([entryAt(at)], NOW)), ["Roadmap last changed just now", "Roadmap last changed just now"]);
});
