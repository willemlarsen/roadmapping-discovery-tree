const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

// Largest first: the age is told in the largest unit it holds at least one of.
const UNITS = [
  { name: "day", milliseconds: 24 * MILLISECONDS_PER_HOUR },
  { name: "hour", milliseconds: MILLISECONDS_PER_HOUR },
  { name: "minute", milliseconds: MILLISECONDS_PER_MINUTE },
];

export function freshnessLine(entries, now) {
  if (entries.length === 0) return null;
  const newest = Math.max(...entries.map((entry) => Date.parse(entry.at)));
  return `Roadmap last changed ${agoWords(Date.parse(now) - newest)}`;
}

function agoWords(age) {
  const unit = UNITS.find((candidate) => age >= candidate.milliseconds);
  if (!unit) return "just now";
  const count = Math.floor(age / unit.milliseconds);
  return `${count} ${count === 1 ? unit.name : `${unit.name}s`} ago`;
}
