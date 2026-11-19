import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("test command enforces a 90% line-coverage floor on src", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  const testCommand = packageJson.scripts.test;

  assert.match(testCommand, /--experimental-test-coverage/);
  assert.match(testCommand, /--test-coverage-lines=90/);
  assert.match(testCommand, /--test-coverage-include=src\/\*\*/);
  assert.match(testCommand, / --test-coverage-include=kit\/repo-settings\.mjs /);
});

test("the CI workflow runs the browser check", async () => {
  const workflow = await readFile(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");

  assert.match(workflow, /run: npm run test:browser/);
});

test("test command also measures scripts and holds the git-log parser at 100% lines", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  const { test: testCommand, "test:parse": parseCommand } = packageJson.scripts;

  assert.match(testCommand, /--test-coverage-include=scripts\/\*\*/);
  assert.match(testCommand, /npm run test:parse/);
  assert.match(parseCommand, /--test-coverage-lines=100 /);
  assert.match(parseCommand, /--test-coverage-include=src\/pace\/parse\.js/);
});

test("npm run pace reruns the pace script and the README says when to run it", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8").catch(() => "");

  const paceCommand = packageJson.scripts.pace;

  assert.equal(paceCommand, "node scripts/pace.mjs");
  assert.match(readme, /npm run pace/);
  assert.match(readme, /roadmap\/pace\.json/);
  assert.doesNotMatch(readme, /--no-verify/);
});

function rawJobLines(workflow, name) {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

function jobLines(workflow, name) {
  return rawJobLines(workflow, name).map((line) => normalise(line.replace(/\$\{\{\s*(.*?)\s*\}\}/g, "$1"))).filter(Boolean);
}

test("the workflow has only the test job and names no secret", async () => {
  const workflow = await readFile(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");

  const jobs = workflow.slice(workflow.indexOf("\njobs:\n")).split("\n").flatMap((line) => line.match(/^ {2}([\w-]+):\s*$/)?.[1] ?? []);

  assert.deepEqual(jobs, ["test"]);
  assert.ok(!workflow.includes("secrets.") && !workflow.includes("SHARE_PUBLISH_KEY"), "no secret anywhere in the workflow");
});

const PINNED_USES = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;

function workflowViolations(workflow) {
  const violations = [];
  const lines = workflow.split("\n").map((line) => line.trim());
  lines.forEach((line) => {
    const uses = line.match(/^(?:- )?uses:\s*(\S+)/);
    if (uses && !PINNED_USES.test(uses[1])) violations.push(`unpinned: ${line}`);
    if (/\bset\s+-[a-zA-Z]*x/.test(line)) violations.push(`set -x: ${line}`);
    if (line.includes("SHARE_PUBLISH_KEY") || line.includes("secrets.")) violations.push(`secret in workflow: ${line}`);
  });
  return violations;
}

test("the workflow pins every action to a commit SHA, names no secret and never turns on shell tracing", async () => {
  const workflow = await readFile(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
  assert.deepEqual(workflowViolations(workflow), []);
  const alter = (from, to) => {
    assert.ok(workflow.includes(from), `fixture text missing: ${from}`);
    return workflow.replace(from, to);
  };
  const checkoutPin = workflow.match(/actions\/checkout@[0-9a-f]{40}/)[0];

  const rows = {
    sha39: workflowViolations(alter(checkoutPin, checkoutPin.slice(0, -1))),
    sha41: workflowViolations(alter(checkoutPin, `${checkoutPin}0`)),
    tag: workflowViolations(alter(checkoutPin, "actions/checkout@v4")),
    secretInRun: workflowViolations(alter("run: npm test", "run: npm test ${{ secrets.SHARE_PUBLISH_KEY }}")),
    echoed: workflowViolations(alter("run: npm test", 'run: echo "$SHARE_PUBLISH_KEY"')),
    setX: workflowViolations(alter("run: npm test", "run: set -x && npm test")),
  };

  assert.deepEqual(rows, {
    sha39: [`unpinned: - uses: ${checkoutPin.slice(0, -1)} # v4.4.0`],
    sha41: [`unpinned: - uses: ${checkoutPin}0 # v4.4.0`],
    tag: ["unpinned: - uses: actions/checkout@v4 # v4.4.0"],
    secretInRun: ["secret in workflow: - run: npm test ${{ secrets.SHARE_PUBLISH_KEY }}"],
    echoed: ['secret in workflow: - run: echo "$SHARE_PUBLISH_KEY"'],
    setX: ["set -x: - run: set -x && npm test"],
  });
});

function normalise(line) {
  return line.replace(/\s+/g, " ").replace(/ #.*$/, "").trim();
}

function onBlockLines(workflow) {
  const lines = workflow.split("\n");
  const start = lines.indexOf("on:");
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).map(normalise).filter(Boolean);
}

test("the workflow runs on pushes to main, on pull requests and by hand, and the test job is unconditional", async () => {
  const workflow = await readFile(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");

  assert.deepEqual(onBlockLines(workflow), ["push:", "branches: [main]", "pull_request:", "workflow_dispatch:"]);
  assert.ok(jobLines(workflow, "test").every((line) => !line.startsWith("if:")), "test job must run on dispatch");
});

test("the branch floor lists every share file, snapshot.js included, as its own 100% include", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const shareFiles = (await readdir(new URL("../src/share/", import.meta.url))).map((name) => `src/share/${name}`);

  const tokens = packageJson.scripts["test:branches"].split(" ");
  const includes = tokens.filter((token) => token.startsWith("--test-coverage-include="));

  assert.deepEqual(tokens.slice(0, 5), ["node", "--test", "--experimental-test-coverage", "--test-coverage-branches=100", includes[0]]);
  assert.deepEqual(
    includes.map((token) => token.slice("--test-coverage-include=".length)).filter((path) => /^(src\/share|scripts|kit)\//.test(path)).sort(),
    [...shareFiles, "kit/repo-settings.mjs", "scripts/build-kit.mjs", "scripts/publish-share.mjs", "scripts/roadmap-kit.mjs"].sort(),
  );
});

function topLevelPermissionsLines(workflow) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => /^permissions:/.test(line));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].map(normalise).filter(Boolean);
}

function jobPermissionsLines(workflow, name) {
  const job = jobLines(workflow, name);
  const at = job.findIndex((line) => line.startsWith("permissions:"));
  if (at === -1) return [];
  const entries = [];
  for (const line of job.slice(at + 1)) {
    if (!/^[\w-]+: (read|write|none)$/.test(line)) break;
    entries.push(line);
  }
  return [job[at], ...entries];
}

function permissionsViolations(workflow) {
  const violations = [];
  const top = topLevelPermissionsLines(workflow);
  if (top.join("|") !== "permissions:|contents: read") violations.push(`top-level permissions are not only contents: read: ${top.join(" ") || "none"}`);
  const [head, ...entries] = jobPermissionsLines(workflow, "test");
  const narrows = head === "permissions:" && entries.every((entry) => entry === "contents: read" || entry.endsWith(": none"));
  if (head !== undefined && !narrows) violations.push(`test widens permissions: ${[head, ...entries].join(" ")}`);
  return violations;
}

test("the workflow grants only contents: read at the top level and the test job does not widen it, and altered permissions are flagged", async () => {
  const workflow = await readFile(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
  const alter = (from, to) => {
    assert.ok(workflow.includes(from), `fixture text missing: ${from}`);
    return workflow.replace(from, to);
  };
  const block = "permissions:\n  contents: read\n";
  const jobPermissions = (entry) => alter("  test:\n    runs-on: ubuntu-latest\n", `  test:\n    runs-on: ubuntu-latest\n    permissions:\n      ${entry}\n`);

  const rows = {
    real: permissionsViolations(workflow),
    noBlock: permissionsViolations(workflow.replace(block, "")),
    write: permissionsViolations(workflow.replace(block, "permissions:\n  contents: write\n")),
    writeAll: permissionsViolations(workflow.replace(block, "permissions: write-all\n")),
    extra: permissionsViolations(workflow.replace(block, `${block}  id-token: write\n`)),
    jobWrite: permissionsViolations(jobPermissions("contents: write")),
    jobNarrow: permissionsViolations(jobPermissions("contents: read")),
  };

  assert.deepEqual(topLevelPermissionsLines(workflow), ["permissions:", "contents: read"]);
  assert.deepEqual(rows, {
    real: [],
    noBlock: ["top-level permissions are not only contents: read: none"],
    write: ["top-level permissions are not only contents: read: permissions: contents: write"],
    writeAll: ["top-level permissions are not only contents: read: permissions: write-all"],
    extra: ["top-level permissions are not only contents: read: permissions: contents: read id-token: write"],
    jobWrite: ["test widens permissions: permissions: contents: write"],
    jobNarrow: [],
  });
});

function expressionViolations(workflow) {
  const lines = workflow.split("\n");
  const indentOf = (raw) => raw.length - raw.trimStart().length;
  const keyOf = (raw) => raw.trim().replace(/^- /, "");
  const violations = [];
  let blockIndent = -1;
  lines.forEach((raw, at) => {
    const indent = indentOf(raw);
    if (raw.trim() === "") return;
    const inBlock = indent > blockIndent && blockIndent !== -1;
    if (!inBlock) blockIndent = -1;
    if (!inBlock && /^(?:- )?run:\s*[|>][+-]?\d*\s*$/.test(raw.trim())) blockIndent = indent + (raw.trim().startsWith("- ") ? 2 : 0);
    if (!raw.includes("${{") || /^(?:- )?run:/.test(raw.trim())) return;
    const parent = lines.slice(0, at).reverse().find((earlier) => earlier.trim() !== "" && indentOf(earlier) < indent);
    const parentKey = parent === undefined ? "" : keyOf(parent);
    const entry = /^[A-Za-z_][\w-]*: /.test(keyOf(raw));
    const allowed = !inBlock && (
      (entry && (parentKey === "env:" || parentKey === "with:")) ||
      /^(?:if|environment): /.test(keyOf(raw)) ||
      (entry && parentKey === "concurrency:"));
    if (!allowed) violations.push(`expression outside env, if, with, environment or concurrency: ${raw.trim()}`);
  });
  return violations;
}

test("the workflow allows expressions only on env entries, if, environment, concurrency and with lines, including inside run blocks, and altered text is flagged", async () => {
  const workflow = await readFile(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
  const expression = "${{ github.event.head_commit.message }}";
  const swap = (from, to) => {
    assert.ok(workflow.includes(from), `fixture text missing: ${from}`);
    return workflow.replace(from, to);
  };
  const message = (line) => `expression outside env, if, with, environment or concurrency: ${line}`;

  const rows = {
    real: expressionViolations(workflow),
    literalBlock: expressionViolations(swap("- run: npm test", `- run: |\n          echo hi\n          echo ${expression}`)),
    foldedBlock: expressionViolations(swap("- run: npm test", `- run: >\n          echo ${expression}`)),
    keepBlock: expressionViolations(swap("- run: npm test", `- run: |-\n          echo ${expression}`)),
    nestedBlock: expressionViolations(swap("- run: npm test", `- name: nested\n        run: |\n          if true; then\n            echo ${expression}\n          fi`)),
    envLookalikeInBlock: expressionViolations(swap("- run: npm test", `- run: |\n          if: ${expression}`)),
    stepName: expressionViolations(swap("- run: npm test", `- name: ${expression}\n        run: npm test`)),
    envEntry: expressionViolations(swap("          CI: \"true\"", `          CI: "true"\n          EXTRA: \${{ github.sha }}`)),
    withValue: expressionViolations(swap("          node-version: 24", "          node-version: ${{ vars.NODE }}")),
    afterBlock: expressionViolations(swap("- run: npm test", `- run: |\n          echo hi\n      - name: after\n        if: \${{ github.sha }}`)),
  };

  assert.deepEqual(rows, {
    real: [],
    literalBlock: [message(`echo ${expression}`)],
    foldedBlock: [message(`echo ${expression}`)],
    keepBlock: [message(`echo ${expression}`)],
    nestedBlock: [message(`echo ${expression}`)],
    envLookalikeInBlock: [message(`if: ${expression}`)],
    stepName: [message(`- name: ${expression}`)],
    envEntry: [],
    withValue: [],
    afterBlock: [],
  });
});

function checkoutViolations(workflow) {
  const lines = workflow.split("\n");
  const indentOf = (raw) => raw.length - raw.trimStart().length;
  const violations = [];
  lines.forEach((raw, at) => {
    if (!/^(?:- )?uses:\s*actions\/checkout@/.test(raw.trim())) return;
    const stepIndent = indentOf(raw);
    const rest = lines.slice(at + 1);
    const end = rest.findIndex((line) => line.trim() !== "" && indentOf(line) <= stepIndent);
    const body = (end === -1 ? rest : rest.slice(0, end)).map((line) => line.trim());
    if (!body.includes("persist-credentials: false")) violations.push(`checkout without persist-credentials: false: ${raw.trim()}`);
  });
  return violations;
}

test("the workflow disables persisted git credentials on every checkout step, whatever the job, and altered text is flagged", async () => {
  const workflow = await readFile(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
  const checkout = "- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0";
  const job = (name, withLines) => `  ${name}:\n    runs-on: ubuntu-latest\n    steps:\n      ${checkout}\n${withLines}      - run: npm test\n`;
  const withBlock = (...entries) => `        with:\n${entries.map((entry) => `          ${entry}\n`).join("")}`;
  const flagged = `checkout without persist-credentials: false: ${checkout}`;

  const rows = {
    real: checkoutViolations(workflow),
    safe: checkoutViolations(job("a", withBlock("persist-credentials: false", "fetch-depth: 0"))),
    noWith: checkoutViolations(job("a", "")),
    persistTrue: checkoutViolations(job("a", withBlock("persist-credentials: true"))),
    fetchDepthOnly: checkoutViolations(job("a", withBlock("fetch-depth: 0"))),
    thirdJob: checkoutViolations(`${job("a", withBlock("persist-credentials: false"))}${job("b", withBlock("persist-credentials: false"))}${job("c", withBlock("fetch-depth: 0"))}`),
  };

  assert.deepEqual(rows, {
    real: [],
    safe: [],
    noWith: [flagged],
    persistTrue: [flagged],
    fetchDepthOnly: [flagged],
    thirdJob: [flagged],
  });
});

const BUILD_KIT = fileURLToPath(new URL("../scripts/build-kit.mjs", import.meta.url));
const ROADMAP_KIT = fileURLToPath(new URL("../scripts/roadmap-kit.mjs", import.meta.url));
const KIT_DIR_EXISTS = "build-kit refused: dist/roadmap-kit already exists; remove it first\n";
const KIT_PATH_REFUSED = "build-kit refused: a kit path leaves the kit root or holds a control character\n";

async function repoSourcesCopy(t) {
  const root = await mkdtemp(join(tmpdir(), "build-kit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "src"]) await cp(fileURLToPath(new URL(`../${dir}/`, import.meta.url)), join(root, dir), { recursive: true });
  return root;
}

function runScript(script, root, args = []) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
  return { status, stdout, stderr };
}

const runBuildKit = (root) => runScript(BUILD_KIT, root);

test("npm run kit builds the kit into git-ignored dist/roadmap-kit/ printing only its hash, a refused build prints only the refusal line, and the branch floor holds both kit scripts", async (t) => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const gitignore = (await readFile(new URL("../.gitignore", import.meta.url), "utf8")).split("\n");
  const branchFloor = packageJson.scripts["test:branches"].split(" ");

  const root = await repoSourcesCopy(t);
  const kitDir = join(root, "dist", "roadmap-kit");
  const built = runBuildKit(root);
  const sums = await readFile(join(kitDir, "SHA256SUMS"), "utf8");
  await writeFile(join(kitDir, "kept.txt"), "kept");
  const rebuilt = runBuildKit(root);

  const escaping = await repoSourcesCopy(t);
  const entry = join(escaping, "scripts", "roadmap-kit.mjs");
  await writeFile(entry, `import "../../../outside.js";\n${await readFile(entry, "utf8")}`);
  const refused = runBuildKit(escaping);
  const kitEntry = runScript(ROADMAP_KIT, root, ["--version"]);

  assert.equal(packageJson.scripts.kit, "node scripts/build-kit.mjs");
  assert.ok(gitignore.includes("dist/"));
  assert.ok(branchFloor.includes("--test-coverage-include=scripts/roadmap-kit.mjs"));
  assert.ok(branchFloor.includes("--test-coverage-include=scripts/build-kit.mjs"));
  assert.deepEqual(built, { status: 0, stdout: `kit hash: ${createHash("sha256").update(sums).digest("hex")}\n`, stderr: "" });
  assert.match(sums, /  scripts\/roadmap-kit\.mjs\n/);
  assert.deepEqual(rebuilt, { status: 1, stdout: "", stderr: KIT_DIR_EXISTS });
  assert.deepEqual(
    { sums: await readFile(join(kitDir, "SHA256SUMS"), "utf8"), kept: await readFile(join(kitDir, "kept.txt"), "utf8") },
    { sums, kept: "kept" },
  );
  assert.deepEqual(refused, { status: 1, stdout: "", stderr: KIT_PATH_REFUSED });
  assert.deepEqual(kitEntry, { status: 0, stdout: "roadmap-kit 0.1.1 snapshot-schema 1\n", stderr: "" });
});

test("only a pull request run can be cancelled by a newer one: main pushes and dispatches each get their own group, and altered text is flagged", async () => {
  const workflow = await readFile(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
  const topConcurrency = (text) => {
    const lines = text.split("\n");
    const at = lines.indexOf("concurrency:");
    return at === -1 ? [] : lines.slice(at + 1, at + 3).map(normalise);
  };
  const expected = [
    "group: test-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.run_id }}",
    "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
  ];
  assert.deepEqual(topConcurrency(workflow), expected);
  assert.notDeepEqual(topConcurrency(workflow.replace("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", "cancel-in-progress: true")), expected);
  assert.notDeepEqual(topConcurrency(workflow.replace("|| github.run_id }}", "|| github.ref }}")), expected);
});
