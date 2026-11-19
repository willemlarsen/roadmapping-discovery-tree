import { test } from "node:test";
import assert from "node:assert/strict";
import { pulsingIds } from "../src/pulse.js";

const problem = (id, parent, status) => ({ id, parent, status, order: 1, problem: `Problem ${id}` });

test("a now parent with a now child and a blocked sibling pulses only the child", () => {
  const roadmap = {
    problems: [
      problem("up-001", null, "now"),
      problem("up-011", "up-001", "now"),
      problem("up-002", null, "blocked"),
      problem("up-003", null, "next"),
    ],
  };

  const ids = pulsingIds(roadmap, false);

  assert.deepEqual([...ids], ["up-011"]);
});

test("a stale roadmap pulses nothing even with a now card", () => {
  const roadmap = { problems: [problem("up-011", null, "now")] };

  const ids = pulsingIds(roadmap, true);

  assert.deepEqual([...ids], []);
});
