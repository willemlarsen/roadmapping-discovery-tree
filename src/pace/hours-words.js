export function workingHoursWords(p85Hours) {
  const phrase = workingHoursPhrase(p85Hours);
  return phrase === null ? null : `About ${phrase} left (85% likely)`;
}

export function workingHoursPhrase(p85Hours) {
  if (!isValidHours(p85Hours)) return null;
  const hours = Math.max(1, Math.ceil(p85Hours));
  return `${hours} ${hours === 1 ? "working hour" : "working hours"}`;
}

function isValidHours(value) {
  return Number.isFinite(value) && value >= 0;
}
