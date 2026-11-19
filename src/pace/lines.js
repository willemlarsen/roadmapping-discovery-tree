import { workingHoursPhrase, workingHoursWords } from "./hours-words.js";
import { MIN_SIZES } from "./sizes.js";

const HOURS_WORDS = "Hours are working hours at the measured pace, counted from now, one card after another.";
const NO_FORECAST_WORDS = "Forecast unavailable for this card.";
const UNAVAILABLE_WORDS = {
  missing: "Forecast unavailable: the pace file could not be loaded.",
  invalid: "Forecast unavailable: the pace file has mistakes.",
  insufficient: "Forecast unavailable: not enough history yet.",
  stale: "Forecast unavailable: the pace file is out of date.",
  outdated: "Forecast unavailable: the forecast needs refreshing.",
};

export function forecastLines(node, forecast) {
  if (!isForecast(node) || forecast === null) return [];
  if (forecast.state !== "ok") return [UNAVAILABLE_WORDS[forecast.state]];
  const { results } = forecast.pace;
  const place = results.findIndex((result) => result.id === node.id);
  if (place === -1) return [featureTotalHoursWords(node, results)];
  const hours = workingHoursWords(results[place].p85Hours) ?? NO_FORECAST_WORDS;
  const lines = [orderWords(place, results.length), hours];
  return isSampled(forecast.pace.inputs) ? lines : [...lines, estimateWords(results[place])];
}

function featureTotalHoursWords(node, results) {
  const places = openLeavesBelow(node).map((leaf) => results.findIndex((result) => result.id === leaf.id));
  const last = places.length > 0 && !places.includes(-1) ? results[Math.max(...places)] : undefined;
  const phrase = last ? workingHoursPhrase(last.p85Hours) : null;
  return phrase === null ? NO_FORECAST_WORDS : `About ${phrase} left in total (85% likely)`;
}

function openLeavesBelow(node) {
  return node.children.flatMap((child) => {
    const below = openLeavesBelow(child);
    return isForecast(child) && below.length === 0 ? [child] : below;
  });
}

function orderWords(place, total) {
  return `Sequence ${place + 1} of ${total} \u00b7 the order the work follows`;
}

function estimateWords({ remainingCycles }) {
  return `Estimate: assumes ${remainingCycles} cycles of work on this card after the cards before it.`;
}

function isForecast(node) {
  return node.status === "now" || node.status === "next";
}

export function inputLines(pace) {
  const { inputs } = pace;
  const lines = [windowLine(inputs), sizesLine(inputs), historyLine(inputs), `Pace file generated ${pace.generatedAt}`];
  return pace.pace ? [paceLine(pace.pace), ...lines, HOURS_WORDS] : lines;
}

function windowLine(inputs) {
  return `Window: the last ${inputs.windowDays} active days within the last ${inputs.rollingDays} days, sessions split at gaps over ${inputs.sessionGapMinutes} minutes, each day capped at ${inputs.dailyCapHours} hours`;
}

function isSampled({ sizeSamples }) {
  return sizeSamples.length >= MIN_SIZES;
}

function sizesLine({ sizeSamples }) {
  if (!isSampled({ sizeSamples })) return `Cycles per card: fewer than ${MIN_SIZES} finished builds are known, so each card uses its fixed cycle count.`;
  return `Cycles per card: sizes from ${sizeSamples.length} finished builds, ${sizeSamples[0]} to ${sizeSamples.at(-1)} cycles.`;
}

function historyLine(inputs) {
  return `History read: ${inputs.commits} commits, ${inputs.cycleCommits} cycle commits, ${inputs.cycleIntervals} cycle intervals, ${inputs.activeDays} active days`;
}

function paceLine({ hoursPerDay }) {
  return `Pace: ${hoursPerDay.toFixed(2)} hours of work per active day`;
}
