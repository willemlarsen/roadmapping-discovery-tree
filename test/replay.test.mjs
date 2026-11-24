import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStep } from "../scripts/replay.mjs";
import { validateDecisionLog } from "../src/decisions.js";

const AT = "2026-11-24T17:00:00Z";

const card = (id, status, order, extra = {}) => ({
  id, parent: null, problem: `Problem ${id}`, status, statusSince: "2026-11-02", order, slices: ["s"], waitingOn: null, resumesAfter: null, ...extra,
});

const state = () => ({
  roadmap: { version: 1, goal: "Goal", wipLimit: 2, staleAfterDays: 7, problems: [card("gp-901", "now", 1), card("gp-902", "next", 2)] },
  entries: [
    { at: "2026-11-02T09:00:00-08:00", problemId: "gp-901", actor: "Product Coach", action: "coach-add", before: null, after: "now", why: "Seeded" },
    { at: "2026-11-02T09:00:00-08:00", problemId: "gp-902", actor: "Product Coach", action: "coach-add", before: null, after: "next", why: "Seeded" },
  ],
});

test("applyStep marks a card done with the day and who confirmed it, as a confirm-done line", () => {
  const step = { say: "A card is solved", actor: "Product Coach", why: "Checked", changes: [{ card: "gp-901", status: "done" }] };

  const { roadmap, lines } = applyStep(step, state(), AT);

  assert.deepEqual(roadmap.problems[0], card("gp-901", "done", 1, { statusSince: "2026-11-24", doneOn: "2026-11-24", confirmedBy: "Product Coach" }));
  assert.deepEqual(lines, [{ at: AT, problemId: "gp-901", actor: "Product Coach", action: "coach-confirm-done", before: "now", after: "done", why: "Checked" }]);
});

test("applyStep re-ranks cards by swapping their order, one re-rank line per card", () => {
  const step = { say: "Re-rank", actor: "Product Coach", why: "Cheaper first", changes: [{ card: "gp-901", order: 2 }, { card: "gp-902", order: 1 }] };

  const { roadmap, lines } = applyStep(step, state(), AT);

  assert.deepEqual(roadmap.problems.map((problem) => [problem.id, problem.order, problem.statusSince]), [["gp-901", 2, "2026-11-02"], ["gp-902", 1, "2026-11-02"]]);
  assert.deepEqual(lines, [
    { at: AT, problemId: "gp-901", actor: "Product Coach", action: "coach-rerank", before: "1", after: "2", why: "Cheaper first" },
    { at: AT, problemId: "gp-902", actor: "Product Coach", action: "coach-rerank", before: "2", after: "1", why: "Cheaper first" },
  ]);
});

test("applyStep refuses a step whose roadmap or decision log would not validate, and a step naming an unknown card", () => {
  const blockedWithoutReason = { say: "Block", actor: "Tech Coach", why: "Stuck", changes: [{ card: "gp-901", status: "blocked" }] };
  const unknownCard = { say: "Start", actor: "Tech Coach", why: "Go", changes: [{ card: "gp-999", status: "now" }] };
  const goesBackInTime = { say: "Start", actor: "Tech Coach", why: "Go", changes: [{ card: "gp-902", status: "now" }] };

  assert.throws(() => applyStep(blockedWithoutReason, state(), AT), { name: "ReplayRefused", message: /roadmap: gp-901 missing_field/ });
  assert.throws(() => applyStep(unknownCard, state(), AT), { name: "ReplayRefused", message: /unknown card gp-999/ });
  assert.throws(() => applyStep(goesBackInTime, state(), "2026-11-01T00:00:00Z"), { name: "ReplayRefused", message: /decision log: line 3 out_of_order/ });
});

test("applyStep moves a card to a new status, dates it today, and writes one status line with who and why", () => {
  const step = { say: "A card starts", actor: "Tech Coach", why: "Its turn", changes: [{ card: "gp-902", status: "now" }] };

  const { roadmap, lines } = applyStep(step, state(), AT);

  assert.deepEqual(roadmap.problems[1], card("gp-902", "now", 2, { statusSince: "2026-11-24" }));
  assert.deepEqual(lines, [{ at: AT, problemId: "gp-902", actor: "Tech Coach", action: "coach-status", before: "next", after: "now", why: "Its turn" }]);
  assert.equal(validateDecisionLog([...state().entries, ...lines], roadmap).valid, true);
});
