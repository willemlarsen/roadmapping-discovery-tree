import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot } from "../src/share/snapshot.js";

const roadmap = {
  version: 1, goal: "Marker goal", wipLimit: 1, staleAfterDays: 3,
  problems: [
    { id: "up-001", parent: null, problem: "Marker root", status: "now", statusSince: "2026-10-28", order: 1, slices: ["marker-slice"], waitingOn: "marker-wait", resumesAfter: null, doneOn: null, confirmedBy: "marker", value: "marker-value", size: "L" },
    { id: "up-002", parent: "up-001", problem: "Marker child", status: "done", statusSince: "2026-10-29", order: 2, slices: [], waitingOn: null, resumesAfter: null, doneOn: "2026-10-30", confirmedBy: null, value: "marker-value", size: "S" },
  ],
};

const isDeepFrozen = (value) =>
  value === null || typeof value !== "object" ||
  (Object.isFrozen(value) && Object.values(value).every(isDeepFrozen));

test("buildSnapshot projects the roadmap by allowlist into a deep-frozen v1 snapshot", () => {
  const snapshot = buildSnapshot({
    roadmap, productId: "marker-product", sourceRevision: "abc1234",
    sourceCommittedAt: "2026-11-07T10:00:00Z", generatedAt: "2026-11-08T09:00:00Z",
  });

  assert.deepEqual(snapshot, {
    schemaVersion: 1, productId: "marker-product", sourceRevision: "abc1234",
    generatedAt: "2026-11-08T09:00:00Z", sourceCommittedAt: "2026-11-07T10:00:00Z", goal: "Marker goal",
    nodes: [
      { id: "up-001", parent: null, problem: "Marker root", status: "now", order: 1, doneOn: null },
      { id: "up-002", parent: "up-001", problem: "Marker child", status: "done", order: 2, doneOn: "2026-10-30" },
    ],
    forecast: [],
  });
  assert.ok(snapshot.nodes.every((node) => !("value" in node) && !("size" in node)));
  assert.ok(isDeepFrozen(snapshot));
});
