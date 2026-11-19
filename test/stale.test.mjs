import { test } from "node:test";
import assert from "node:assert/strict";
import { staleness } from "../src/stale.js";

const NOW = "2026-11-01T12:00:00Z";

const roadmapWith = (rerankAt, ...problems) => ({
  roadmap: { staleAfterDays: 3, problems: problems.map(([status, statusSince]) => ({ status, statusSince })) },
  lastRerank: { by: "Amal", at: rerankAt, why: "test" },
});

test("staleness counts whole UTC days from the newer of the re-rank and the newest working status, and is stale only past staleAfterDays", () => {
  const cases = [
    { name: "re-rank six days old", roadmap: roadmapWith("2026-10-26T10:00:00Z"), expected: { days: 6, stale: true } },
    { name: "exactly staleAfterDays old", roadmap: roadmapWith("2026-10-29T23:00:00Z"), expected: { days: 3, stale: false } },
    { name: "a blocked problem changed more recently", roadmap: roadmapWith("2026-10-20T10:00:00Z", ["blocked", "2026-10-31"]), expected: { days: 1, stale: false } },
    { name: "a next problem changing does not count", roadmap: roadmapWith("2026-10-20T10:00:00Z", ["next", "2026-11-01"], ["now", "2026-10-25"]), expected: { days: 7, stale: true } },
    { name: "an unreadable re-rank time is skipped", roadmap: roadmapWith("not a date", ["now", "2026-10-28"]), expected: { days: 4, stale: true } },
  ];

  const results = cases.map(({ roadmap: { roadmap, lastRerank } }) => staleness(roadmap, NOW, lastRerank));

  assert.deepEqual(results, cases.map(({ expected }) => expected));
});

test("staleness is not stale, with no days, when the roadmap has no readable date", () => {
  const withoutDates = { staleAfterDays: 3, problems: [{ status: "next", statusSince: "2026-10-01" }, { status: "now", statusSince: "soon" }] };

  const result = staleness(withoutDates, NOW, null);

  assert.deepEqual(result, { days: null, stale: false });
});

test("staleness takes the last re-rank as an argument, and with a null re-rank counts from working statuses only", () => {
  const withoutRerank = { staleAfterDays: 3, problems: [{ status: "now", statusSince: "2026-10-28" }] };
  const cases = [
    { name: "re-rank argument newer than the working status", rerank: { by: "Amal", at: "2026-10-30T10:00:00Z", why: "test" }, expected: { days: 2, stale: false } },
    { name: "null re-rank argument", rerank: null, expected: { days: 4, stale: true } },
  ];

  const results = cases.map(({ rerank }) => staleness(withoutRerank, NOW, rerank));

  assert.deepEqual(results, cases.map(({ expected }) => expected));
});
