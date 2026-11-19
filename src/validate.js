const KNOWN_STATUSES = new Set(["next", "now", "blocked", "paused", "merged", "done", "parked"]);
const isText = (value) => typeof value === "string";
const isNumber = (value) => typeof value === "number";
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const PROBLEM_SCHEMA = {
  kinds: { id: isText, problem: isText, slices: isSliceList, order: isNumber, statusSince: isText },
  ranges: { order: isPositiveInteger },
};
const ESTIMATE_FIELDS = ["value", "size"];
export const ESTIMATE_SCALE = new Set([1, 2, 3, 5, 8]);
const PROBLEM_LINK_FIELDS = ["parent"];
const FIELDS_A_STATUS_REQUIRES = new Map([
  ["blocked", ["waitingOn"]],
  ["paused", ["resumesAfter"]],
  ["done", ["doneOn", "confirmedBy"]],
]);
const DONE_ONLY_FIELDS = FIELDS_A_STATUS_REQUIRES.get("done");
const DATE_FIELDS = ["statusSince", "doneOn"];
const STATUS_DETAIL_FIELDS = ["waitingOn", "resumesAfter", "confirmedBy", "doneOn"];
const ROADMAP_SCHEMA = {
  kinds: { goal: isText, wipLimit: isNumber, staleAfterDays: isNumber },
  ranges: { wipLimit: isPositiveInteger, staleAfterDays: isPositiveInteger },
};
const KNOWN_ROADMAP_KEYS = new Set(["version", "goal", "wipLimit", "staleAfterDays", "problems"]);
const KNOWN_PROBLEM_KEYS = new Set([
  "id", "parent", "problem", "status", "statusSince", "order", "slices",
  "waitingOn", "resumesAfter", "doneOn", "confirmedBy", ...ESTIMATE_FIELDS,
]);
const PROBLEM_FIELDS = Object.keys(PROBLEM_SCHEMA.kinds);
const ROADMAP_FIELDS = [...Object.keys(ROADMAP_SCHEMA.kinds), "problems"];
const LEAF_FIELDS_SPEC = fieldsSpec(PROBLEM_FIELDS, PROBLEM_SCHEMA, isBlank);
const PARENT_FIELDS_SPEC = fieldsSpec(PROBLEM_FIELDS, PROBLEM_SCHEMA, isBlankText);
const ROADMAP_FIELDS_SPEC = fieldsSpec(ROADMAP_FIELDS, ROADMAP_SCHEMA, isBlankText);

function fieldsSpec(fields, { kinds, ranges }, isEmpty) {
  return {
    fields,
    rules: [
      { reason: "missing_field", breaks: (value) => value === undefined },
      { reason: "empty_field", breaks: isEmpty },
      { reason: "wrong_type", breaks: (value, field) => isPresent(value) && field in kinds && !kinds[field](value) },
      { reason: "out_of_range", breaks: (value, field) => field in ranges && kinds[field](value) && !ranges[field](value) },
    ],
  };
}

function isPresent(value) {
  return value !== undefined && value !== null;
}

export function validateRoadmap(roadmap) {
  if (!isRecord(roadmap)) return verdict([validationError(null, "wrong_type", { field: "roadmap" })]);
  const { records, errors: shapeErrors } = problemRecords(roadmap.problems);
  const tree = treeIndex(records);
  const errors = [
    ...fieldErrors(roadmap, ROADMAP_FIELDS_SPEC, null),
    ...unknownFieldErrors(roadmap, KNOWN_ROADMAP_KEYS, null),
    ...versionErrors(roadmap),
    ...shapeErrors,
    ...records.flatMap((entry) => problemErrors(entry, tree.parentIds)),
    ...duplicateIdErrors(records),
    ...duplicateOrderErrors(records),
    ...problemLinkErrors(records, tree),
  ];
  return verdict(errors);
}

function versionErrors({ version }) {
  if (!isPresent(version)) return [];
  if (!isNumber(version)) return [validationError(null, "wrong_type", { field: "version" })];
  return isPositiveInteger(version) ? [] : [validationError(null, "out_of_range", { field: "version" })];
}

function verdict(errors) {
  return { valid: errors.length === 0, errors };
}

function problemRecords(problems) {
  if (problems === undefined || problems === null) return { records: [], errors: [] };
  if (!Array.isArray(problems)) return { records: [], errors: [validationError(null, "wrong_type", { field: "problems" })] };
  return {
    records: problems.filter(isRecord),
    errors: problems.flatMap((entry, index) =>
      isRecord(entry) ? [] : [validationError(null, "wrong_type", { field: "problems", index })]),
  };
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function problemErrors(entry, parentIds) {
  const spec = parentIds.has(entry.id) ? PARENT_FIELDS_SPEC : LEAF_FIELDS_SPEC;
  const problemId = problemIdOf(entry);
  return [
    ...statusErrors(entry, problemId),
    ...fieldErrors(entry, spec, problemId),
    ...missingLinkErrors(entry, problemId),
    ...statusFieldErrors(entry, problemId),
    ...statusDetailKindErrors(entry, problemId),
    ...doneOnlyFieldErrors(entry, problemId),
    ...dateErrors(entry, problemId),
    ...estimateErrors(entry, problemId),
    ...unknownFieldErrors(entry, KNOWN_PROBLEM_KEYS, problemId),
  ];
}

function statusErrors(entry, problemId) {
  return KNOWN_STATUSES.has(entry.status) ? [] : [validationError(problemId, "unknown_status")];
}

function fieldErrors(record, { fields, rules }, problemId) {
  return rules.flatMap((rule) => fields
    .filter((field) => rule.breaks(record[field], field))
    .map((field) => validationError(problemId, rule.reason, { field })));
}

function validationError(problemId, reason, details = {}) {
  return { problemId, reason, ...details };
}

function isBlankText(value) {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function isNonBlankText(value) {
  return isText(value) && value.trim() !== "";
}

function isBlank(value) {
  return isBlankText(value) || (Array.isArray(value) && value.length === 0);
}

function isSliceList(value) {
  return Array.isArray(value) && value.every(isNonBlankText);
}

function unknownFieldErrors(record, knownKeys, problemId) {
  return Object.keys(record).some((key) => !knownKeys.has(key)) ? [validationError(problemId, "unknown_field")] : [];
}

function duplicateIdErrors(records) {
  return repeatedValues(records.map((entry) => entry.id).filter(isText))
    .map((id) => validationError(id, "duplicate_id"));
}

function repeatedValues(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].filter(([, count]) => count > 1).map(([value]) => value);
}

function duplicateOrderErrors(records) {
  const siblingsByParent = groupBy(records.filter((entry) => isNumber(entry.order)), (entry) => entry.parent ?? null);
  return [...siblingsByParent]
    .filter(([, siblings]) => repeatedValues(siblings.map((entry) => entry.order)).length > 0)
    .map(([parent]) => validationError(null, "duplicate_order", { parent }));
}

function groupBy(values, keyOf) {
  const groups = new Map();
  values.forEach((value) => groups.set(keyOf(value), [...(groups.get(keyOf(value)) ?? []), value]));
  return groups;
}

function unknownParentErrors(records, ids) {
  return records
    .filter((entry) => isPresent(entry.parent) && !ids.has(entry.parent))
    .map((entry) => validationError(problemIdOf(entry), "unknown_parent"));
}

function problemIdOf(entry) {
  return entry.id ?? null;
}

function missingLinkErrors(entry, problemId) {
  return PROBLEM_LINK_FIELDS
    .filter((field) => entry[field] === undefined)
    .map((field) => validationError(problemId, "missing_field", { field }));
}

function directCycleErrors(records) {
  return records
    .filter((entry) => isPresent(entry.parent) && entry.parent === entry.id)
    .map((entry) => validationError(problemIdOf(entry), "direct_cycle"));
}

function treeIndex(records) {
  return {
    ids: new Set(records.map((entry) => entry.id)),
    parentIds: new Set(records.filter((entry) => entry.parent !== entry.id).map((entry) => entry.parent)),
    parentOf: new Map(records.map((entry) => [entry.id, entry.parent])),
  };
}

function indirectCycleErrors(records, parentOf) {
  return records
    .filter((entry) => findParentCycle(entry.id, parentOf))
    .map((entry) => validationError(problemIdOf(entry), "indirect_cycle"));
}

export function ancestorsAbove(id, parentOf) {
  const seen = new Set([id]);
  const above = [];
  let current = parentOf.get(id);
  while (isPresent(current) && !seen.has(current)) {
    seen.add(current);
    above.push(current);
    current = parentOf.get(current);
  }
  return above;
}

function findParentCycle(start, parentOf) {
  const above = ancestorsAbove(start, parentOf);
  return above.length > 0 && parentOf.get(above.at(-1)) === start;
}

function problemLinkErrors(records, tree) {
  return [
    ...unknownParentErrors(records, tree.ids),
    ...directCycleErrors(records),
    ...indirectCycleErrors(records, tree.parentOf),
    ...parkedParentErrors(records, tree.parentIds),
    ...nextWithNowDescendantErrors(records, tree.parentOf),
    ...nextWithNowPartErrors(records),
    ...unknownResumesAfterErrors(records, tree.ids),
  ];
}

function parkedParentErrors(records, parentIds) {
  return records
    .filter((entry) => entry.status === "parked" && parentIds.has(entry.id))
    .map((entry) => validationError(problemIdOf(entry), "parked_has_children"));
}

function nextWithNowPartErrors(records) {
  const parentsOfNowParts = new Set(records.filter((entry) => entry.status === "now").map((entry) => entry.parent));
  return records
    .filter((entry) => entry.status === "next" && parentsOfNowParts.has(entry.id))
    .map((entry) => validationError(problemIdOf(entry), "next_has_now_part"));
}

function nextWithNowDescendantErrors(records, parentOf) {
  const nowRecords = records.filter((entry) => entry.status === "now");
  const parentsOfNowParts = new Set(nowRecords.map((entry) => entry.parent));
  const nextIds = new Set(records.filter((entry) => entry.status === "next").map((entry) => entry.id));
  const nowAncestors = new Set(nowRecords.flatMap((entry) => ancestorsAbove(entry.id, parentOf)));
  return records
    .filter((entry) => nextIds.has(entry.id) && nowAncestors.has(entry.id) && !parentsOfNowParts.has(entry.id))
    .map((entry) => validationError(problemIdOf(entry), "next_has_now_descendant"));
}

function statusFieldErrors(entry, problemId) {
  return (FIELDS_A_STATUS_REQUIRES.get(entry.status) ?? [])
    .filter((field) => isBlankText(entry[field]))
    .map((field) => validationError(problemId, "missing_field", { field }));
}

function statusDetailKindErrors(entry, problemId) {
  return STATUS_DETAIL_FIELDS
    .filter((field) => isPresent(entry[field]) && !isText(entry[field]))
    .map((field) => validationError(problemId, "wrong_type", { field }));
}

function estimateErrors(entry, problemId) {
  return ESTIMATE_FIELDS
    .filter((field) => isPresent(entry[field]) && !ESTIMATE_SCALE.has(entry[field]))
    .map((field) => validationError(problemId, Number.isInteger(entry[field]) ? "out_of_range" : "wrong_type", { field }));
}

function unknownResumesAfterErrors(records, ids) {
  return records
    .filter((entry) => entry.status === "paused" && isNonBlankText(entry.resumesAfter))
    .filter((entry) => !ids.has(entry.resumesAfter) || entry.resumesAfter === entry.id)
    .map((entry) => validationError(problemIdOf(entry), "unknown_resumes_after"));
}

function doneOnlyFieldErrors(entry, problemId) {
  if (entry.status === "done") return [];
  return DONE_ONLY_FIELDS
    .filter((field) => isPresent(entry[field]))
    .map((field) => validationError(problemId, "not_done_yet", { field }));
}

function dateErrors(entry, problemId) {
  return DATE_FIELDS
    .filter((field) => isNonBlankText(entry[field]) && !isCalendarDate(entry[field]))
    .map((field) => validationError(problemId, "invalid_date", { field }));
}

export function isCalendarDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(text);
}
