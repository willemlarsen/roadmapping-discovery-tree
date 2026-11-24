const IN_PROGRESS = new Set(["now", "merged"]);

// First match wins; a parent no rule matches shows next.
const PARENT_RULES = [
  { state: "now", holds: (states) => states.some((state) => IN_PROGRESS.has(state)) },
];

export function displayedStates(problems) {
  const stateOf = (problem) => {
    const parts = problems.filter((entry) => entry.parent === problem.id);
    return parts.length === 0 ? problem.status : fromParts(parts.map((part) => part.status));
  };
  return new Map(problems.map((problem) => [problem.id, stateOf(problem)]));
}

function fromParts(states) {
  return PARENT_RULES.find((rule) => rule.holds(states))?.state ?? "next";
}
