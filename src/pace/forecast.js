import { validatePace } from "./validate.js";

export function forecastOf(paceText, roadmap, now) {
  if (paceText === null) return { state: "missing" };
  const pace = parseJson(paceText);
  return validatePace(pace, roadmap, now);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
