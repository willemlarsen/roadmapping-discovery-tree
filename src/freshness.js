const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

// Largest first: the age is told in the largest unit it holds at least one of.
const UNITS = [
  { name: "day", milliseconds: 24 * MILLISECONDS_PER_HOUR },
  { name: "hour", milliseconds: MILLISECONDS_PER_HOUR },
  { name: "minute", milliseconds: MILLISECONDS_PER_MINUTE },
];

export function freshnessLine(entries, now) {
  const changedAt = lastChangedAt(entries);
  if (changedAt === null) return null;
  return `Roadmap last changed ${agoWords(Date.parse(now) - Date.parse(changedAt))}`;
}

// Every change to the roadmap is written to the decision log, so its newest entry is the time
// the roadmap last changed. Entries carry their own offsets, so they are compared as instants.
export function lastChangedAt(entries) {
  if (entries.length === 0) return null;
  return entries.reduce((newest, entry) => (Date.parse(entry.at) > Date.parse(newest.at) ? entry : newest)).at;
}

export function agoWords(age) {
  const unit = UNITS.find((candidate) => age >= candidate.milliseconds);
  if (!unit) return "just now";
  const count = Math.floor(age / unit.milliseconds);
  return `${count} ${count === 1 ? unit.name : `${unit.name}s`} ago`;
}
