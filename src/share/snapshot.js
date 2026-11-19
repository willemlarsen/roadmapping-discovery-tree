const projectNode = ({ id, parent, problem, status, order, doneOn }) =>
  Object.freeze({ id, parent, problem, status, order, doneOn });

const MAX_HOURS = 10000;
const oneDecimal = (hours) => Math.min(MAX_HOURS, Math.round(hours * 10) / 10);

function forecastOf(pace, problems) {
  if (!Array.isArray(pace?.results)) return Object.freeze([]);
  const ids = new Set(problems.map((problem) => problem.id));
  return Object.freeze(pace.results.filter((result) => ids.has(result.id))
    .map(({ id, p95Hours }) => Object.freeze({ id, p95Hours: oneDecimal(p95Hours) })));
}

export const SNAPSHOT_SCHEMA_VERSION = 1;

export function buildSnapshot({ roadmap, pace, productId, sourceRevision, sourceCommittedAt, generatedAt }) {
  return Object.freeze({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    productId,
    sourceRevision,
    generatedAt,
    sourceCommittedAt,
    goal: roadmap.goal,
    nodes: Object.freeze(roadmap.problems.map(projectNode)),
    forecast: forecastOf(pace, roadmap.problems),
  });
}
