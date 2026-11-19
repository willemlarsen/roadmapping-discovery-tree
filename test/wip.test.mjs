import { test } from "node:test";
import assert from "node:assert/strict";
import { innermostWorking, wipStatus } from "../src/wip.js";

const problem = (id, parent, status) => ({ id, parent, status, order: 1, problem: `Problem ${id}` });

test("wipStatus counts now and blocked problems that have no now or blocked child, against the limit", () => {
  const roadmap = {
    wipLimit: 3,
    problems: [
      problem("up-001", null, "now"),
      problem("up-011", "up-001", "now"),
      problem("up-002", null, "blocked"),
      problem("up-003", null, "next"),
      problem("up-004", null, "paused"),
      problem("up-005", null, "now"),
      problem("up-051", "up-005", "next"),
    ],
  };

  const status = wipStatus(roadmap);

  assert.deepEqual(status, { count: 3, limit: 3 });
});

test("innermostWorking returns only the child of a now parent with a now child, not the parent or a next card", () => {
  const roadmap = {
    problems: [
      problem("up-001", null, "now"),
      problem("up-011", "up-001", "now"),
      problem("up-003", null, "next"),
    ],
  };

  const innermost = innermostWorking(roadmap);

  assert.deepEqual(innermost.map((entry) => entry.id), ["up-011"]);
});
