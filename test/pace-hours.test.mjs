import { test } from "node:test";
import assert from "node:assert/strict";
import { hoursPerDay } from "../src/pace/hours.js";
import { sessionOn } from "./support/commits.mjs";

test("hours per day averages the last four active days, each capped at 10 hours", () => {
  const found = [
    sessionOn("2026-10-29", 6, 14),
    sessionOn("2026-10-27", 9, 2),
    sessionOn("2026-10-28", 9, 1),
    sessionOn("2026-10-28", 13, 3),
    sessionOn("2026-10-20", 9, 1),
    sessionOn("2026-10-30", 9, 4),
  ];

  const pace = hoursPerDay(found, "2026-10-30");

  assert.deepEqual(pace, { status: "ok", hoursPerDay: 5 });
});

test("fewer than four active days is insufficient history and carries no hours figure", () => {
  const found = [
    sessionOn("2026-10-27", 9, 2),
    sessionOn("2026-10-28", 9, 1),
    sessionOn("2026-10-28", 13, 3),
    sessionOn("2026-10-29", 9, 3),
  ];

  const pace = hoursPerDay(found, "2026-10-30");
  const enough = hoursPerDay([...found, sessionOn("2026-10-30", 9, 1)], "2026-10-30");

  assert.deepEqual(pace, { status: "insufficient", activeDays: 3 });
  assert.equal(enough.status, "ok");
});
