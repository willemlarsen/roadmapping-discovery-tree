export function displayedStates(problems) {
  const stateOf = (problem) => {
    const parts = problems.filter((entry) => entry.parent === problem.id);
    return parts.length === 0 ? problem.status : "next";
  };
  return new Map(problems.map((problem) => [problem.id, stateOf(problem)]));
}
