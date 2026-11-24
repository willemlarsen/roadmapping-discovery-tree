export function displayedStates(problems) {
  return new Map(problems.map((problem) => [problem.id, problem.status]));
}
