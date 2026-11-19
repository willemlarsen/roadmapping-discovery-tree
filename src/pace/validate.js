import { CONTRACT_VERSION, GENERATOR, MAX_REMAINING_CYCLES } from "./file.js";
import { WINDOW_DAYS } from "./hours.js";
import { forecastOrder } from "./order.js";
import { MAX_SESSION_CYCLES, MIN_SESSION_CYCLES } from "./sizes.js";

const MAX_SIZE_SAMPLES = 500;
const MAX_AGE_MS = 3 * 86_400_000;
const MAX_HOURS_PER_DAY = 24;
const MAX_RESULTS = 200;
const ID = /^[a-z0-9-]{1,64}$/;
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HEADER_FIELDS = ["contractVersion", "generator", "generatedAt", "inputs", "status", "pace", "results"];
const INSUFFICIENT_FIELDS = ["contractVersion", "generator", "generatedAt", "inputs", "status", "reason", "results"];
const INSUFFICIENT_REASONS = ["too_few_active_days", "no_cycle_intervals"];
const INPUT_FIELDS = ["sessionGapMinutes", "windowDays", "rollingDays", "dailyCapHours", "simulationSeed", "commits", "cycleCommits", "cycleIntervals", "activeDays"];
const SIZE_SAMPLES = "sizeSamples";
const RANGE_ENDS = ["p50Hours", "p85Hours", "p50Date", "p85Date"];
const RESULT_FIELDS = ["id", "remainingCycles", "p50Hours", "p85Hours", "p95Hours", "p50Date", "p85Date"];

export function validatePace(pace, roadmap, now) {
  const shaped = shapeOf(pace, roadmap);
  return shaped.state !== "invalid" && isStale(pace.generatedAt, now) ? { state: "stale", pace } : shaped;
}

function shapeOf(pace, roadmap) {
  if (isContract(pace)) return { state: listsRoadmapCards(pace.results, roadmap) ? "ok" : "outdated", pace };
  if (isInsufficient(pace)) return { state: "insufficient", pace };
  return { state: "invalid" };
}

function isStale(generatedAt, now) {
  const age = Date.parse(now) - Date.parse(generatedAt);
  return !(age >= 0 && age <= MAX_AGE_MS);
}

function isContract(pace) {
  return hasExactly(pace, HEADER_FIELDS)
    && hasHeader(pace)
    && pace.status === "ok"
    && hasEnoughHistory(pace.inputs)
    && hasPace(pace.pace)
    && hasResults(pace.results);
}

function isInsufficient(pace) {
  return hasExactly(pace, INSUFFICIENT_FIELDS)
    && hasHeader(pace)
    && pace.status === "insufficient"
    && INSUFFICIENT_REASONS.includes(pace.reason)
    && Array.isArray(pace.results) && pace.results.length === 0;
}

function hasHeader(pace) {
  return pace.contractVersion === CONTRACT_VERSION
    && pace.generator === GENERATOR
    && isUtcTime(pace.generatedAt)
    && hasInputs(pace.inputs);
}

function hasExactly(value, fields) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function isUtcTime(value) {
  return typeof value === "string" && UTC_TIME.test(value) && isCalendarDay(value.slice(0, 10))
    && !Number.isNaN(Date.parse(value));
}

function isCalendarDay(value) {
  if (typeof value !== "string" || !CALENDAR_DAY.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString().startsWith(value);
}

function hasInputs(inputs) {
  return hasExactly(inputs, [...INPUT_FIELDS, SIZE_SAMPLES])
    && INPUT_FIELDS.every((field) => Number.isInteger(inputs[field]) && inputs[field] >= 0)
    && hasSizeSamples(inputs[SIZE_SAMPLES]);
}

function hasSizeSamples(sizes) {
  return Array.isArray(sizes) && sizes.length <= MAX_SIZE_SAMPLES
    && sizes.every(isBuildSize)
    && isNonDecreasing(sizes);
}

function isNonDecreasing(values) {
  return values.every((value, index) => index === 0 || value >= values[index - 1]);
}

function isBuildSize(size) {
  return Number.isInteger(size) && size >= MIN_SESSION_CYCLES && size <= MAX_SESSION_CYCLES;
}

function hasEnoughHistory(inputs) {
  return inputs.activeDays >= WINDOW_DAYS && inputs.cycleIntervals >= 1;
}

function hasPace(pace) {
  return hasExactly(pace, ["hoursPerDay"]) && isHours(pace.hoursPerDay, MAX_HOURS_PER_DAY) && pace.hoursPerDay > 0;
}

function isHours(value, limit = Infinity) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= limit;
}

function hasResults(results) {
  return Array.isArray(results) && results.length <= MAX_RESULTS
    && results.every(isResult)
    && followsForecastOrder(results);
}

function listsRoadmapCards(results, roadmap) {
  const forecastIds = forecastOrder(roadmap.problems).map((problem) => problem.id);
  return results.map((result) => result.id).join() === forecastIds.join();
}

function followsForecastOrder(results) {
  return results.every((result, index) => index === 0 || isNotBefore(result, results[index - 1]));
}

function isNotBefore(result, previous) {
  return RANGE_ENDS.every((end) => result[end] >= previous[end]);
}

function isResult(result) {
  return hasExactly(result, RESULT_FIELDS)
    && isHours(result.p95Hours)
    && typeof result.id === "string" && ID.test(result.id)
    && isRemainingCycles(result.remainingCycles)
    && isRange(result.p50Hours, result.p85Hours, isHours)
    && isRange(result.p50Date, result.p85Date, isCalendarDay);
}

function isRemainingCycles(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_REMAINING_CYCLES;
}

function isRange(low, high, isValue) {
  return isValue(low) && isValue(high) && low <= high;
}
