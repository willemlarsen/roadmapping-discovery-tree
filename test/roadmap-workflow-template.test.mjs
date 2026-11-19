import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKit } from "../scripts/build-kit.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEMPLATE = join(REPO_ROOT, "kit", "roadmap.yml");
const SKINS_CI = join(REPO_ROOT, ".github", "workflows", "test.yml");
const KIT_DIR = join("tools", "roadmap-kit");
const STEP_START = /^ {6}- /;
const KIT_CODE_RUN = /node\s+\S*tools\/roadmap-kit\//;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function linesNestedUnder(lines, header, indent) {
  const start = lines.indexOf(header);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => new RegExp(`^ {0,${indent}}\\S`).test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

const jobBlockOf = (workflow, name) => linesNestedUnder(workflow.split("\n"), `  ${name}:`, 2).join("\n");

function jobHeaderOf(job) {
  const lines = job.split("\n");
  return lines.slice(0, lines.findIndex((line) => /^ {4}steps:/.test(line))).join("\n");
}

function stepsOf(workflow) {
  const steps = [];
  for (const line of workflow.split("\n")) {
    if (STEP_START.test(line)) steps.push([line]);
    else if (steps.length > 0 && (line.trim() === "" || /^ {8}/.test(line))) steps.at(-1).push(line);
  }
  return steps.map((lines) => lines.join("\n"));
}

function runBlockOf(step) {
  const lines = step.split("\n");
  const start = lines.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  if (start === -1) return step.match(/^\s*(?:- )?run: (.+)$/m)?.[1] ?? "";
  const body = lines.slice(start + 1).filter((line) => line.trim() !== "");
  const indent = Math.min(...body.map((line) => line.match(/^ */)[0].length));
  return body.map((line) => line.slice(indent)).join("\n") + "\n";
}

const STEP_LABELS = [
  ["checkout", /uses: actions\/checkout@/],
  ["setup-node", /uses: actions\/setup-node@/],
  ["kit-hash", /vars\.ROADMAP_KIT_SHA256/],
  ["validate", /roadmap-kit\.mjs validate/],
  ["pace", /roadmap-kit\.mjs pace/],
  ["publish", /roadmap-kit\.mjs publish/],
];

const labelOf = (step) => STEP_LABELS.find(([, pattern]) => pattern.test(step))?.[0] ?? step;

const usesLine = (workflow, action) => workflow.match(new RegExp(`uses: ${action}@\\S+.*$`, "m"))[0];

function nodeVersionAtLeast(version, [major, minor]) {
  const [have, haveMinor] = version.split(".").map(Number);
  return have > major || (have === major && haveMinor >= minor);
}

async function builtKitIn(root) {
  const writeKitFile = async (path, source) => {
    await mkdir(dirname(join(root, KIT_DIR, path)), { recursive: true });
    await writeFile(join(root, KIT_DIR, path), source);
  };
  const kitHashLine = await buildKit({ readFile: (path) => readFile(join(REPO_ROOT, path), "utf8"), writeFile: writeKitFile });
  return kitHashLine.replace("kit hash: ", "");
}

function runCheck(script, cwd, expectedHash) {
  try {
    execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
      cwd, stdio: "ignore", env: { PATH: process.env.PATH, ROADMAP_KIT_SHA256: expectedHash },
    });
    return 0;
  } catch (error) {
    return error.status;
  }
}

test("the roadmap workflow template checks out, pins node and fails on a kit hash mismatch before any step runs kit code", async () => {
  const template = await readFile(TEMPLATE, "utf8");
  const skinsCi = await readFile(SKINS_CI, "utf8");
  const steps = stepsOf(jobBlockOf(template, "validate"));
  const hashStep = steps.find((step) => labelOf(step) === "kit-hash") ?? "";
  const goodRoot = await mkdtemp(join(tmpdir(), "kit-template-good-"));
  const tamperedRoot = await mkdtemp(join(tmpdir(), "kit-template-tampered-"));
  const script = join(goodRoot, "check-kit.sh");
  try {
    const kitHash = await builtKitIn(goodRoot);
    await builtKitIn(tamperedRoot);
    await appendFile(join(tamperedRoot, KIT_DIR, "src", "kit", "version.js"), "\n// tampered\n");
    await writeFile(script, runBlockOf(hashStep));

    const exitCodes = {
      matching: runCheck(script, goodRoot, kitHash),
      mismatched: runCheck(script, goodRoot, sha256("another kit")),
      unset: runCheck(script, goodRoot, ""),
      tamperedFile: runCheck(script, tamperedRoot, kitHash),
    };

    assert.match(template, /^permissions:\n {2}contents: read\n/m);
    assert.deepEqual(steps.map(labelOf), ["checkout", "setup-node", "kit-hash", "validate", "pace"]);
    assert.match(steps[0], /persist-credentials: false/);
    assert.match(steps[0], /fetch-depth: 0/);
    assert.equal(usesLine(template, "actions/setup-node"), usesLine(skinsCi, "actions/setup-node"));
    const nodeVersion = steps[1].match(/node-version: "?(\d+\.\d+\.\d+)"?\s*$/m)?.[1] ?? "unpinned";
    assert.ok(nodeVersionAtLeast(nodeVersion, [24, 2]), `node-version ${nodeVersion} must be an exact version >= 24.2`);
    const hashIndex = steps.indexOf(hashStep);
    const kitCodeIndexes = steps.flatMap((step, index) => (KIT_CODE_RUN.test(runBlockOf(step)) ? [index] : []));
    assert.ok(kitCodeIndexes.length >= 2 && kitCodeIndexes.every((index) => index > hashIndex));
    assert.equal(exitCodes.matching, 0);
    assert.notEqual(exitCodes.mismatched, 0);
    assert.notEqual(exitCodes.unset, 0);
    assert.notEqual(exitCodes.tamperedFile, 0);
  } finally {
    for (const dir of [goodRoot, tamperedRoot]) await rm(dir, { recursive: true, force: true });
  }
});

const FAKE_CONTEXT_VALUES = { "secrets.SHARE_PUBLISH_KEY": "fake-key", "vars.SHARE_URL": "https://share.example" };

function stepEnvOf(step) {
  const expressions = [...step.matchAll(/^ {10}(\w+): \$\{\{ (\S+) \}\}$/gm)];
  return Object.fromEntries(expressions.map(([, name, expression]) => [name, FAKE_CONTEXT_VALUES[expression]]));
}

async function stepInvocationsOf(steps, root) {
  const bin = join(root, "bin");
  const calls = join(root, "calls.txt");
  await mkdir(bin);
  await writeFile(join(bin, "node"), `#!/bin/bash\necho "$*|$SHARE_PUBLISH_KEY" >> "${calls}"\n`);
  await chmod(join(bin, "node"), 0o755);
  for (const product of ["alpha", "beta"]) await mkdir(join(root, "roadmaps", product), { recursive: true });
  for (const [index, step] of steps.entries()) {
    const script = join(root, `step-${index}.sh`);
    await writeFile(script, runBlockOf(step));
    execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
      cwd: root, stdio: "ignore", env: { PATH: `${bin}:${process.env.PATH}`, ...stepEnvOf(step) },
    });
  }
  return (await readFile(calls, "utf8")).trim().split("\n");
}

async function publishJobIn(template, name, environment) {
  const job = jobBlockOf(template, name);
  const steps = stepsOf(job);
  const publishStep = steps.find((step) => labelOf(step) === "publish") ?? "";
  const root = await mkdtemp(join(tmpdir(), `kit-template-${environment}-`));
  return { header: jobHeaderOf(job), steps, publishStep, environment, root };
}

test("the roadmap workflow template publishes to staging then production, each job verifying the kit and taking the key only from its environment secret on the publish step", async () => {
  const template = await readFile(TEMPLATE, "utf8");
  const validateJob = jobBlockOf(template, "validate");
  const validateSteps = stepsOf(validateJob);
  const publishJobs = {
    "publish-staging": await publishJobIn(template, "publish-staging", "staging"),
    "publish-production": await publishJobIn(template, "publish-production", "production"),
  };
  try {
    for (const job of Object.values(publishJobs)) job.kitInvocations = await stepInvocationsOf([job.publishStep], job.root);

    assert.equal(template.match(/secrets\./g)?.length, 2);
    assert.doesNotMatch(validateJob, /secrets\./);
    assert.doesNotMatch(template.split("\njobs:\n")[0], /secrets\./);
    assert.match(publishJobs["publish-staging"].header, /^ {4}needs: validate$/m);
    assert.match(publishJobs["publish-production"].header, /^ {4}needs: publish-staging$/m);
    for (const { header, steps, publishStep, environment, kitInvocations } of Object.values(publishJobs)) {
      assert.match(header, new RegExp(`^ {4}environment: ${environment}$`, "m"));
      assert.doesNotMatch(header, /secrets\.|vars\./);
      assert.deepEqual(steps.map(labelOf), ["checkout", "setup-node", "kit-hash", "pace", "publish"]);
      assert.deepEqual(steps.slice(0, 3), validateSteps.slice(0, 3));
      assert.match(publishStep, /^ {10}SHARE_PUBLISH_KEY: \$\{\{ secrets\.SHARE_PUBLISH_KEY \}\}$/m);
      assert.match(publishStep, /^ {10}SHARE_URL: \$\{\{ vars\.SHARE_URL \}\}$/m);
      assert.doesNotMatch(runBlockOf(publishStep), /\$\{\{/);
      assert.deepEqual(kitInvocations, [
        "tools/roadmap-kit/scripts/roadmap-kit.mjs publish --product alpha --url https://share.example roadmaps/alpha/|fake-key",
        "tools/roadmap-kit/scripts/roadmap-kit.mjs publish --product beta --url https://share.example roadmaps/beta/|fake-key",
      ]);
    }
  } finally {
    for (const { root } of Object.values(publishJobs)) await rm(root, { recursive: true, force: true });
  }
});

test("the roadmap workflow template paces every roadmap in each publish job after the kit hash check and before publishing", async () => {
  const template = await readFile(TEMPLATE, "utf8");
  const validatePaceStep = stepsOf(jobBlockOf(template, "validate")).find((step) => labelOf(step) === "pace");
  const publishJobs = [
    await publishJobIn(template, "publish-staging", "staging"),
    await publishJobIn(template, "publish-production", "production"),
  ];
  try {
    for (const job of publishJobs) {
      const kitSteps = job.steps.filter((step) => ["pace", "publish"].includes(labelOf(step)));
      job.kitInvocations = await stepInvocationsOf(kitSteps, job.root);
    }

    for (const { steps, kitInvocations } of publishJobs) {
      assert.deepEqual(steps.map(labelOf), ["checkout", "setup-node", "kit-hash", "pace", "publish"]);
      assert.equal(steps[3], validatePaceStep);
      assert.deepEqual(kitInvocations, [
        "tools/roadmap-kit/scripts/roadmap-kit.mjs pace roadmaps/alpha/|",
        "tools/roadmap-kit/scripts/roadmap-kit.mjs pace roadmaps/beta/|",
        "tools/roadmap-kit/scripts/roadmap-kit.mjs publish --product alpha --url https://share.example roadmaps/alpha/|fake-key",
        "tools/roadmap-kit/scripts/roadmap-kit.mjs publish --product beta --url https://share.example roadmaps/beta/|fake-key",
      ]);
    }
  } finally {
    for (const { root } of publishJobs) await rm(root, { recursive: true, force: true });
  }
});

const TRIGGER_PATHS = ["roadmaps/**", "tools/roadmap-kit/**", ".github/workflows/roadmap.yml"];
const PUBLISH_ONLY_ON_DEFAULT_BRANCH_PUSH =
  "    if: github.event_name == 'push' && github.ref_type == 'branch' && github.ref_name == github.event.repository.default_branch";

const triggersOf = (workflow) => linesNestedUnder(workflow.split("\n"), "on:", 0);

const triggerEventsOf = (workflow) => triggersOf(workflow).flatMap((line) => line.match(/^ {2}(\w+):/)?.[1] ?? []);

const triggerFiltersOf = (workflow, event) =>
  linesNestedUnder(triggersOf(workflow), `  ${event}:`, 2).flatMap((line) => line.match(/^ {4}([\w-]+):/)?.[1] ?? []);

const triggerPathsOf = (workflow, event) =>
  linesNestedUnder(triggersOf(workflow), `  ${event}:`, 2).flatMap((line) => line.match(/^ {6}- "?([^"]+?)"?$/)?.[1] ?? []);

test("the roadmap workflow template runs on roadmap, kit and workflow path changes and publishes only on a branch push to the default branch, one run per environment at a time", async () => {
  const environments = { "publish-staging": "staging", "publish-production": "production" };

  const template = await readFile(TEMPLATE, "utf8");

  assert.deepEqual(triggerEventsOf(template), ["push", "pull_request"]);
  for (const event of ["push", "pull_request"]) {
    assert.deepEqual(triggerFiltersOf(template, event), ["paths"], `${event} filters only by paths`);
    assert.deepEqual(triggerPathsOf(template, event), TRIGGER_PATHS);
  }
  assert.doesNotMatch(jobHeaderOf(jobBlockOf(template, "validate")), /^ {4}(if|concurrency):/m);
  for (const [job, environment] of Object.entries(environments)) {
    const header = jobHeaderOf(jobBlockOf(template, job));
    assert.ok(header.split("\n").includes(PUBLISH_ONLY_ON_DEFAULT_BRANCH_PUSH), `${job} must publish only on a branch push to the default branch, never a tag`);
    assert.match(header, new RegExp(`^ {4}concurrency:\\n {6}group: roadmap-publish-${environment}\\n {6}cancel-in-progress: false$`, "m"));
  }
  assert.doesNotMatch(template, /\b(main|master)\b/);
});

const KIT_JOBS = ["validate", "publish-staging", "publish-production"];

const KIT_FOLDER_ADDITIONS = {
  clean: async () => {},
  extraFile: (kit) => writeFile(join(kit, "package.json"), '{ "type": "commonjs" }\n'),
  extraSymlink: (kit) => symlink(join("..", "..", "package.json"), join(kit, "package.json")),
  extraNestedHiddenFile: (kit) => writeFile(join(kit, "src", "kit", ".preload.js"), "process.exit(0);\n"),
};

async function kitCheckScriptsIn(template, root) {
  const scripts = {};
  for (const job of KIT_JOBS) {
    const hashStep = stepsOf(jobBlockOf(template, job)).find((step) => labelOf(step) === "kit-hash") ?? "";
    scripts[job] = join(root, `check-kit-${job}.sh`);
    await writeFile(scripts[job], runBlockOf(hashStep));
  }
  return scripts;
}

async function kitCheckVerdictsFor(kitFolders) {
  const template = await readFile(TEMPLATE, "utf8");
  const scriptRoot = await mkdtemp(join(tmpdir(), "kit-template-scripts-"));
  const kitRoots = {};
  try {
    const scripts = await kitCheckScriptsIn(template, scriptRoot);
    let kitHash = "";
    for (const [kit, addToKitFolder] of Object.entries(kitFolders)) {
      kitRoots[kit] = await mkdtemp(join(tmpdir(), `kit-template-${kit}-`));
      kitHash = await builtKitIn(kitRoots[kit]);
      await addToKitFolder(join(kitRoots[kit], KIT_DIR));
    }
    const verdictsIn = (job) =>
      Object.fromEntries(Object.entries(kitRoots).map(([kit, root]) => [kit, runCheck(scripts[job], root, kitHash) === 0 ? "passes" : "fails"]));
    return Object.fromEntries(KIT_JOBS.map((job) => [job, verdictsIn(job)]));
  } finally {
    for (const root of Object.values(kitRoots)) execFileSync("chmod", ["-R", "u+rwx", root]);
    for (const dir of [scriptRoot, ...Object.values(kitRoots)]) await rm(dir, { recursive: true, force: true });
  }
}

const inEveryKitJob = (verdicts) => Object.fromEntries(KIT_JOBS.map((job) => [job, verdicts]));

test("the roadmap workflow template's kit check fails in every job when the kit folder holds a file SHA256SUMS does not list", async () => {
  const verdicts = await kitCheckVerdictsFor(KIT_FOLDER_ADDITIONS);

  const expected = { clean: "passes", extraFile: "fails", extraSymlink: "fails", extraNestedHiddenFile: "fails" };
  assert.deepEqual(verdicts, inEveryKitJob(expected));
});

const UNREADABLE_FOLDER = "unlisted";

const KIT_FOLDERS_THAT_MUST_FAIL_CLOSED = {
  clean: async () => {},
  newlineSplitName: async (kit) => {
    await mkdir(join(kit, "src", "kit", "args.js\nsrc", "kit"), { recursive: true });
    await writeFile(join(kit, "src", "kit", "args.js\nsrc", "kit", "args.js"), "process.exit(0);\n");
  },
  bareNewlineName: (kit) => writeFile(join(kit, "\n"), "process.exit(0);\n"),
};

test("the roadmap workflow template's kit check fails closed in every job when a kit path holds a control character", async () => {
  const verdicts = await kitCheckVerdictsFor(KIT_FOLDERS_THAT_MUST_FAIL_CLOSED);

  const expected = { clean: "passes", newlineSplitName: "fails", bareNewlineName: "fails" };
  assert.deepEqual(verdicts, inEveryKitJob(expected));
});

const ROOT_LISTS_ANY_FOLDER = "root can list any folder";

const KIT_FOLDERS_ONLY_A_NON_ROOT_RUNNER_CANNOT_LIST = {
  clean: async () => {},
  unreadableFolder: async (kit) => {
    await mkdir(join(kit, UNREADABLE_FOLDER));
    await writeFile(join(kit, UNREADABLE_FOLDER, "preload.js"), "process.exit(0);\n");
    await chmod(join(kit, UNREADABLE_FOLDER), 0o000);
  },
};

test(`the roadmap workflow template's kit check fails closed in every job when a kit folder cannot be listed (skipped when run as root: ${ROOT_LISTS_ANY_FOLDER})`, { skip: process.getuid?.() === 0 && ROOT_LISTS_ANY_FOLDER }, async () => {
  const verdicts = await kitCheckVerdictsFor(KIT_FOLDERS_ONLY_A_NON_ROOT_RUNNER_CANNOT_LIST);

  assert.deepEqual(verdicts, inEveryKitJob({ clean: "passes", unreadableFolder: "fails" }));
});

const AS_ROOT = "data:text/javascript,process.getuid = () => 0;";
const UNREADABLE_FOLDER_TEST_NAME_PATTERN = /cannot be listed/;

test("as root the unreadable-folder kit case is skipped and its name says why", () => {
  const { NODE_TEST_CONTEXT, NODE_V8_COVERAGE, ...env } = process.env;
  const args = ["--import", AS_ROOT, "--test", "--test-reporter=tap", `--test-name-pattern=${UNREADABLE_FOLDER_TEST_NAME_PATTERN.source}`, fileURLToPath(import.meta.url)];

  const run = spawnSync(process.execPath, args, { cwd: REPO_ROOT, env, encoding: "utf8" });

  const skipped = run.stdout.split("\n").filter((line) => /^ok \d+ - .*# SKIP/.test(line));
  assert.equal(skipped.length, 1, run.stdout);
  assert.match(skipped[0], /when run as root.*# SKIP .*root/);
});

const LISTING_FAILED = "roadmap kit listing failed";
const SYMLINK_REFUSED = "roadmap kit holds a symlink";
const CHECKSUM_REFUSED = "roadmap kit file does not match SHA256SUMS";
const FIND_CALLS = { controlCharacterListing: "-name", symlinkListing: "-type l", kitFileListing: "! -type d" };
const FIND_PASSES_THROUGH = "never-matches";
const untouchedKit = async () => {};

const MANIFEST_LISTING_CALL = "-c 67-";

const FAKE_LISTING_TOOLS = {
  find: 'case " $* " in *" $FIND_FAILS_ON "*) exit 1;; esac',
  cut: `case " $* " in *" ${MANIFEST_LISTING_CALL} "*) case "$CUT_ON_MANIFEST" in fails) exit 1;; printsNothing) exit 0;; esac;; esac`,
};

async function fakeListingToolsIn(root) {
  const bin = join(root, "bin");
  await mkdir(bin);
  for (const [tool, misbehaviour] of Object.entries(FAKE_LISTING_TOOLS)) {
    const realTool = execFileSync("bash", ["--noprofile", "--norc", "-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
    await writeFile(join(bin, tool), `#!/bin/bash\n${misbehaviour}\nexec ${realTool} "$@"\n`);
    await chmod(join(bin, tool), 0o755);
  }
  return bin;
}

function runPlainCheck(script, cwd, env) {
  const { status, stdout } = spawnSync("bash", ["--noprofile", "--norc", script], {
    cwd, encoding: "utf8", env: { PATH: process.env.PATH, ...env },
  });
  return { status, lastLine: stdout.trim().split("\n").at(-1) };
}

async function plainCheckRunIn(template, root, { kitFolder = untouchedKit, findFailsOn = FIND_PASSES_THROUGH, cutOnManifest = "passesThrough" }) {
  const scripts = await kitCheckScriptsIn(template, root);
  const kitHash = await builtKitIn(root);
  await kitFolder(join(root, KIT_DIR), root);
  const env = { ROADMAP_KIT_SHA256: kitHash, PATH: `${await fakeListingToolsIn(root)}:${process.env.PATH}`, FIND_FAILS_ON: findFailsOn, CUT_ON_MANIFEST: cutOnManifest };
  return (job) => runPlainCheck(scripts[job], root, env);
}

async function plainCheckOutcomesFor(cases) {
  const template = await readFile(TEMPLATE, "utf8");
  const roots = [];
  try {
    const outcomes = Object.fromEntries(KIT_JOBS.map((job) => [job, {}]));
    for (const [name, kitCase] of Object.entries(cases)) {
      roots.push(await mkdtemp(join(tmpdir(), `kit-template-plain-${name}-`)));
      const checkIn = await plainCheckRunIn(template, roots.at(-1), kitCase);
      for (const job of KIT_JOBS) outcomes[job][name] = checkIn(job);
    }
    return outcomes;
  } finally {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  }
}

const listedFileAsSymlinkToIdenticalCopy = async (kit, root) => {
  const listed = join(kit, "src", "kit", "version.js");
  await writeFile(join(root, "version-copy.js"), await readFile(listed));
  await rm(listed);
  await symlink(join(root, "version-copy.js"), listed);
};

const keepOnlyStatusOf = (outcomes, name) => {
  for (const job of KIT_JOBS) outcomes[job][name] = { status: outcomes[job][name].status };
  return outcomes;
};

test("the roadmap workflow template's kit check is explicitly closed in every job, even under plain bash flags", async (t) => {
  await t.test("an edited kit file is refused by the checksum rule", async () => {
    const editListedFile = (kit) => appendFile(join(kit, "src", "kit", "version.js"), "\n// edited\n");

    const outcomes = await plainCheckOutcomesFor({ editedListedFile: { kitFolder: editListedFile } });

    assert.deepEqual(outcomes, inEveryKitJob({ editedListedFile: { status: 1, lastLine: CHECKSUM_REFUSED } }));
  });

  await t.test("a symlink is refused by the symlink rule", async () => {
    const cases = { listedFileSymlinked: { kitFolder: listedFileAsSymlinkToIdenticalCopy }, unlistedSymlink: { kitFolder: KIT_FOLDER_ADDITIONS.extraSymlink } };

    const outcomes = await plainCheckOutcomesFor(cases);

    const refused = { status: 1, lastLine: SYMLINK_REFUSED };
    assert.deepEqual(outcomes, inEveryKitJob({ listedFileSymlinked: refused, unlistedSymlink: refused }));
  });

  await t.test("a failing listing stops the step", async () => {
    const cases = Object.fromEntries(Object.entries(FIND_CALLS).map(([name, findFailsOn]) => [name, { findFailsOn }]));

    const outcomes = await plainCheckOutcomesFor({ ...cases, findPassesThrough: {} });

    const failed = { status: 1, lastLine: LISTING_FAILED };
    const expected = { controlCharacterListing: failed, symlinkListing: failed, kitFileListing: failed, findPassesThrough: { status: 0 } };
    assert.deepEqual(keepOnlyStatusOf(outcomes, "findPassesThrough"), inEveryKitJob(expected));
  });

  await t.test("a failing or empty SHA256SUMS listing stops the step", async () => {
    const cases = { cutFails: { cutOnManifest: "fails" }, cutPrintsNothing: { cutOnManifest: "printsNothing" }, cutPassesThrough: {} };

    const outcomes = await plainCheckOutcomesFor(cases);

    const failed = { status: 1, lastLine: LISTING_FAILED };
    const expected = { cutFails: failed, cutPrintsNothing: failed, cutPassesThrough: { status: 0 } };
    assert.deepEqual(keepOnlyStatusOf(outcomes, "cutPassesThrough"), inEveryKitJob(expected));
  });
});
