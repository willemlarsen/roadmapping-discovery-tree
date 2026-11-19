import { MINUTES_PER_HOUR } from "./time.js";

export const SIMULATION_SEED = 20261031;
const TRIALS = 10_000;
const MEDIAN = 0.5;
const PLANNING_SAFE = 0.85;
const LIKELY_BY = 0.95;

export function simulate(samples, remainingCycles, seed) {
  return simulateInOrder(samples, [remainingCycles], seed)[0];
}

export function simulateInOrder(samples, remainingCyclesList, seed) {
  return simulateCards(samples, remainingCyclesList.map((cycles) => () => cycles), seed);
}

export function simulateSampled({ samples, sizes }, cardCount, seed) {
  const sampledSize = (random) => pick(sizes, random);
  return simulateCards(samples, Array.from({ length: cardCount }, () => sampledSize), seed);
}

function simulateCards(samples, cyclesPerCard, seed) {
  const random = seededRandom(seed);
  const trials = Array.from({ length: TRIALS }, () => cumulativeMinutes(samples, cyclesPerCard, random));
  return rangesOf(trials, cyclesPerCard.length);
}

function cumulativeMinutes(samples, cyclesPerCard, random) {
  let minutes = 0;
  return cyclesPerCard.map((cyclesFor) => {
    minutes += workMinutes(samples, cyclesFor(random), random);
    return minutes;
  });
}

function rangesOf(trials, cardCount) {
  return Array.from({ length: cardCount }, (_, card) => {
    const minutes = trials.map((trial) => trial[card]).sort((a, b) => a - b);
    return {
      p50Hours: percentile(minutes, MEDIAN) / MINUTES_PER_HOUR,
      p85Hours: percentile(minutes, PLANNING_SAFE) / MINUTES_PER_HOUR,
      p95Hours: percentile(minutes, LIKELY_BY) / MINUTES_PER_HOUR,
    };
  });
}

function workMinutes(samples, cycles, random) {
  let minutes = 0;
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    minutes += pick(samples, random);
  }
  return minutes;
}

function pick(values, random) {
  return values[Math.floor(random() * values.length)];
}

function percentile(sortedValues, fraction) {
  return sortedValues[Math.ceil(fraction * sortedValues.length) - 1];
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
