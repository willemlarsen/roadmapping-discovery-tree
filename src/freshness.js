const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function freshnessLine(entries, now) {
  const newest = Math.max(...entries.map((entry) => Date.parse(entry.at)));
  const days = Math.floor((Date.parse(now) - newest) / MILLISECONDS_PER_DAY);
  return `Roadmap last changed ${days} days ago`;
}
