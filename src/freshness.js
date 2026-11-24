const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

// Largest first: the age is told in the largest unit it holds at least one of.
const UNITS = [
  { name: "days", milliseconds: 24 * MILLISECONDS_PER_HOUR },
  { name: "hours", milliseconds: MILLISECONDS_PER_HOUR },
];

export function freshnessLine(entries, now) {
  const newest = Math.max(...entries.map((entry) => Date.parse(entry.at)));
  return `Roadmap last changed ${agoWords(Date.parse(now) - newest)}`;
}

function agoWords(age) {
  const unit = UNITS.find((candidate) => age >= candidate.milliseconds);
  return `${Math.floor(age / unit.milliseconds)} ${unit.name} ago`;
}
