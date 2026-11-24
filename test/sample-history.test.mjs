import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cli, defaultEnd, generatedAtFor, historyPlan, regenerate, workdaysEndingOn } from "../scripts/sample-history.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const SAMPLE_DIRS = ["roadmap", "products/seed-library/roadmap"];

function sampleCopy() {
  const root = mkdtempSync(join(tmpdir(), "sample-root-"));
  SAMPLE_DIRS.forEach((dir) => cpSync(join(repoRoot, dir), join(root, dir), { recursive: true }));
  return root;
}

test("cli refuses an unknown flag or an end that is not a calendar day, and writes nothing", () => {
  const root = sampleCopy();
  try {
    const before = filesUnder(root);
    const usage = { exitCode: 1, message: "sample history not written: usage (accepted: --end <YYYY-MM-DD>)" };

    [["--since", "2026-11-24"], ["--end"], ["--end", "2026-02-30"], ["--end", "yesterday"]].forEach((argv) =>
      assert.deepEqual(cli(argv, root, new Date("2026-11-25T12:00:00Z")), usage, argv.join(" ")));
    assert.deepEqual(filesUnder(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli with no flags ends the history yesterday and reports each file it wrote", () => {
  const root = sampleCopy();
  try {
    const result = cli([], root, new Date("2026-11-25T12:00:00Z"));

    assert.deepEqual(result, {
      exitCode: 0,
      message: "roadmap: pace file written: ok\nproducts/seed-library/roadmap: pace file written: ok",
    });
    assert.equal(readPace(root, "roadmap").generatedAt, "2026-11-24T23:59:00Z");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the committed sample pace files are ok forecasts and exactly what the script writes for their end day", () => {
  const committed = SAMPLE_DIRS.map((dir) => readPace(repoRoot, dir));
  committed.forEach((pace, index) => assert.equal(pace.status, "ok", SAMPLE_DIRS[index]));
  const root = sampleCopy();
  try {
    regenerate({ root, end: committed[0].generatedAt.slice(0, 10) });

    assert.deepEqual(SAMPLE_DIRS.map((dir) => readPace(root, dir)), committed,
      "the sample pace files have drifted: run `npm run sample-history -- --end <the day in their generatedAt>`, or with no flag to refresh them");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const filesUnder = (root) => SAMPLE_DIRS.flatMap((dir) => readdirSync(join(root, dir)).sort()
  .map((name) => [`${dir}/${name}`, readFileSync(join(root, dir, name), "utf8")]));

const readPace = (root, dir) => JSON.parse(readFileSync(join(root, dir, "pace.json"), "utf8"));

test("regenerate builds each sample product's synthetic history and writes an ok forecast dated the end day", () => {
  const root = sampleCopy();
  try {
    const results = regenerate({ root, end: "2026-11-24" });

    assert.deepEqual(results, SAMPLE_DIRS.map((roadmapDir) => ({ roadmapDir, exitCode: 0, message: "pace file written: ok" })));
    SAMPLE_DIRS.forEach((dir) => {
      const pace = readPace(root, dir);
      assert.equal(pace.generatedAt, "2026-11-24T23:59:00Z", dir);
      assert.ok(pace.results.length > 0 && pace.results.every((result) => result.p85Hours > 0), dir);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("by default the history ends yesterday (UTC) and the pace file is dated that day's last minute, so it is never in the future", () => {
  const now = new Date("2026-11-25T00:30:00Z");

  const end = defaultEnd(now);

  assert.equal(end, "2026-11-24");
  assert.equal(generatedAtFor(end), "2026-11-24T23:59:00Z");
  assert.ok(Date.parse(generatedAtFor(end)) <= now.getTime());
});

test("workdaysEndingOn lists the given number of weekdays up to and including the end day, oldest first", () => {
  assert.deepEqual(workdaysEndingOn("2026-11-24", 4), ["2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"]);
  assert.deepEqual(workdaysEndingOn("2026-11-22", 2), ["2026-11-19", "2026-11-20"]);
});

test("historyPlan lays each build's cycles over the workdays ending on the end day, a few a day, each build under its own made-up session", () => {
  const builds = [{ card: "gp-011", cycles: 4 }, { card: "gp-012", cycles: 3 }];

  const plan = historyPlan(builds, { tokenPrefix: "5a", end: "2026-11-24" });

  assert.deepEqual(plan, [
    { at: "2026-11-23T09:30:00-08:00", subject: "C1: gp-011 sample cycle 1 of 4 (gov-5a0000000001)" },
    { at: "2026-11-23T09:58:00-08:00", subject: "C2: gp-011 sample cycle 2 of 4 (gov-5a0000000001)" },
    { at: "2026-11-23T10:39:00-08:00", subject: "C3: gp-011 sample cycle 3 of 4 (gov-5a0000000001)" },
    { at: "2026-11-24T09:30:00-08:00", subject: "C4: gp-011 sample cycle 4 of 4 (gov-5a0000000001)" },
    { at: "2026-11-24T09:58:00-08:00", subject: "C1: gp-012 sample cycle 1 of 3 (gov-5a0000000002)" },
    { at: "2026-11-24T10:39:00-08:00", subject: "C2: gp-012 sample cycle 2 of 3 (gov-5a0000000002)" },
    { at: "2026-11-24T11:12:00-08:00", subject: "C3: gp-012 sample cycle 3 of 3 (gov-5a0000000002)" },
  ]);
});
