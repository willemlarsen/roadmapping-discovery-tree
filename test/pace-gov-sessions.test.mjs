import { test } from "node:test";
import assert from "node:assert/strict";
import { govSessions } from "../src/pace/gov-sessions.js";
import { commitAt } from "./support/commits.mjs";

const inSession = (token, subjects, startMinute = 0) =>
  subjects.map((subject, index) => commitAt(startMinute + index * 10, `${subject} (gov-${token})`));

test("govSessions_withFinishedAndInProgressSessions_listsFinishedOnesWithTokenFirstLastAndCycles", () => {
  const later = inSession("62222a191533", ["H1: history", "H2: window", "H3: stale"], 500);
  const earlier = inSession("2f5cacf8da28", ["K1a: cycle ids", "K1b: rework", "tasks: record K1"]);
  const inProgress = inSession("3c9a00000003", ["P1: a", "P2: b"], 1000);
  const untokened = [commitAt(5, "C1: a behaviour"), commitAt(6, "pace.json: regenerated")];

  const found = govSessions([...later, ...inProgress, ...untokened, ...earlier]);

  assert.deepEqual(found, [
    { token: "gov-2f5cacf8da28", firstAt: 0, lastAt: 10 * 60_000, cycles: 2 },
    { token: "gov-62222a191533", firstAt: 500 * 60_000, lastAt: 520 * 60_000, cycles: 3 },
  ]);
});
