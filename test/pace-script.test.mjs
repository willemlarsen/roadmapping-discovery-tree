import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, main, cli, DEFAULT_REMAINING_CYCLES } from "../scripts/pace.mjs";
import { fileURLToPath } from "node:url";
import { workdayOn } from "./support/commits.mjs";
import { buildSnapshot } from "../src/share/snapshot.js";

const SEPARATOR = "\u001f";

function problem(id, parent, status, order) {
  return {
    id, parent, problem: `Problem ${id}`, status, statusSince: "2026-10-28", order, slices: ["skin-forecast"],
    waitingOn: null, resumesAfter: null,
    doneOn: status === "done" ? "2026-10-27" : null, confirmedBy: status === "done" ? "Amal" : null,
  };
}

const roadmap = {
  version: 1,
  goal: "Willem always knows where we are",
  wipLimit: 1,
  staleAfterDays: 3,
  problems: [
    problem("up-001", null, "now", 1),
    problem("up-011", "up-001", "done", 1),
    problem("up-013", "up-001", "now", 2),
    problem("up-002", null, "next", 2),
  ],
};

function gitLogOf(commits) {
  return commits.map((commit, index) => [
    (index + 1).toString(16).padStart(7, "0"),
    new Date(commit.at).toISOString().replace(".000Z", "Z"),
    commit.subject,
  ].join(SEPARATOR)).join("\n") + "\n";
}

const gitIn = (dir) => (args, date) => execFileSync("git", args, {
  cwd: dir,
  stdio: "ignore",
  env: {
    PATH: process.env.PATH,
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
  },
});

function seedGitHistory(dir) {
  const git = gitIn(dir);
  git(["init", "--quiet"]);
  ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].forEach((day) => workdayOn(day).forEach((commit) =>
    git(["commit", "--allow-empty", "--quiet", "-m", commit.subject], `${new Date(commit.at).toISOString().slice(0, 19)}+00:00`)));
}

test("the script writes a pace file with a card for each now and next problem and exits 0", () => {
  const commits = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].flatMap((day) => workdayOn(day));
  const written = [];

  const result = run({
    readGitLog: () => gitLogOf(commits),
    readRoadmap: () => roadmap,
    writeFile: (text) => written.push(text),
    now: () => new Date("2026-10-31T12:34:56.789Z"),
  });

  const file = JSON.parse(written[0]);
  assert.deepEqual(result, { exitCode: 0, message: "pace file written: ok" });
  assert.equal(written.length, 1);
  assert.ok(written[0].startsWith('{\n  "contractVersion": 3,\n'));
  assert.ok(written[0].endsWith("}\n"));
  assert.equal(file.generatedAt, "2026-10-31T12:34:56Z");
  assert.equal(file.status, "ok");
  assert.deepEqual(file.results.map((card) => [card.id, card.remainingCycles]), [
    ["up-013", DEFAULT_REMAINING_CYCLES], ["up-002", DEFAULT_REMAINING_CYCLES],
  ]);
});

test("every failure ends with exit code 1 and a fixed message, writes nothing, and leaks no paths", () => {
  const commits = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].flatMap((day) => workdayOn(day));
  const throwing = (message) => () => { throw new Error(message); };
  const failures = [
    [{ readGitLog: throwing("fatal: not a repository: /Users/secret/repo") }, "git_unavailable"],
    [{ readGitLog: () => "garbage\n" }, "log_invalid (line 1: wrong_field_count)"],
    [{ readRoadmap: throwing("ENOENT: /Users/secret/roadmap.json") }, "roadmap_unreadable"],
    [{ readRoadmap: () => ({ problems: [] }) }, "roadmap_invalid"],
    [{ readRoadmap: () => ({ ...roadmap, problems: [problem("Bad Id", null, "now", 1)] }) }, "input_invalid (card 1: invalid_card)"],
    [{ now: throwing("boom /Users/secret") }, "unexpected_error"],
    [{ writeFile: throwing("EACCES: /Users/secret/pace.json") }, "write_failed"],
  ];
  const outcomes = failures.map(([override]) => {
    const written = [];
    const deps = {
      readGitLog: () => gitLogOf(commits),
      readRoadmap: () => roadmap,
      writeFile: (text) => written.push(text),
      now: () => new Date("2026-10-31T12:34:56.789Z"),
      ...override,
    };
    return { result: run(deps), written };
  });

  failures.forEach(([, code], index) => {
    assert.deepEqual(outcomes[index].result, { exitCode: 1, message: `pace file not written: ${code}` }, code);
    assert.deepEqual(outcomes[index].written, [], code);
    assert.doesNotMatch(outcomes[index].result.message, /secret|Users/, code);
  });
});

test("main reads a real git repository and roadmap file and writes roadmap/pace.json atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "pace-main-"));
  try {
    seedGitHistory(root);
    await mkdir(join(root, "roadmap"));
    await writeFile(join(root, "roadmap", "roadmap.json"), JSON.stringify(roadmap));

    const result = main(root, () => new Date("2026-10-31T12:00:00.000Z"));

    const file = JSON.parse(await readFile(join(root, "roadmap", "pace.json"), "utf8"));
    assert.deepEqual(result, { exitCode: 0, message: "pace file written: ok" });
    assert.deepEqual(file.inputs, {
      sessionGapMinutes: 60, windowDays: 4, rollingDays: 14, dailyCapHours: 10, simulationSeed: file.inputs.simulationSeed,
      commits: 16, cycleCommits: 16, cycleIntervals: 12, activeDays: 4, sizeSamples: [],
    });
    assert.deepEqual(file.results.map((card) => card.id), ["up-013", "up-002"]);
    assert.deepEqual((await readdir(join(root, "roadmap"))).sort(), ["pace.json", "roadmap.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the script lists only cards without open parts, now before next, each in sibling order, whatever the file order", () => {
  const commits = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].flatMap((day) => workdayOn(day));
  const scrambled = {
    ...roadmap,
    problems: [
      problem("up-002", null, "next", 3),
      problem("up-013", "up-001", "now", 2),
      problem("up-031", "up-003", "next", 1),
      problem("up-003", null, "next", 2),
      problem("up-001", null, "now", 1),
    ],
  };
  const written = [];

  run({
    readGitLog: () => gitLogOf(commits),
    readRoadmap: () => scrambled,
    writeFile: (text) => written.push(text),
    now: () => new Date("2026-10-31T12:34:56.789Z"),
  });

  assert.deepEqual(JSON.parse(written[0]).results.map((card) => card.id), ["up-013", "up-031", "up-002"]);
});

test("the script refuses a roadmap with an out-of-set value or size and accepts a valid pair", () => {
  const commits = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].flatMap((day) => workdayOn(day));
  const estimated = (value, size) => ({ ...roadmap, problems: [{ ...problem("up-001", null, "now", 1), value, size }] });
  const attempt = (candidate) => {
    const written = [];
    const result = run({
      readGitLog: () => gitLogOf(commits),
      readRoadmap: () => candidate,
      writeFile: (text) => written.push(text),
      now: () => new Date("2026-10-31T12:34:56.789Z"),
    });
    return { result, written };
  };

  const outOfSet = attempt(estimated(4, 13));
  const inSet = attempt(estimated(5, 3));

  assert.deepEqual(outOfSet.result, { exitCode: 1, message: "pace file not written: roadmap_invalid" });
  assert.deepEqual(outOfSet.written, []);
  assert.deepEqual(inSet.result, { exitCode: 0, message: "pace file written: ok" });
  assert.equal(inSet.written.length, 1);
});

test("main reads and writes in a given roadmap dir under the root, and publish-share's buildSnapshot accepts the pace file it writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pace-roadmap-dir-"));
  const roadmapDir = join("products", "my product", "roadmap");
  try {
    seedGitHistory(root);
    await mkdir(join(root, roadmapDir), { recursive: true });
    await writeFile(join(root, roadmapDir, "roadmap.json"), JSON.stringify(roadmap));

    const result = main(root, () => new Date("2026-10-31T12:00:00.000Z"), { roadmapDir });

    const pace = JSON.parse(await readFile(join(root, roadmapDir, "pace.json"), "utf8"));
    const snapshot = buildSnapshot({
      roadmap, pace, productId: "my-product", sourceRevision: "abc1234",
      sourceCommittedAt: "2026-10-31T12:00:00Z", generatedAt: "2026-10-31T12:00:00Z",
    });
    assert.deepEqual(result, { exitCode: 0, message: "pace file written: ok" });
    assert.deepEqual((await readdir(join(root, roadmapDir))).sort(), ["pace.json", "roadmap.json"]);
    assert.deepEqual((await readdir(root)).sort(), [".git", "products"]);
    assert.deepEqual(snapshot.forecast.map((entry) => entry.id), ["up-013", "up-002"]);
    assert.ok(snapshot.forecast.every((entry) => Number.isFinite(entry.p95Hours) && entry.p95Hours > 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("main runs git log in the given git dir, resolved against the root, not in the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pace-git-dir-"));
  const gitDir = join("history", "other repo");
  try {
    await mkdir(join(root, gitDir), { recursive: true });
    seedGitHistory(join(root, gitDir));
    await mkdir(join(root, "roadmap"));
    await writeFile(join(root, "roadmap", "roadmap.json"), JSON.stringify(roadmap));

    const result = main(root, () => new Date("2026-10-31T12:00:00.000Z"), { gitDir });

    assert.deepEqual(result, { exitCode: 0, message: "pace file written: ok" });
    const pace = JSON.parse(await readFile(join(root, "roadmap", "pace.json"), "utf8"));
    assert.equal(pace.inputs.commits, 16);
    assert.deepEqual(pace.results.map((card) => card.id), ["up-013", "up-002"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI forwards --roadmap and --git in any combination and refuses an unknown flag or a missing value with a usage line on stderr, writing nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pace-cli-"));
  const otherRepo = await mkdtemp(join(tmpdir(), "pace other repo-"));
  const productDir = join("products", "my product", "roadmap");
  const usage = "pace file not written: usage (accepted: --roadmap <dir>, --git <dir>)";
  const script = fileURLToPath(new URL("../scripts/pace.mjs", import.meta.url));
  const now = () => new Date("2026-10-31T12:00:00.000Z");
  const collect = (result) => {
    const written = {};
    for (const dir of ["roadmap", productDir]) {
      const path = join(root, dir, "pace.json");
      if (existsSync(path)) written[dir] = JSON.parse(readFileSync(path, "utf8")).inputs.commits;
      rmSync(path, { force: true });
    }
    return { result, written };
  };
  try {
    seedGitHistory(root);
    seedGitHistory(otherRepo);
    gitIn(otherRepo)(["commit", "--allow-empty", "--quiet", "-m", "one more"], "2026-10-30T15:00:00+00:00");
    for (const dir of ["roadmap", productDir]) {
      await mkdir(join(root, dir), { recursive: true });
      await writeFile(join(root, dir, "roadmap.json"), JSON.stringify(roadmap));
    }
    const invocations = [
      [],
      ["--roadmap", productDir],
      ["--git", otherRepo],
      ["--roadmap", productDir, "--git", otherRepo],
      ["--git", otherRepo, "--roadmap", productDir],
      ["--bogus", "x"],
      ["--roadmap"],
      ["--git", "--roadmap", productDir],
      ["--git", "--roadmap"],
    ];

    const outcomes = invocations.map((argv) => collect(cli(argv, root, now)));
    const entry = spawnSync(process.execPath, [script, "--bogus"], { encoding: "utf8" });

    const ok = { exitCode: 0, message: "pace file written: ok" };
    const refused = { result: { exitCode: 1, message: usage }, written: {} };
    assert.deepEqual(outcomes, [
      { result: ok, written: { roadmap: 16 } },
      { result: ok, written: { [productDir]: 16 } },
      { result: ok, written: { roadmap: 17 } },
      { result: ok, written: { [productDir]: 17 } },
      { result: ok, written: { [productDir]: 17 } },
      refused, refused, refused, refused,
    ]);
    assert.deepEqual([entry.status, entry.stdout, entry.stderr], [1, "", `${usage}\n`]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(otherRepo, { recursive: true, force: true });
  }
});

test("main refuses a roadmap dir outside the root or a git dir that is not a directory before writing, leaving existing pace files untouched", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pace-fail-fast-"));
  const root = join(parent, "repo root");
  const outside = join(parent, "outside", "roadmap");
  const now = () => new Date("2026-10-31T12:00:00.000Z");
  const outsideRepo = "pace file not written: roadmap_dir_outside_repo (--roadmap must name a directory inside the repo)";
  const gitDirMissing = "pace file not written: git_dir_missing (--git must name an existing directory)";
  try {
    for (const dir of [join(root, "roadmap"), outside]) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "roadmap.json"), JSON.stringify(roadmap));
      await writeFile(join(dir, "pace.json"), "earlier pace file\n");
    }
    seedGitHistory(root);
    await writeFile(join(root, "a file"), "not a directory\n");
    await symlink(outside, join(root, "link out"));
    const attempts = [
      { roadmapDir: join("..", "outside", "roadmap") },
      { roadmapDir: outside },
      { roadmapDir: "link out" },
      { roadmapDir: join("..", "outside", "not made yet") },
      { gitDir: "missing dir" },
      { gitDir: "a file" },
      { roadmapDir: "no such dir" },
    ];

    const results = attempts.map((options) => main(root, now, options));

    assert.deepEqual(results.map((result) => result.message), [
      outsideRepo, outsideRepo, outsideRepo, outsideRepo, gitDirMissing, gitDirMissing, "pace file not written: roadmap_unreadable",
    ]);
    assert.ok(results.every((result) => result.exitCode === 1));
    for (const dir of [join(root, "roadmap"), outside]) {
      assert.equal(await readFile(join(dir, "pace.json"), "utf8"), "earlier pace file\n");
      assert.deepEqual((await readdir(dir)).sort(), ["pace.json", "roadmap.json"]);
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
