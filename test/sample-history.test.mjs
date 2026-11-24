import { test } from "node:test";
import assert from "node:assert/strict";
import { historyPlan, workdaysEndingOn } from "../scripts/sample-history.mjs";

test("workdaysEndingOn lists the given number of weekdays up to and including the end day, oldest first", () => {
  assert.deepEqual(workdaysEndingOn("2026-11-24", 4), ["2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"]);
  assert.deepEqual(workdaysEndingOn("2026-11-22", 2), ["2026-11-19", "2026-11-20"]);
});

test("historyPlan lays each build's cycles over the workdays ending on the end day, a few a day, each build under its own made-up session", () => {
  const builds = [{ card: "gp-011", cycles: 4 }, { card: "gp-012", cycles: 3 }];

  const plan = historyPlan(builds, { tokenPrefix: "5a", end: "2026-11-24" });

  assert.deepEqual(plan, [
    { at: "2026-11-23T09:30:00-08:00", subject: "C1: gp-011 sample cycle 1 of 4 (gov-5a0000000001)" },
    { at: "2026-11-23T09:58:00-08:00", subject: "C2: gp-011 sample cycle 2 of 4 (gov-5a0000000001)" },
    { at: "2026-11-23T10:39:00-08:00", subject: "C3: gp-011 sample cycle 3 of 4 (gov-5a0000000001)" },
    { at: "2026-11-24T09:30:00-08:00", subject: "C4: gp-011 sample cycle 4 of 4 (gov-5a0000000001)" },
    { at: "2026-11-24T09:58:00-08:00", subject: "C1: gp-012 sample cycle 1 of 3 (gov-5a0000000002)" },
    { at: "2026-11-24T10:39:00-08:00", subject: "C2: gp-012 sample cycle 2 of 3 (gov-5a0000000002)" },
    { at: "2026-11-24T11:12:00-08:00", subject: "C3: gp-012 sample cycle 3 of 3 (gov-5a0000000002)" },
  ]);
});
