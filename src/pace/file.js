import { cycleMinutes, isCycleCommit } from "./cycle.js";
import { dayInOffset, toDates } from "./dates.js";
import { activeDays, DAILY_CAP_HOURS, hoursPerDay, ROLLING_DAYS, WINDOW_DAYS } from "./hours.js";
import { sessions } from "./sessions.js";
import { buildSizes, MIN_SIZES } from "./sizes.js";
import { SIMULATION_SEED, simulateInOrder, simulateSampled } from "./simulate.js";

export const CONTRACT_VERSION = 3;
export const GENERATOR = "scripts/pace.mjs";
const SESSION_GAP_MINUTES = 60;
export const MAX_REMAINING_CYCLES = 200;
const CARD_ID = /^[a-z0-9-]{1,64}$/;
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export class PaceInputError extends Error {
  constructor(code, where) {
    super(`${where}: ${code}`);
    this.name = "PaceInputError";
    this.code = code;
  }
}

export function paceFile({ commits, cards, generatedAt }) {
  validateInput(cards, generatedAt);
  const generationDay = dayInOffset(generatedAt, newestOffset(commits));
  const found = sessions(commits, SESSION_GAP_MINUTES);
  const intervals = cycleMinutes(found);
  const days = activeDays(found, generationDay).length;
  const sizes = buildSizes(commits);
  const header = {
    contractVersion: CONTRACT_VERSION,
    generator: GENERATOR,
    generatedAt,
    inputs: inputsOf({ commits, intervals, days, sizes }),
  };
  if (days < WINDOW_DAYS) return insufficient(header, "too_few_active_days");
  if (intervals.length === 0) return insufficient(header, "no_cycle_intervals");
  const pace = hoursPerDay(found, generationDay);
  const { ranges, planned } = forecastCards({ intervals, sizes }, cards);
  return {
    ...header,
    status: "ok",
    pace: { hoursPerDay: pace.hoursPerDay },
    results: planned.map((card, index) => cardResult(card, ranges[index], { hoursPerDay: pace.hoursPerDay, from: generationDay })),
  };
}

function forecastCards({ intervals, sizes }, cards) {
  if (sizes.length < MIN_SIZES) {
    const ranges = simulateInOrder(intervals, cards.map((card) => card.remainingCycles), SIMULATION_SEED);
    return { ranges, planned: cards };
  }
  const typical = typicalSize(sizes);
  return {
    ranges: simulateSampled({ samples: intervals, sizes }, cards.length, SIMULATION_SEED),
    planned: cards.map((card) => ({ id: card.id, remainingCycles: typical })),
  };
}

function typicalSize(sizes) {
  return sizes[Math.floor((sizes.length - 1) / 2)];
}

function inputsOf({ commits, intervals, days, sizes }) {
  return {
    sessionGapMinutes: SESSION_GAP_MINUTES,
    windowDays: WINDOW_DAYS,
    rollingDays: ROLLING_DAYS,
    dailyCapHours: DAILY_CAP_HOURS,
    simulationSeed: SIMULATION_SEED,
    commits: commits.length,
    cycleCommits: commits.filter((commit) => isCycleCommit(commit.subject)).length,
    cycleIntervals: intervals.length,
    activeDays: days,
    sizeSamples: sizes,
  };
}

function newestOffset(commits) {
  const newest = commits.reduce((latest, commit) => (commit.at > latest.at ? commit : latest), { at: -Infinity, offsetMinutes: 0 });
  return newest.offsetMinutes;
}

function insufficient(header, reason) {
  return { ...header, status: "insufficient", reason, results: [] };
}

function cardResult({ id, remainingCycles }, hours, schedule) {
  return { id, remainingCycles, ...hours, ...toDates(hours, schedule.hoursPerDay, schedule.from) };
}

function validateInput(cards, generatedAt) {
  if (!Array.isArray(cards)) throw new PaceInputError("invalid_cards", "cards");
  cards.forEach((card, index) => {
    if (!isValidCard(card)) throw new PaceInputError("invalid_card", `card ${index + 1}`);
  });
  if (typeof generatedAt !== "string" || !UTC_TIME.test(generatedAt)) {
    throw new PaceInputError("invalid_generated_at", "generatedAt");
  }
}

function isValidCard(card) {
  return card !== null && typeof card === "object"
    && typeof card.id === "string" && CARD_ID.test(card.id)
    && Number.isInteger(card.remainingCycles)
    && card.remainingCycles >= 1 && card.remainingCycles <= MAX_REMAINING_CYCLES;
}
