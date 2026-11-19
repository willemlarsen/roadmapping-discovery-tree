import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../scripts/roadmap-kit.mjs";
import { main as paceScriptMain } from "../scripts/pace.mjs";
import { committedRepo } from "./support/kit-repo.mjs";

const VALID_ROADMAP = { goal: "Ship the kit", wipLimit: 1, staleAfterDays: 14, problems: [] };

function sink() {
  const chunks = [];
  return { write: (text) => chunks.push(text), text: () => chunks.join("") };
}

function kitDeps(files) {
  return {
    readFile: async (path) => {
      if (!(path in files)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      return files[path];
    },
    out: sink(),
    err: sink(),
  };
}

test('validate on a valid roadmap dir prints "roadmap valid" and exits 0', async () => {
  const deps = kitDeps({
    "product/roadmap/roadmap.json": JSON.stringify(VALID_ROADMAP),
    "product/roadmap/decisions.jsonl": "",
  });

  const exitCode = await main(["validate", "product/roadmap"], deps);

  assert.deepEqual({ exitCode, out: deps.out.text(), err: deps.err.text() }, { exitCode: 0, out: "roadmap valid\n", err: "" });
});

test('validate on an invalid roadmap prints "roadmap invalid: <reasons>", exits 1 and names no path', async () => {
  const roadmapMissingGoalAndStaleness = { wipLimit: 0, problems: [] };
  const roadmapDir = "/home/someone/product/roadmap";
  const deps = kitDeps({
    [`${roadmapDir}/roadmap.json`]: JSON.stringify(roadmapMissingGoalAndStaleness),
    [`${roadmapDir}/decisions.jsonl`]: "",
  });

  const exitCode = await main(["validate", roadmapDir], deps);

  assert.deepEqual(
    { exitCode, out: deps.out.text(), err: deps.err.text() },
    { exitCode: 1, out: "", err: "roadmap invalid: missing_field, out_of_range\n" },
  );
});

test('validate on a missing, unreadable or non-JSON roadmap.json prints "roadmap unreadable", exits 1 and names no path', async () => {
  const roadmapDir = "/home/someone/product/roadmap";
  const permissionDenied = Object.assign(new Error(`EACCES: ${roadmapDir}/roadmap.json`), { code: "EACCES" });
  const cases = {
    "missing dir": kitDeps({}),
    "unreadable roadmap.json": { ...kitDeps({}), readFile: async () => { throw permissionDenied; } },
    "non-JSON roadmap.json": kitDeps({ [`${roadmapDir}/roadmap.json`]: "{ not json", [`${roadmapDir}/decisions.jsonl`]: "" }),
  };

  const outcomes = {};
  for (const [name, deps] of Object.entries(cases)) {
    const exitCode = await main(["validate", roadmapDir], deps);
    outcomes[name] = { exitCode, out: deps.out.text(), err: deps.err.text() };
  }

  const unreadable = { exitCode: 1, out: "", err: "roadmap unreadable\n" };
  assert.deepEqual(outcomes, { "missing dir": unreadable, "unreadable roadmap.json": unreadable, "non-JSON roadmap.json": unreadable });
});

test('validate on a missing, non-JSON or inconsistent decisions.jsonl exits 1 with "decisions unreadable" or "roadmap invalid: <reasons>" and names no path', async () => {
  const roadmapDir = "/home/someone/product/roadmap";
  const roadmapFile = { [`${roadmapDir}/roadmap.json`]: JSON.stringify(VALID_ROADMAP) };
  const entryWithBadDateForUnknownProblem = JSON.stringify({ at: "yesterday", problemId: "ghost" });
  const cases = {
    "missing decisions.jsonl": kitDeps(roadmapFile),
    "non-JSON line 2": kitDeps({ ...roadmapFile, [`${roadmapDir}/decisions.jsonl`]: `${entryWithBadDateForUnknownProblem}\n{ not json\n` }),
    "inconsistent decision log": kitDeps({ ...roadmapFile, [`${roadmapDir}/decisions.jsonl`]: `${entryWithBadDateForUnknownProblem}\n` }),
  };

  const outcomes = {};
  for (const [name, deps] of Object.entries(cases)) {
    const exitCode = await main(["validate", roadmapDir], deps);
    outcomes[name] = { exitCode, out: deps.out.text(), err: deps.err.text() };
  }

  assert.deepEqual(outcomes, {
    "missing decisions.jsonl": { exitCode: 1, out: "", err: "decisions unreadable\n" },
    "non-JSON line 2": { exitCode: 1, out: "", err: "decisions unreadable: line 2\n" },
    "inconsistent decision log": { exitCode: 1, out: "", err: "roadmap invalid: missing_field, invalid_date, unknown_problem\n" },
  });
});

test("pace on a roadmap outside the kit writes pace.json under the cwd and prints the same exit code and line as scripts/pace.mjs", async () => {
  const productRoot = await mkdtemp(join(tmpdir(), "kit-pace-product-"));
  const roadmapDir = join("roadmaps", "product");
  const gitDir = "source";
  const now = () => new Date("2026-11-15T12:00:00.000Z");
  try {
    await committedRepo(join(productRoot, gitDir));
    await mkdir(join(productRoot, roadmapDir), { recursive: true });
    await writeFile(join(productRoot, roadmapDir, "roadmap.json"), JSON.stringify(VALID_ROADMAP));
    const deps = { ...kitDeps({}), cwd: productRoot, now };

    const exitCode = await main(["pace", roadmapDir, "--git", gitDir], deps);

    const paceFileWritten = existsSync(join(productRoot, roadmapDir, "pace.json"));
    const script = paceScriptMain(productRoot, now, { roadmapDir, gitDir });
    assert.deepEqual(
      { exitCode, out: deps.out.text(), err: deps.err.text(), paceFileWritten, script },
      {
        exitCode: 0, out: "pace file written: insufficient\n", err: "", paceFileWritten: true,
        script: { exitCode: 0, message: "pace file written: insufficient" },
      },
    );
  } finally {
    await rm(productRoot, { recursive: true, force: true });
  }
});

test("validate and pace take their roadmap dir from the shared args split, so flags may come before the dir", async () => {
  const productRoot = await mkdtemp(join(tmpdir(), "kit-args-product-"));
  const roadmapDir = join("roadmaps", "product");
  const now = () => new Date("2026-11-15T12:00:00.000Z");
  try {
    await committedRepo(join(productRoot, "src"));
    await mkdir(join(productRoot, roadmapDir), { recursive: true });
    await writeFile(join(productRoot, roadmapDir, "roadmap.json"), JSON.stringify(VALID_ROADMAP));
    const files = { [`${roadmapDir}/roadmap.json`]: JSON.stringify(VALID_ROADMAP), [`${roadmapDir}/decisions.jsonl`]: "" };
    const cases = {
      "validate --x y dir": ["validate", "--x", "y", roadmapDir],
      "pace --git src dir": ["pace", "--git", "src", roadmapDir],
    };

    const outcomes = {};
    for (const [name, argv] of Object.entries(cases)) {
      const deps = { ...kitDeps(files), cwd: productRoot, now };
      const exitCode = await main(argv, deps);
      outcomes[name] = { exitCode, out: deps.out.text(), err: deps.err.text() };
    }

    assert.deepEqual(outcomes, {
      "validate --x y dir": { exitCode: 0, out: "roadmap valid\n", err: "" },
      "pace --git src dir": { exitCode: 0, out: "pace file written: insufficient\n", err: "" },
    });
  } finally {
    await rm(productRoot, { recursive: true, force: true });
  }
});

const FAKE_PUBLISH_KEY = `ccps_${"K".repeat(43)}`;
const FAKE_REVISION = "0123456789abcdef0123456789abcdef01234567";

const STORED_REPLY = { status: 200, body: { status: "stored", publishedAt: "2026-11-15T09:00:00.000Z" } };

const PUBLISH_DIR = "/home/someone/product/roadmap";
const PUBLISH_FLAGS = ["--product", "kit-product", "--url", "https://site.test"];

function publishFixture(reply = STORED_REPLY) {
  const seen = { gitCalls: [], fetchUrls: [], sleeps: [] };
  const deps = fakePublishDeps({ [`${PUBLISH_DIR}/roadmap.json`]: JSON.stringify(VALID_ROADMAP) }, seen, reply);
  return { roadmapDir: PUBLISH_DIR, seen, deps };
}

function fakePublishDeps(files, seen, reply) {
  return {
    ...kitDeps(files),
    git: async (args, options) => (seen.gitCalls.push({ args, cwd: options.cwd }), `${FAKE_REVISION}\u001f2026-11-07T12:00:00+02:00\n`),
    clock: () => new Date("2026-11-15T09:00:00.000Z"),
    env: { SHARE_PUBLISH_KEY: FAKE_PUBLISH_KEY },
    fetch: async (url) => (seen.fetchUrls.push(url), { status: reply.status, headers: { get: () => null }, json: async () => reply.body }),
    uuid: () => "11111111-2222-4333-8444-555555555555",
    sleep: async (ms) => { seen.sleeps.push(ms); },
    random: () => 0.5,
    log: () => {},
  };
}

test('publish on a committed roadmap dir sends the snapshot for that product, prints "published" on stdout and exits 0', async () => {
  const { roadmapDir, seen, deps } = publishFixture();

  const exitCode = await main(["publish", ...PUBLISH_FLAGS, roadmapDir], deps);

  assert.deepEqual(
    { exitCode, out: deps.out.text(), err: deps.err.text(), fetchUrls: seen.fetchUrls, gitCwds: seen.gitCalls.map((call) => call.cwd) },
    {
      exitCode: 0, out: "published\n", err: "",
      fetchUrls: ["https://site.test/api/share/snapshots/kit-product"], gitCwds: [roadmapDir],
    },
  );
});

test("publish when the site rejects the snapshot with 422 invalid_snapshot prints the fields on stdout and exits 1 after exactly one fetch", async () => {
  const { roadmapDir, seen, deps } = publishFixture({ status: 422, body: { error: "invalid_snapshot", fields: ["problems[0].title", "goal"] } });

  const exitCode = await main(["publish", ...PUBLISH_FLAGS, roadmapDir], deps);

  assert.deepEqual(
    { exitCode, out: deps.out.text(), err: deps.err.text(), fetchCount: seen.fetchUrls.length },
    { exitCode: 1, out: "invalid snapshot: problems[0].title, goal\n", err: "", fetchCount: 1 },
  );
});

test("publish when the site answers 503 every time retries to exactly 4 attempts through the injected sleep, prints the failure on stdout and exits 1, with the dir last or first", async () => {
  const cases = { dirLast: [...PUBLISH_FLAGS, PUBLISH_DIR], dirFirst: [PUBLISH_DIR, ...PUBLISH_FLAGS] };

  const outcomes = {};
  for (const [name, args] of Object.entries(cases)) {
    const { seen, deps } = publishFixture({ status: 503, body: { error: "unavailable" } });
    const exitCode = await main(["publish", ...args], deps);
    outcomes[name] = { exitCode, out: deps.out.text(), err: deps.err.text(), fetchCount: seen.fetchUrls.length, sleepCount: seen.sleeps.length };
  }

  const failed = {
    exitCode: 1, out: "publish failed (server unavailable); run again, it is safe to repeat\n", err: "", fetchCount: 4, sleepCount: 3,
  };
  assert.deepEqual(outcomes, { dirLast: failed, dirFirst: failed });
});

const USAGE_LINE = "usage: roadmap-kit validate <dir> | pace <dir> [--git <dir>] | publish --product <id> --url <base> <dir>\n";

test("the kit answers a missing or unknown subcommand and a wrong positional count with usage on stderr and exit 2, and --version with its version and snapshot schema on stdout and exit 0", async () => {
  const cases = {
    "no subcommand": [],
    "unknown subcommand": ["frobnicate", PUBLISH_DIR],
    "validate without a dir": ["validate"],
    "validate with two dirs": ["validate", PUBLISH_DIR, "other"],
    "pace with two dirs": ["pace", PUBLISH_DIR, "other", "--git", "source"],
    "publish without args": ["publish"],
    "publish with two dirs": ["publish", ...PUBLISH_FLAGS, PUBLISH_DIR, "other"],
    "--version with an extra arg": ["--version", PUBLISH_DIR],
    "--version": ["--version"],
  };

  const outcomes = {};
  for (const [name, argv] of Object.entries(cases)) {
    const deps = { ...publishFixture().deps, cwd: "/home/someone/product", now: () => new Date("2026-11-15T12:00:00.000Z") };
    const exitCode = await main(argv, deps);
    outcomes[name] = { exitCode, out: deps.out.text().replace(/^roadmap-kit \S+ /, "roadmap-kit <version> "), err: deps.err.text() };
  }

  const usage = { exitCode: 2, out: "", err: USAGE_LINE };
  assert.deepEqual(outcomes, {
    "no subcommand": usage,
    "unknown subcommand": usage,
    "validate without a dir": usage,
    "validate with two dirs": usage,
    "pace with two dirs": usage,
    "publish without args": usage,
    "publish with two dirs": usage,
    "--version with an extra arg": usage,
    "--version": { exitCode: 0, out: "roadmap-kit <version> snapshot-schema 1\n", err: "" },
  });
});
