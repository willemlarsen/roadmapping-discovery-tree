import { ESTIMATE_SCALE, isCalendarDate, isRecord } from "./validate.js";

const LOG_FIELDS = ["at", "problemId", "actor", "action", "before", "after", "why"];
const KNOWN_ACTIONS = new Set(["coach-add", "coach-rerank", "coach-status", "coach-confirm-done", "willem-override", "coach-estimate", "willem-estimate-override"]);
const ESTIMATE_ACTIONS = new Set(["coach-estimate", "willem-estimate-override"]);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const STATUS_ACTIONS = new Set(["coach-status", "coach-confirm-done", "willem-override"]);

export function validateDecisionLog(entries, roadmap) {
  if (!Array.isArray(entries)) return verdict([logError(null, "wrong_type")]);
  const errors = [
    ...entries.flatMap((entry, index) => entryErrors(entry, index + 1)),
    ...orderErrors(entries),
    ...(roadmap ? roadmapErrors(entries, roadmap) : []),
  ];
  return verdict(errors);
}

export function deriveLastRerank(entries) {
  const reranks = entries.filter((entry) => isRecord(entry) && entry.action === "coach-rerank");
  const latest = reranks.at(-1);
  return latest ? { by: latest.actor, at: latest.at, why: latest.why } : null;
}

export function deriveLastEstimate(entries) {
  const estimates = entries.filter((entry) => isRecord(entry) && ESTIMATE_ACTIONS.has(entry.action));
  const latest = estimates.at(-1);
  return latest ? { by: latest.actor, at: latest.at } : null;
}

function verdict(errors) {
  return { valid: errors.length === 0, errors };
}

function entryErrors(entry, line) {
  if (!isRecord(entry)) return [logError(line, "wrong_type")];
  return [...missingFieldErrors(entry, line), ...unknownActionErrors(entry, line), ...invalidTimeErrors(entry, line), ...estimateAfterErrors(entry, line)];
}

function estimateAfterErrors(entry, line) {
  const isEstimateLine = ESTIMATE_ACTIONS.has(entry.action);
  return isEstimateLine && !isEstimate(entry.after) ? [logError(line, "wrong_type")] : [];
}

function isEstimate(after) {
  return isRecord(after) && ESTIMATE_SCALE.has(after.value) && ESTIMATE_SCALE.has(after.size);
}

function missingFieldErrors(entry, line) {
  return LOG_FIELDS
    .filter((field) => entry[field] === undefined)
    .map((field) => logError(line, "missing_field", { field }));
}

function unknownActionErrors(entry, line) {
  return entry.action !== undefined && !KNOWN_ACTIONS.has(entry.action) ? [logError(line, "unknown_action")] : [];
}

function invalidTimeErrors(entry, line) {
  return entry.at !== undefined && !isTimestamp(entry.at) ? [logError(line, "invalid_date", { field: "at" })] : [];
}

function isTimestamp(value) {
  return typeof value === "string" && TIMESTAMP.test(value) && isCalendarDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(value));
}

function orderErrors(entries) {
  return entries.flatMap((entry, index) => {
    const previous = entries[index - 1];
    const goesBack = index > 0 && isRecord(entry) && isRecord(previous) && Date.parse(entry.at) < Date.parse(previous.at);
    return goesBack ? [logError(index + 1, "out_of_order")] : [];
  });
}

function logError(line, reason, details = {}) {
  return { line, reason, ...details };
}

function roadmapErrors(entries, roadmap) {
  return [...agreementErrors(entries, roadmap), ...estimateAgreementErrors(entries, roadmap), ...unknownProblemErrors(entries, roadmap)];
}

function agreementErrors(entries, roadmap) {
  const latest = latestLines(entries, STATUS_ACTIONS);
  return roadmap.problems.flatMap((problem) => {
    const statusLine = latest.get(problem.id);
    return statusLine && statusLine.after !== problem.status
      ? [logError(statusLine.line, "status_disagrees", { problemId: problem.id })]
      : [];
  });
}

function estimateAgreementErrors(entries, roadmap) {
  const latest = latestLines(entries, ESTIMATE_ACTIONS);
  return roadmap.problems.flatMap((problem) => {
    const estimateLine = latest.get(problem.id);
    if (!estimateLine) return hasEstimate(problem) ? [logError(null, "estimate_disagrees", { problemId: problem.id })] : [];
    return !matchesEstimate(problem, estimateLine.after)
      ? [logError(estimateLine.line, "estimate_disagrees", { problemId: problem.id })]
      : [];
  });
}

function hasEstimate(problem) {
  return problem.value !== undefined || problem.size !== undefined;
}

function matchesEstimate(problem, after) {
  return isRecord(after) && problem.value === after.value && problem.size === after.size;
}

function unknownProblemErrors(entries, roadmap) {
  const ids = new Set(roadmap.problems.map((problem) => problem.id));
  return entries.flatMap((entry, index) =>
    isRecord(entry) && !ids.has(entry.problemId) ? [logError(index + 1, "unknown_problem", { problemId: entry.problemId })] : []);
}

function latestLines(entries, actions) {
  const latest = new Map();
  entries.forEach((entry, index) => {
    if (isRecord(entry) && actions.has(entry.action)) latest.set(entry.problemId, { line: index + 1, after: entry.after });
  });
  return latest;
}
