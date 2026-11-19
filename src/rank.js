export function rankProblems(sequence) {
  const entries = sequence.filter(isFeature).map((problem) => ({
    id: problem.id,
    value: problem.value ?? null,
    size: problem.size ?? null,
  }));
  const estimated = entries.filter(isEstimated).sort(byValuePerSize);
  const unestimated = entries.filter((entry) => !isEstimated(entry));
  return [
    ...estimated.map((entry, index) => withPriority(entry, index + 1)),
    ...unestimated.map((entry) => withPriority(entry, null)),
  ];
}

function withPriority({ id, value, size }, priority) {
  return { id, priority, value, size };
}

function isEstimated(entry) {
  return entry.value !== null && entry.size !== null;
}

function byValuePerSize(left, right) {
  return right.value / right.size - left.value / left.size;
}

function isFeature(problem) {
  return !problem.parent;
}
