import { clampToDailyCap, hoursByStartDay } from "./hours.js";
import { sessions } from "./sessions.js";

export function actualHours(commits, gapMinutes) {
  const dailyHours = [...hoursByStartDay(sessions(commits, gapMinutes)).values()];
  return dailyHours.reduce((sum, hours) => sum + clampToDailyCap(hours), 0);
}
