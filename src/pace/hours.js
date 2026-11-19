import { MS_PER_DAY, MS_PER_HOUR } from "./time.js";

export const WINDOW_DAYS = 4;
export const DAILY_CAP_HOURS = 10;
export const ROLLING_DAYS = 14;

export function hoursPerDay(sessions, asOfDay) {
  const days = activeDays(sessions, asOfDay);
  if (days.length < WINDOW_DAYS) return { status: "insufficient", activeDays: days.length };
  const windowHours = days
    .slice(-WINDOW_DAYS)
    .map(([, hours]) => clampToDailyCap(hours));
  return { status: "ok", hoursPerDay: windowHours.reduce((sum, hours) => sum + hours, 0) / windowHours.length };
}

export function activeDays(sessions, asOfDay) {
  return [...hoursByStartDay(sessions).entries()]
    .filter(([day]) => isWithinRollingWindow(day, asOfDay))
    .sort(([dayA], [dayB]) => dayA.localeCompare(dayB));
}

export function hoursByStartDay(sessions) {
  const hoursByDay = new Map();
  sessions.forEach((session) => {
    const { day } = session[0];
    const spanHours = (session.at(-1).at - session[0].at) / MS_PER_HOUR;
    hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + spanHours);
  });
  return hoursByDay;
}

export function clampToDailyCap(hours) {
  return Math.min(hours, DAILY_CAP_HOURS);
}

function isWithinRollingWindow(day, asOfDay) {
  const daysBack = (Date.parse(`${asOfDay}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / MS_PER_DAY;
  return daysBack < ROLLING_DAYS;
}
