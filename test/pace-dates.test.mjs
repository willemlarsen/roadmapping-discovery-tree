import { test } from "node:test";
import assert from "node:assert/strict";
import { toDates } from "../src/pace/dates.js";

test("hours become likely-done dates counted in days of work from the given day", () => {
  const hours = { p50Hours: 7.5, p85Hours: 12 };

  const dates = toDates(hours, 5, "2026-10-31");

  assert.deepEqual(dates, { p50Date: "2026-11-03", p85Date: "2026-11-04" });
});

test("days of work skip weekends", () => {
  const hours = { p50Hours: 7.5, p85Hours: 12 };

  const fromFriday = toDates(hours, 5, "2026-10-30");
  const fromSaturday = toDates({ p50Hours: 2, p85Hours: 6 }, 5, "2026-10-31");
  const fromSunday = toDates({ p50Hours: 2, p85Hours: 6 }, 5, "2026-11-01");
  const fromMonday = toDates(hours, 5, "2026-11-02");

  assert.deepEqual(fromFriday, { p50Date: "2026-11-03", p85Date: "2026-11-04" });
  assert.deepEqual(fromSaturday, { p50Date: "2026-11-02", p85Date: "2026-11-03" });
  assert.deepEqual(fromSunday, { p50Date: "2026-11-02", p85Date: "2026-11-03" });
  assert.deepEqual(fromMonday, { p50Date: "2026-11-04", p85Date: "2026-11-05" });
});
