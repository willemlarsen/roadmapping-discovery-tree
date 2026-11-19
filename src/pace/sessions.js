import { MS_PER_MINUTE } from "./time.js";

export function sessions(commits, gapMinutes) {
  const ordered = [...commits].sort((a, b) => a.at - b.at);
  const found = [];
  ordered.forEach((commit, index) => {
    const startsNewSession = index === 0 || commit.at - ordered[index - 1].at > gapMinutes * MS_PER_MINUTE;
    if (startsNewSession) found.push([]);
    found[found.length - 1].push(commit);
  });
  return found;
}
