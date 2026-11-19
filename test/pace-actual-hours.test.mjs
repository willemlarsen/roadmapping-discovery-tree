import { test } from "node:test";
import assert from "node:assert/strict";
import { actualHours } from "../src/pace/actual-hours.js";

const MS_PER_MINUTE = 60_000;
const GAP_MINUTES = 60;
const DAY = "2026-10-27";
const START = Date.parse(`${DAY}T08:00:00Z`);

const commitsAtMinutes = (minutes, day = DAY) =>
  minutes.map((minute) => ({ at: START + minute * MS_PER_MINUTE, day, subject: "work" }));

const hourlyChainEndingAt = (totalMinutes) => {
  const stops = Array.from({ length: Math.floor(totalMinutes / 60) + 1 }, (_, index) => index * 60);
  return commitsAtMinutes(totalMinutes % 60 === 0 ? stops : [...stops, totalMinutes]);
};

test("actualHours_atTheGapAndDailyCapBoundaries_countsOnlyTimeWithinSessionsAndCapsEachDay", () => {
  const rows = [
    ["a 59 minute gap stays one session", commitsAtMinutes([0, 59]), 59 / 60],
    ["a 60 minute gap stays one session", commitsAtMinutes([0, 60]), 1],
    ["a 61 minute gap starts a second session, so the gap is not worked", commitsAtMinutes([0, 61]), 0],
    ["a day of 9.99 hours counts in full", hourlyChainEndingAt(599.4), 9.99],
    ["a day of 10 hours counts in full", hourlyChainEndingAt(600), 10],
    ["a day of 10.01 hours is capped at 10", hourlyChainEndingAt(600.6), 10],
    [
      "a session spanning two days counts on the day it started",
      [...commitsAtMinutes([930, 960], DAY), ...commitsAtMinutes([990], "2026-10-28")],
      1,
    ],
  ];

  for (const [name, commits, expectedHours] of rows) {
    assert.ok(Math.abs(actualHours(commits, GAP_MINUTES) - expectedHours) < 1e-9, name);
  }
});
