import { test } from "node:test";
import assert from "node:assert/strict";
import { recentDecisions } from "../src/recent-decisions.js";

const roadmap = {
  problems: [
    { id: "gp-021", problem: "List tasks by bed" },
    { id: "gp-022", problem: "Remind gardeners" },
  ],
};

const entry = (at, problemId, action, before, after, actor = "Product Coach") => ({ at, problemId, actor, action, before, after, why: "Because" });

test("recentDecisions keeps the five newest by default and words additions and the product owner's overrides", () => {
  const entries = [
    entry("2026-11-24T08:00:00Z", "gp-021", "coach-add", null, "next"),
    entry("2026-11-24T08:00:00Z", "gp-021", "coach-add", null, "next"),
    entry("2026-11-24T08:00:00Z", "gp-022", "coach-add", null, "next"),
    entry("2026-11-24T09:00:00Z", "gp-022", "willem-override", "next", "parked", "Product Owner"),
    entry("2026-11-24T10:00:00Z", "gp-022", "willem-estimate-override", { value: 5, size: 3 }, { value: 8, size: 2 }, "Product Owner"),
    entry("2026-11-24T10:00:00Z", "gp-021", "coach-confirm-done", "now", "done"),
  ];

  const lines = recentDecisions(entries, roadmap, "2026-11-24T12:00:00Z");

  assert.deepEqual(lines, [
    "Product Coach confirmed “List tasks by bed” solved, 2 hours ago",
    "Product Owner estimated “Remind gardeners” at value 8, size 2, 2 hours ago",
    "Product Owner overrode “Remind gardeners” to parked, 3 hours ago",
    "Product Coach added “Remind gardeners” as next, 4 hours ago",
    "Product Coach added “List tasks by bed” as next, 4 hours ago",
  ]);
});

test("recentDecisions tells the newest log entries first, each as who did what to which card and how long ago", () => {
  const entries = [
    entry("2026-11-20T10:00:00Z", "gp-021", "coach-add", null, "next"),
    entry("2026-11-24T09:00:00Z", "gp-022", "coach-status", "next", "now", "Tech Coach"),
    entry("2026-11-24T11:00:00Z", "gp-021", "coach-confirm-done", "now", "done"),
    entry("2026-11-24T11:58:00Z", "gp-022", "coach-rerank", "3", "2"),
    entry("2026-11-24T11:59:30Z", "gp-021", "coach-estimate", null, { value: 5, size: 3 }),
  ];

  const lines = recentDecisions(entries, roadmap, "2026-11-24T12:00:00Z", 4);

  assert.deepEqual(lines, [
    "Product Coach estimated “List tasks by bed” at value 5, size 3, just now",
    "Product Coach re-ranked “Remind gardeners” from 3 to 2, 2 minutes ago",
    "Product Coach confirmed “List tasks by bed” solved, 1 hour ago",
    "Tech Coach moved “Remind gardeners” from next to now, 3 hours ago",
  ]);
});

test("recentDecisions picks the newest by time, not by place in the file, and among entries at the same time tells the later line in the file first", () => {
  const entries = [
    entry("2026-11-24T11:00:00Z", "gp-021", "coach-confirm-done", "now", "done"),
    entry("2026-11-24T08:00:00Z", "gp-022", "coach-add", null, "next"),
    entry("2026-11-24T03:00:00-08:00", "gp-022", "coach-status", "next", "now", "Tech Coach"),
    entry("2026-11-24T11:00:00Z", "gp-022", "coach-rerank", "3", "2"),
  ];

  const lines = recentDecisions(entries, roadmap, "2026-11-24T12:00:00Z", 3);

  assert.deepEqual(lines, [
    "Product Coach re-ranked “Remind gardeners” from 3 to 2, 1 hour ago",
    "Tech Coach moved “Remind gardeners” from next to now, 1 hour ago",
    "Product Coach confirmed “List tasks by bed” solved, 1 hour ago",
  ]);
});
