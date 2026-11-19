const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const matches = (re) => (v) => typeof v === "string" && re.test(v);
const oneOf = (...allowed) => (v) => allowed.includes(v);
const orNull = (rule) => (v) => v === null || rule(v);
const numberIn = (lo, hi) => (v) => typeof v === "number" && v >= lo && v <= hi;
const integerIn = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const list = (max, itemRules) => ({ max, itemRules });

const nodeId = matches(/^[a-z0-9-]{1,40}$/);
const timestamp = matches(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?Z$/);

const NODE = {
  id: nodeId,
  parent: orNull(nodeId),
  problem: matches(/^[^\u0000-\u001f\u007f-\u009f]{1,300}$/),
  status: oneOf("next", "now", "blocked", "paused", "merged", "done", "parked"),
  order: integerIn(0, 9999),
  doneOn: orNull(matches(/^\d{4}-\d{2}-\d{2}$/)),
};
const FORECAST_ITEM = { id: nodeId, p95Hours: numberIn(0, 10000) };
const SNAPSHOT = {
  schemaVersion: (v) => v === 1,
  productId: matches(/^[a-z0-9][a-z0-9-]{0,63}$/),
  sourceRevision: matches(/^[0-9a-fA-F]{7,40}$/),
  generatedAt: timestamp,
  sourceCommittedAt: timestamp,
  goal: (v) => typeof v === "string" && v.length <= 300,
  nodes: list(500, NODE),
  forecast: list(Infinity, FORECAST_ITEM),
};
const OPTIONAL = ["forecast"];

const join = (prefix, key) => (prefix ? `${prefix}.${key}` : key);

function checkList(value, { max, itemRules }, path, out) {
  if (!Array.isArray(value) || value.length > max) return out.push(path);
  value.forEach((item, i) => checkObject(item, itemRules, `${path}[${i}]`, out, []));
}

function checkField(value, rule, path, out) {
  if (typeof rule === "function") {
    if (!rule(value)) out.push(path);
  } else {
    checkList(value, rule, path, out);
  }
}

function checkObject(value, rules, path, out, optional) {
  if (!isObject(value)) return out.push(path || "$");
  for (const key of Object.keys(value)) {
    if (!(key in rules)) out.push(join(path, key));
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (key in value) checkField(value[key], rule, join(path, key), out);
    else if (!optional.includes(key)) out.push(join(path, key));
  }
}

export function validateSnapshot(snapshot) {
  const out = [];
  checkObject(snapshot, SNAPSHOT, "", out, OPTIONAL);
  return out;
}
