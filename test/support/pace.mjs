export function roadmapWith(problems) {
  return { version: 1, goal: "Willem always knows where we are", problems };
}

export const FORECAST_ROADMAP = roadmapWith([
  { id: "up-001", parent: null, problem: "See where we are", status: "now", order: 1 },
  { id: "up-002", parent: null, problem: "Peek under the hood", status: "next", order: 2 },
]);

export function validPace(overrides = {}) {
  return {
    contractVersion: 3,
    generator: "scripts/pace.mjs",
    generatedAt: "2026-10-31T20:33:29Z",
    inputs: {
      sessionGapMinutes: 60, windowDays: 4, rollingDays: 14, dailyCapHours: 10, simulationSeed: 20261031,
      commits: 125, cycleCommits: 72, cycleIntervals: 71, activeDays: 4, sizeSamples: [6, 11, 14],
    },
    status: "ok",
    pace: { hoursPerDay: 1.45 },
    results: [
      { id: "up-001", remainingCycles: 16, p50Hours: 0.95, p85Hours: 1.38, p95Hours: 1.7, p50Date: "2026-11-01", p85Date: "2026-11-02" },
      { id: "up-002", remainingCycles: 16, p50Hours: 1.94, p85Hours: 2.52, p95Hours: 3.1, p50Date: "2026-11-02", p85Date: "2026-11-03" },
    ],
    ...overrides,
  };
}

export function insufficientPace(reason = "too_few_active_days") {
  const { pace, ...header } = validPace();
  return { ...header, status: "insufficient", reason, results: [] };
}
