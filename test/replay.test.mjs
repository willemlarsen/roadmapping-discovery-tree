import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyStep, replay, replayOptions } from "../scripts/replay.mjs";
import { GARDEN_STEPS } from "../scripts/replay-steps.mjs";
import { validateDecisionLog } from "../src/decisions.js";
import { displayedStates } from "../src/displayed-state.js";
import { forecastOrder } from "../src/pace/order.js";
import { validatePace } from "../src/pace/validate.js";
import { lastChangedAt } from "../src/freshness.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const AT = "2026-11-24T17:00:00Z";

const card = (id, status, order, extra = {}) => ({
  id, parent: null, problem: `Problem ${id}`, status, statusSince: "2026-11-02", order, slices: ["s"], waitingOn: null, resumesAfter: null, ...extra,
});

const state = () => ({
  roadmap: { version: 1, goal: "Goal", wipLimit: 2, staleAfterDays: 7, problems: [card("gp-901", "now", 1), card("gp-902", "next", 2)] },
  entries: [
    { at: "2026-11-02T09:00:00-08:00", problemId: "gp-901", actor: "Product Coach", action: "coach-add", before: null, after: "now", why: "Seeded" },
    { at: "2026-11-02T09:00:00-08:00", problemId: "gp-902", actor: "Product Coach", action: "coach-add", before: null, after: "next", why: "Seeded" },
  ],
});

test("applyStep marks a card done with the day and who confirmed it, as a confirm-done line", () => {
  const step = { say: "A card is solved", actor: "Product Coach", why: "Checked", changes: [{ card: "gp-901", status: "done" }] };

  const { roadmap, lines } = applyStep(step, state(), AT);

  assert.deepEqual(roadmap.problems[0], card("gp-901", "done", 1, { statusSince: "2026-11-24", doneOn: "2026-11-24", confirmedBy: "Product Coach" }));
  assert.deepEqual(lines, [{ at: AT, problemId: "gp-901", actor: "Product Coach", action: "coach-confirm-done", before: "now", after: "done", why: "Checked" }]);
});

test("applyStep re-ranks cards by swapping their order, one re-rank line per card", () => {
  const step = { say: "Re-rank", actor: "Product Coach", why: "Cheaper first", changes: [{ card: "gp-901", order: 2 }, { card: "gp-902", order: 1 }] };

  const { roadmap, lines } = applyStep(step, state(), AT);

  assert.deepEqual(roadmap.problems.map((problem) => [problem.id, problem.order, problem.statusSince]), [["gp-901", 2, "2026-11-02"], ["gp-902", 1, "2026-11-02"]]);
  assert.deepEqual(lines, [
    { at: AT, problemId: "gp-901", actor: "Product Coach", action: "coach-rerank", before: "1", after: "2", why: "Cheaper first" },
    { at: AT, problemId: "gp-902", actor: "Product Coach", action: "coach-rerank", before: "2", after: "1", why: "Cheaper first" },
  ]);
});

test("applyStep refuses a step whose roadmap or decision log would not validate, and a step naming an unknown card", () => {
  const blockedWithoutReason = { say: "Block", actor: "Tech Coach", why: "Stuck", changes: [{ card: "gp-901", status: "blocked" }] };
  const unknownCard = { say: "Start", actor: "Tech Coach", why: "Go", changes: [{ card: "gp-999", status: "now" }] };
  const goesBackInTime = { say: "Start", actor: "Tech Coach", why: "Go", changes: [{ card: "gp-902", status: "now" }] };

  assert.throws(() => applyStep(blockedWithoutReason, state(), AT), { name: "ReplayRefused", message: /roadmap: gp-901 missing_field/ });
  assert.throws(() => applyStep(unknownCard, state(), AT), { name: "ReplayRefused", message: /unknown card gp-999/ });
  assert.throws(() => applyStep(goesBackInTime, state(), "2026-11-01T00:00:00Z"), { name: "ReplayRefused", message: /decision log: line 3 out_of_order/ });
});

test("the garden steps all validate in turn on the committed sample, and the weekly-tasks card shows solved once its last part is", () => {
  const roadmap = JSON.parse(readFileSync(join(repoRoot, "roadmap/roadmap.json"), "utf8"));
  const entries = readFileSync(join(repoRoot, "roadmap/decisions.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

  const shownAfter = [];
  GARDEN_STEPS.reduce((current, step, index) => {
    const { roadmap: next, lines } = applyStep(step, current, `2026-11-24T17:0${index}:00Z`);
    shownAfter.push(displayedStates(next.problems).get("gp-002"));
    return { roadmap: next, entries: [...current.entries, ...lines] };
  }, { roadmap, entries });

  assert.ok(GARDEN_STEPS.length >= 4 && GARDEN_STEPS.length <= 8, `${GARDEN_STEPS.length} steps`);
  assert.deepEqual(shownAfter.slice(0, 3), ["now", "now", "done"]);
  assert.ok(GARDEN_STEPS.some((step) => step.changes.some((change) => change.order !== undefined)), "a step re-ranks");
});

const trackedSample = () => ["roadmap/roadmap.json", "roadmap/decisions.jsonl", "roadmap/pace.json"]
  .map((path) => readFileSync(join(repoRoot, path), "utf8"));

const readLog = (dir) => readFileSync(join(dir, "roadmap/decisions.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

test("replay copies the site, then writes each step into the copy after a pause, leaving the committed sample untouched", async () => {
  const before = trackedSample();
  const copyDir = join(mkdtempSync(join(tmpdir(), "replay-")), "site");
  const pauses = [];
  const said = [];
  let clock = Date.parse("2026-11-24T17:00:00Z");

  const result = await replay({
    repoRoot, copyDir, steps: GARDEN_STEPS, waitMs: 9000, pauseMs: 4000,
    sleep: async (ms) => { pauses.push(ms); }, now: () => new Date((clock += 60_000)), log: (line) => said.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(trackedSample(), before);
  assert.deepEqual(pauses, [9000, ...GARDEN_STEPS.slice(1).map(() => 4000)]);
  ["strip/index.html", "src/tree-page.js", "portfolio/portfolio.json", "products/seed-library/roadmap/roadmap.json"]
    .forEach((path) => assert.ok(existsSync(join(copyDir, path)), path));
  const roadmap = JSON.parse(readFileSync(join(copyDir, "roadmap/roadmap.json"), "utf8"));
  const log = readLog(copyDir);
  assert.equal(validateDecisionLog(log, roadmap).valid, true);
  assert.equal(log.length - readLog(repoRoot).length, GARDEN_STEPS.flatMap((step) => step.changes).length);
  assert.equal(roadmap.problems.find((problem) => problem.id === "gp-072").status, "now");
  const pace = JSON.parse(readFileSync(join(copyDir, "roadmap/pace.json"), "utf8"));
  assert.equal(pace.status, "ok");
  assert.deepEqual(pace.results.map((entry) => entry.id), forecastOrder(roadmap.problems).map((problem) => problem.id));
  assert.equal(validatePace(pace, roadmap, lastChangedAt(log)).state, "ok", "the copy's forecast is current after the last step");
  assert.equal(said.filter((line) => line.startsWith("Step ")).length, GARDEN_STEPS.length);
  assert.equal(said.at(-1), "Replay finished; the copy stays in place until the next replay.");
  rmSync(dirname(copyDir), { recursive: true, force: true });
});

test("a refused step stops the replay with exit 1 and its reason, and writes nothing for that step", async () => {
  const copyDir = join(mkdtempSync(join(tmpdir(), "replay-")), "site");
  const said = [];
  const bad = { say: "Block without a reason", actor: "Tech Coach", why: "Stuck", changes: [{ card: "gp-021", status: "blocked" }] };

  const result = await replay({
    repoRoot, copyDir, steps: [GARDEN_STEPS[0], bad, GARDEN_STEPS[1]], waitMs: 0, pauseMs: 0,
    sleep: async () => {}, now: () => new Date("2026-11-24T17:00:00Z"), log: (line) => said.push(line),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(readLog(copyDir).length, readLog(repoRoot).length + 1);
  assert.deepEqual(said, [
    "Step 1 of 3: Reminders moves from next to now (gp-022)",
    "Step 2 of 3 not written: replay step refused: roadmap: gp-021 missing_field",
  ]);
  rmSync(dirname(copyDir), { recursive: true, force: true });
});

test("replay refuses to replace a directory it did not make, and leaves it as it was", async () => {
  const copyDir = mkdtempSync(join(tmpdir(), "not-a-replay-"));
  writeFileSync(join(copyDir, "keep.txt"), "mine");
  const said = [];

  const result = await replay({
    repoRoot, copyDir, steps: GARDEN_STEPS, waitMs: 0, pauseMs: 0,
    sleep: async () => {}, now: () => new Date("2026-11-24T17:00:00Z"), log: (line) => said.push(line),
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(readdirSync(copyDir), ["keep.txt"]);
  assert.deepEqual(said, ["Replay not started: the copy directory already holds something that is not a replay copy"]);
  rmSync(copyDir, { recursive: true, force: true });
});

test("a second replay into the same copy starts again from the committed sample", async () => {
  const copyDir = join(mkdtempSync(join(tmpdir(), "replay-")), "site");
  const run = () => replay({
    repoRoot, copyDir, steps: GARDEN_STEPS.slice(0, 1), waitMs: 0, pauseMs: 0,
    sleep: async () => {}, now: () => new Date("2026-11-24T17:00:00Z"), log: () => {},
  });

  await run();
  const second = await run();

  assert.equal(second.exitCode, 0);
  assert.equal(readLog(copyDir).length, readLog(repoRoot).length + 1);
  rmSync(dirname(copyDir), { recursive: true, force: true });
});

test("replayOptions waits 15 s before the first step and 6 s between steps unless told otherwise, and refuses anything else", () => {
  assert.deepEqual(replayOptions([]), { waitMs: 15000, pauseMs: 6000 });
  assert.deepEqual(replayOptions(["--pause", "3"]), { waitMs: 15000, pauseMs: 3000 });
  assert.deepEqual(replayOptions(["--wait", "0", "--pause", "2.5"]), { waitMs: 0, pauseMs: 2500 });
  [["--pause"], ["--pause", "-1"], ["--pause", "soon"], ["--speed", "2"], ["--wait", "601"]]
    .forEach((argv) => assert.equal(replayOptions(argv), null, argv.join(" ")));
});

test("applyStep moves a card to a new status, dates it today, and writes one status line with who and why", () => {
  const step = { say: "A card starts", actor: "Tech Coach", why: "Its turn", changes: [{ card: "gp-902", status: "now" }] };

  const { roadmap, lines } = applyStep(step, state(), AT);

  assert.deepEqual(roadmap.problems[1], card("gp-902", "now", 2, { statusSince: "2026-11-24" }));
  assert.deepEqual(lines, [{ at: AT, problemId: "gp-902", actor: "Tech Coach", action: "coach-status", before: "next", after: "now", why: "Its turn" }]);
  assert.equal(validateDecisionLog([...state().entries, ...lines], roadmap).valid, true);
});

test("each step's words name no card id; the replay adds the ids from the step's changes, once each", async () => {
  const said = [];
  const twoChanges = { say: "Two cards are re-ranked", actor: "Product Coach", why: "Cheaper first", changes: [{ card: "gp-007", order: 4 }, { card: "gp-006", order: 7 }, { card: "gp-007", order: 3 }] };
  const copyDir = join(mkdtempSync(join(tmpdir(), "replay-")), "site");

  await replay({
    repoRoot, copyDir, steps: [twoChanges], waitMs: 0, pauseMs: 0,
    sleep: async () => {}, now: () => new Date("2026-11-24T17:00:00Z"), log: (line) => said.push(line),
  });

  assert.deepEqual(GARDEN_STEPS.filter((step) => /\b[a-z]{2}-\d{3}\b/.test(step.say)).map((step) => step.say), []);
  assert.equal(said[0], "Step 1 of 1: Two cards are re-ranked (gp-007, gp-006)");
  rmSync(dirname(copyDir), { recursive: true, force: true });
});
