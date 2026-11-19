import { MS_PER_DAY, MS_PER_MINUTE } from "./time.js";

const DAYS_PER_WEEK = 7;
const WORKDAYS_PER_WEEK = 5;
const LAST_WORKDAY_INDEX = WORKDAYS_PER_WEEK - 1;

export function dayInOffset(instant, offsetMinutes) {
  return new Date(Date.parse(instant) + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 10);
}

export function toDates({ p50Hours, p85Hours }, hoursPerDay, from) {
  return {
    p50Date: doneOn(from, p50Hours, hoursPerDay),
    p85Date: doneOn(from, p85Hours, hoursPerDay),
  };
}

function doneOn(from, hours, hoursPerDay) {
  return addWorkdays(from, Math.ceil(hours / hoursPerDay));
}

function addWorkdays(fromDay, workdays) {
  const start = Date.parse(`${fromDay}T00:00:00Z`);
  const weekday = mondayBasedWeekday(start);
  const mondayOfStartWeek = start - weekday * MS_PER_DAY;
  const workdayNumber = workdays + Math.min(weekday, LAST_WORKDAY_INDEX);
  const weeks = Math.floor(workdayNumber / WORKDAYS_PER_WEEK);
  const dayInWeek = workdayNumber % WORKDAYS_PER_WEEK;
  return new Date(mondayOfStartWeek + (weeks * DAYS_PER_WEEK + dayInWeek) * MS_PER_DAY).toISOString().slice(0, 10);
}

function mondayBasedWeekday(milliseconds) {
  return (new Date(milliseconds).getUTCDay() + 6) % DAYS_PER_WEEK;
}
