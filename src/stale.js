const WORKING = new Set(["now", "blocked"]);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function staleness(roadmap, now, lastRerank) {
  const newest = newestChange(roadmap, lastRerank);
  if (newest === null) return { days: null, stale: false };
  const days = utcDay(Date.parse(now)) - utcDay(newest);
  return { days, stale: days > roadmap.staleAfterDays };
}

function newestChange(roadmap, lastRerank) {
  const texts = [lastRerank?.at, ...workingStatusDates(roadmap)];
  const moments = texts.map((text) => Date.parse(text)).filter(Number.isFinite);
  return moments.length === 0 ? null : Math.max(...moments);
}

function workingStatusDates(roadmap) {
  return roadmap.problems.filter((entry) => WORKING.has(entry.status)).map((entry) => entry.statusSince);
}

function utcDay(milliseconds) {
  return Math.floor(milliseconds / MILLISECONDS_PER_DAY);
}
