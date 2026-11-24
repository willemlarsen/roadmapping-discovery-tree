import { validatePace } from "./validate.js";

export function forecastOf(paceText, roadmap, changedAt) {
  if (paceText === null) return { state: "missing" };
  const pace = parseJson(paceText);
  return validatePace(pace, roadmap, changedAt);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
