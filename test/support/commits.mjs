const MS_PER_MINUTE = 60_000;

export function commitAt(minute, subject = `commit at minute ${minute}`) {
  return { at: minute * MS_PER_MINUTE, subject };
}

export function cycleAt(minute) {
  return commitAt(minute, `C${minute}: a behaviour (gov-0123456789ab)`);
}

export function sessionOn(day, startHour, hours) {
  const start = Date.parse(`${day}T00:00:00Z`) + startHour * 60 * MS_PER_MINUTE;
  const commitAtOffset = (offsetHours) => ({ at: start + offsetHours * 60 * MS_PER_MINUTE, day, subject: "work" });
  return [commitAtOffset(0), commitAtOffset(hours)];
}

export function workdayOn(day, { cycles = 4, spacingMinutes = 30, offsetMinutes = 0 } = {}) {
  const start = Date.parse(`${day}T09:00:00Z`);
  return Array.from({ length: cycles }, (_, index) => ({
    at: start + index * spacingMinutes * MS_PER_MINUTE,
    day,
    offsetMinutes,
    subject: `C${index + 1}: a behaviour (gov-${day.replaceAll("-", "")})`,
  }));
}

export function buildStartedLaterOn(day) {
  return { at: Date.parse(`${day}T20:00:00Z`), day, offsetMinutes: 0, subject: "N1: a build still going (gov-feedfacecafe)" };
}
