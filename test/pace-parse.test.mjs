import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLog, MAX_LOG_CHARACTERS, MAX_LOG_LINES, MAX_LINE_CHARACTERS } from "../src/pace/parse.js";

const SEPARATOR = "\u001f";
const logLine = (...fields) => fields.join(SEPARATOR);

test("well-formed log lines become commits carrying the author's own calendar day", () => {
  const text = [
    logLine("2efa1c3", "2026-10-30T09:15:00-07:00", "F4: hoursPerDay averages (gov-5c0000000005)"),
    logLine("2f7e867", "2026-10-31T00:30:00+09:00", "F5: insufficient history"),
  ].join("\n") + "\n";

  const commits = parseLog(text);

  assert.deepEqual(commits, [
    { hash: "2efa1c3", at: Date.parse("2026-10-30T16:15:00Z"), day: "2026-10-30", offsetMinutes: -420, subject: "F4: hoursPerDay averages (gov-5c0000000005)" },
    { hash: "2f7e867", at: Date.parse("2026-10-30T15:30:00Z"), day: "2026-10-31", offsetMinutes: 540, subject: "F5: insufficient history" },
  ]);
});

test("a malformed log line is refused with a closed code and its line number, never echoing the line", () => {
  const good = logLine("2efa1c3", "2026-10-30T09:15:00-07:00", "F4: hoursPerDay averages");
  const malformed = [
    ["wrong_field_count", logLine("2efa1c3", "2026-10-30T09:15:00-07:00")],
    ["wrong_field_count", logLine("2efa1c3", "2026-10-30T09:15:00-07:00", "subject", "extra")],
    ["invalid_hash", logLine("not-a-hash", "2026-10-30T09:15:00-07:00", "subject")],
    ["invalid_hash", logLine("abc123", "2026-10-30T09:15:00-07:00", "subject")],
    ["invalid_hash", logLine("a".repeat(41), "2026-10-30T09:15:00-07:00", "subject")],
    ["invalid_date", logLine("2efa1c3", "yesterday", "subject")],
    ["invalid_date", logLine("2efa1c3", "2026-02-30T09:15:00-07:00", "subject")],
    ["invalid_date", logLine("2efa1c3", "2026-10-30T24:00:00Z", "subject")],
    ["invalid_date", logLine("2efa1c3", "2026-10-30T09:60:00Z", "subject")],
    ["invalid_date", logLine("2efa1c3", "2026-10-30T09:15:00", "subject")],
    ["invalid_date", logLine("2efa1c3", "2026-10-30T09:15:00+24:00", "subject")],
  ];

  const refusals = malformed.map(([, line]) => () => parseLog(`${good}\n\n${line}\n`));

  refusals.forEach((refusal, index) => assert.throws(refusal, {
    name: "LogParseError",
    code: malformed[index][0],
    line: 3,
    message: `line 3: ${malformed[index][0]}`,
  }, malformed[index][0]));
});

test("a subject that is empty or holds control characters is refused as invalid_subject", () => {
  const dirtySubjects = ["", "bell\u0007", "escape\u001b[31m", "nul\u0000", "tab\there", "delete\u007f", "next\u0085line", "last\u009f"];
  const refusals = dirtySubjects.map((subject) =>
    () => parseLog(`${logLine("2efa1c3", "2026-10-30T09:15:00-07:00", subject)}\n`));
  const accented = parseLog(`${logLine("2efa1c3", "2026-10-30T09:15:00-07:00", "café — done ✓")}\n`);

  refusals.forEach((refusal, index) => assert.throws(refusal, {
    name: "LogParseError",
    code: "invalid_subject",
    line: 1,
    message: "line 1: invalid_subject",
  }, JSON.stringify(dirtySubjects[index])));
  assert.equal(accented[0].subject, "café — done ✓");
});

test("input beyond the size limits is refused with a closed code, and input at the limits still parses", () => {
  const prefixLength = logLine("2efa1c3", "2026-10-30T09:15:00-07:00", "").length;
  const validLine = (length) => logLine("2efa1c3", "2026-10-30T09:15:00-07:00", "s".repeat(length - prefixLength));
  const refused = [
    ["not_text", [undefined, null, 42, ["a log line"]], null],
    ["log_too_large", ["x".repeat(MAX_LOG_CHARACTERS + 1)], null],
    ["too_many_lines", ["\n".repeat(MAX_LOG_LINES)], null],
    ["line_too_long", [`${validLine(60)}\n${"x".repeat(MAX_LINE_CHARACTERS + 1)}\n`], 2],
  ];
  const linesAtTextLimit = MAX_LOG_CHARACTERS / MAX_LINE_CHARACTERS;
  const atTextLimit = Array(linesAtTextLimit).fill(validLine(MAX_LINE_CHARACTERS - 1)).join("\n") + "\n";

  const atLimits = [parseLog("\n".repeat(MAX_LOG_LINES - 1)), parseLog(validLine(MAX_LINE_CHARACTERS)), parseLog(atTextLimit)];

  refused.forEach(([code, texts, line]) => texts.forEach((text) => assert.throws(() => parseLog(text), {
    name: "LogParseError",
    code,
    line,
    message: line === null ? `log: ${code}` : `line ${line}: ${code}`,
  }, code)));
  assert.deepEqual(atLimits.map((commits) => commits.length), [0, 1, linesAtTextLimit]);
  assert.equal(atTextLimit.length, MAX_LOG_CHARACTERS);
});

test("parsed commits carry the author's UTC offset in minutes", () => {
  const dates = ["2026-10-30T09:15:00Z", "2026-10-30T09:15:00-07:00", "2026-10-31T00:30:00+09:00", "2026-10-30T09:15:00+05:30", "2026-10-30T09:15:00-00:00"];
  const text = dates.map((date) => logLine("2efa1c3", date, "subject")).join("\n");

  const commits = parseLog(text);

  assert.deepEqual(commits.map((commit) => commit.offsetMinutes), [0, -420, 540, 330, 0]);
});
