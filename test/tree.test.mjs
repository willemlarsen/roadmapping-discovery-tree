import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree } from "../src/tree.js";

function problem(id, parent, order) {
  return { id, parent, order, problem: `Problem ${id}`, status: "next" };
}

const roadmap = {
  goal: "Willem always knows where we are",
  problems: [problem("up-002", null, 2), problem("up-003", "up-001", 1), problem("up-001", null, 1)],
};

test("buildTree carries the goal to the root", () => {
  assert.equal(buildTree(roadmap).goal, "Willem always knows where we are");
});

test("buildTree nests a problem under its parent", () => {
  const parent = buildTree(roadmap).children.find((node) => node.id === "up-001");

  assert.deepEqual(parent.children.map((node) => node.id), ["up-003"]);
});

test("buildTree orders siblings by ascending order", () => {
  assert.deepEqual(buildTree(roadmap).children.map((node) => node.id), ["up-001", "up-002"]);
});

test("buildTree freezes nested nodes", () => {
  const nestedNode = buildTree(roadmap).children[0].children[0];

  assert.throws(() => { nestedNode.problem = "changed"; }, TypeError);
  assert.equal(nestedNode.problem, "Problem up-003");
});

test("buildTree freezes nested child lists", () => {
  const nestedNode = buildTree(roadmap).children[0].children[0];

  assert.throws(() => { nestedNode.children.push(problem("up-999", "up-003", 1)); }, TypeError);
});

test("buildTree carries each problem's status details to its node", () => {
  const detailed = { ...problem("up-004", null, 1), status: "blocked", statusSince: "2026-10-28", waitingOn: "a review", resumesAfter: "up-001", doneOn: "2026-10-30", confirmedBy: "Amal" };

  const [node] = buildTree({ goal: "Goal", problems: [detailed] }).children;

  assert.deepEqual(
    { statusSince: node.statusSince, waitingOn: node.waitingOn, resumesAfter: node.resumesAfter, doneOn: node.doneOn, confirmedBy: node.confirmedBy },
    { statusSince: "2026-10-28", waitingOn: "a review", resumesAfter: "up-001", doneOn: "2026-10-30", confirmedBy: "Amal" },
  );
});

test("buildTree splits parked problems out of the tree into a list ordered by order", () => {
  const parked = (id, order) => ({ ...problem(id, null, order), status: "parked" });
  const mixed = { goal: "Goal", problems: [problem("up-001", null, 1), parked("up-008", 2), parked("up-009", 1)] };

  const tree = buildTree(mixed);

  assert.deepEqual(
    { drawn: tree.children.map((node) => node.id), parked: tree.parked.map((node) => node.id) },
    { drawn: ["up-001"], parked: ["up-009", "up-008"] },
  );
});

test("buildTree flags a done node with a child that is not done, and no other node", () => {
  const entry = (id, parent, status) => ({ ...problem(id, parent, 1), status });
  const roadmap = {
    goal: "Goal",
    problems: [
      entry("up-001", null, "done"), entry("up-002", "up-001", "done"), entry("up-003", "up-001", "now"),
      entry("up-004", null, "done"), entry("up-005", "up-004", "done"),
      entry("up-006", null, "now"), entry("up-007", "up-006", "next"),
    ],
  };

  const tree = buildTree(roadmap);

  assert.deepEqual(tree.children.map((node) => [node.id, node.doneWithOpenChild]), [["up-001", true], ["up-004", false], ["up-006", false]]);
});
