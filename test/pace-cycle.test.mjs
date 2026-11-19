import { test } from "node:test";
import assert from "node:assert/strict";
import { isCycleCommit, cycleMinutes } from "../src/pace/cycle.js";
import { commitAt, cycleAt } from "./support/commits.mjs";

test("only a cycle subject counts as a cycle commit, not a plan or record that carries a gov- token", () => {
  const cycleSubjects = [
    "C3f0: a roadmap that isn't an object fails once with wrong_type (gov-f84e94cbff8f)",
    "Z1: a tree wider than the window keeps its left edge reachable (gov-84ccea7a96ff)",
  ];
  const otherSubjects = [
    "tasks: record C10 commit id (gov-803e953d63a4)",
    "Forecast brief: design review ruling recorded (gov-b3e2539d067f, CONDITIONAL)",
    "Tidy-first: one behaviour per test (gov-f84e94cbff8f)",
    "Plan C3: notes that mention a cycle id mid-subject (gov-f84e94cbff8f)",
    "C4: a problem without an id fails with missing_field",
    "MANUAL: 200% zoom passes in real Chrome; slice 1 complete",
  ];

  const verdicts = [...cycleSubjects, ...otherSubjects].map(isCycleCommit);

  assert.deepEqual(verdicts, [true, true, false, false, false, false, false, false]);
});

test("cycle minutes are the gaps between consecutive cycle commits inside a session, not across sessions", () => {
  const longSession = [cycleAt(0), commitAt(10, "tasks: note"), cycleAt(25), cycleAt(40)];
  const pairSession = [cycleAt(500), cycleAt(512)];
  const loneSession = [cycleAt(1000)];

  const minutes = cycleMinutes([longSession, pairSession, loneSession]);

  assert.deepEqual(minutes, [25, 15, 12]);
});

test("isCycleCommit_withHyphenatedCycleId_returnsTrue", () => {
  const cycleSubjects = [
    "C15b-10: CI runs the browser check; C15b ticked (gov-803e953d63a4)",
    "C15b-1: contrastRatio computes the WCAG ratio (gov-803e953d63a4)",
  ];
  const otherSubjects = [
    "C15b-10: CI runs the browser check; C15b ticked",
    "pace.json: regenerated after the forecast hardening (contract v2) (gov-62222a191533)",
    "tasks: record C10 commit id (gov-803e953d63a4)",
    "C15b-: an id with no number after the hyphen (gov-803e953d63a4)",
  ];

  const verdicts = [...cycleSubjects, ...otherSubjects].map(isCycleCommit);

  assert.deepEqual(verdicts, [true, true, false, false, false, false]);
});
