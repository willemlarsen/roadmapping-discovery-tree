import { isCalendarDate } from "../validate.js";

export const MAX_LOG_CHARACTERS = 1_000_000;
export const MAX_LOG_LINES = 20_000;
export const MAX_LINE_CHARACTERS = 500;
const FIELD_SEPARATOR = "\u001f";
const HASH = /^[0-9a-f]{7,40}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const AUTHOR_DATE = /^(?<day>\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|(?<sign>[+-])(?<hours>[01]\d|2[0-3]):(?<minutes>[0-5]\d))$/;

export class LogParseError extends Error {
  constructor(code, line = null) {
    super(line === null ? `log: ${code}` : `line ${line}: ${code}`);
    this.name = "LogParseError";
    this.code = code;
    this.line = line;
  }
}

export function parseLog(text) {
  if (typeof text !== "string") throw new LogParseError("not_text");
  if (text.length > MAX_LOG_CHARACTERS) throw new LogParseError("log_too_large");
  const lines = text.split("\n");
  if (lines.length > MAX_LOG_LINES) throw new LogParseError("too_many_lines");
  return lines.flatMap((line, index) => (line === "" ? [] : [parseLine(line, index + 1)]));
}

function parseLine(line, lineNumber) {
  if (line.length > MAX_LINE_CHARACTERS) throw new LogParseError("line_too_long", lineNumber);
  const fields = line.split(FIELD_SEPARATOR);
  if (fields.length !== 3) throw new LogParseError("wrong_field_count", lineNumber);
  const [hash, authorDate, subject] = fields;
  if (!HASH.test(hash)) throw new LogParseError("invalid_hash", lineNumber);
  const parts = AUTHOR_DATE.exec(authorDate)?.groups;
  if (!parts || !isCalendarDate(parts.day)) throw new LogParseError("invalid_date", lineNumber);
  if (!isCleanSubject(subject)) throw new LogParseError("invalid_subject", lineNumber);
  return { hash, at: Date.parse(authorDate), day: parts.day, offsetMinutes: offsetMinutes(parts), subject };
}

function offsetMinutes({ sign, hours = "0", minutes = "0" }) {
  const magnitude = Number(hours) * 60 + Number(minutes);
  return sign === "-" ? 0 - magnitude : magnitude;
}

function isCleanSubject(subject) {
  return subject !== "" && !CONTROL_CHARACTERS.test(subject);
}
