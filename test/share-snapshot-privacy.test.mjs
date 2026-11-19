import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot } from "../src/share/snapshot.js";

const snapshotSource = readFileSync(new URL("../src/share/snapshot.js", import.meta.url), "utf8");

const problem = (id, extra) => ({
  id, parent: null, problem: `Visible ${id}`, status: "done", order: 1, doneOn: "2026-10-30",
  statusSince: "MARK-statusSince", slices: ["MARK-slice"], waitingOn: "MARK-waitingOn",
  resumesAfter: "MARK-resumesAfter", confirmedBy: "MARK-confirmedBy", value: "MARK-value", size: "MARK-size",
  ...extra,
});

test("buildSnapshot leaks no non-allowlisted roadmap field and never reaches for decisions.jsonl", () => {
  const roadmap = {
    version: "MARK-version", goal: "Visible goal", wipLimit: "MARK-wipLimit", staleAfterDays: "MARK-stale",
    decisionsPath: "MARK-decisions.jsonl",
    problems: [problem("up-001"), problem("up-002", { parent: "up-001", status: "blocked", doneOn: null })],
  };

  const snapshot = buildSnapshot({
    roadmap, productId: "p", sourceRevision: "abc1234",
    sourceCommittedAt: "2026-11-07T10:00:00Z", generatedAt: "2026-11-08T09:00:00Z",
  });

  const text = JSON.stringify(snapshot);
  assert.doesNotMatch(text, /MARK-/);
  assert.match(text, /Visible goal/);
  assert.match(text, /Visible up-002/);
  assert.doesNotMatch(snapshotSource, /\bimport\b|decisions|readFile|node:fs/);
});
