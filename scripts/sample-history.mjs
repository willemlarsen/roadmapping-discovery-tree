// Builds a synthetic git history for the sample products and regenerates their pace files from it.
// The sample repository's own history is too short for a forecast, so the sample forecast comes
// from this made-up history: fixed author, backdated commits, made-up session tokens.

const MS_PER_DAY = 86_400_000;
const SATURDAY = 6;
const SUNDAY = 0;

const isWeekday = (milliseconds) => ![SATURDAY, SUNDAY].includes(new Date(milliseconds).getUTCDay());
const dayOf = (milliseconds) => new Date(milliseconds).toISOString().slice(0, 10);

// A modest pace: a few cycles a day, half an hour or so apart, all in one morning sitting.
const DAILY_CYCLES = [3, 4, 2, 3, 4];
const CYCLE_GAPS_MINUTES = [28, 41, 33, 24, 37];
const DAY_START = "09:30:00";
const OFFSET = "-08:00";
const OFFSET_MS = -8 * 3_600_000;
const MS_PER_MINUTE = 60_000;

export const sessionToken = (tokenPrefix, number) => `gov-${tokenPrefix}${String(number).padStart(10, "0")}`;

function cyclesOf(builds, tokenPrefix) {
  return builds.flatMap(({ card, cycles }, index) => Array.from({ length: cycles }, (_, cycle) =>
    `C${cycle + 1}: ${card} sample cycle ${cycle + 1} of ${cycles} (${sessionToken(tokenPrefix, index + 1)})`));
}

function cyclesPerDay(total) {
  const counts = [];
  for (let left = total; left > 0; left -= counts.at(-1)) counts.push(Math.min(left, DAILY_CYCLES[counts.length % DAILY_CYCLES.length]));
  return counts;
}

const localTime = (milliseconds) => `${new Date(milliseconds + OFFSET_MS).toISOString().slice(0, 19)}${OFFSET}`;

function timesOn(day, count) {
  const times = [Date.parse(`${day}T${DAY_START}${OFFSET}`)];
  while (times.length < count) times.push(times.at(-1) + CYCLE_GAPS_MINUTES[times.length - 1] * MS_PER_MINUTE);
  return times.map(localTime);
}

export function historyPlan(builds, { tokenPrefix, end }) {
  const subjects = cyclesOf(builds, tokenPrefix);
  const counts = cyclesPerDay(subjects.length);
  const times = workdaysEndingOn(end, counts.length).flatMap((day, index) => timesOn(day, counts[index]));
  return subjects.map((subject, index) => ({ at: times[index], subject }));
}

export function workdaysEndingOn(end, count) {
  const days = [];
  for (let at = Date.parse(`${end}T00:00:00Z`); days.length < count; at -= MS_PER_DAY) {
    if (isWeekday(at)) days.unshift(dayOf(at));
  }
  return days;
}
