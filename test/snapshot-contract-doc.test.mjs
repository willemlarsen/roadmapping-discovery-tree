import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { interpretPublishResponse } from "../src/share/publish-contract.js";
import { buildSnapshot } from "../src/share/snapshot.js";
import { MAX_ATTEMPTS, CAP_MS } from "../src/share/retry.js";
import { KIT_VERSION } from "../src/kit/version.js";
import { main as roadmapKit } from "../scripts/roadmap-kit.mjs";
import { main as repoSettings } from "../kit/repo-settings.mjs";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function ruleKeys() {
  const source = await readFile(new URL("../src/share/publish-contract.js", import.meta.url), "utf8");
  const rules = source.slice(source.indexOf("const RULES = {"), source.indexOf("};", source.indexOf("const RULES = {")));
  return [...rules.matchAll(/^\s*"(\d{3}):([a-z_]+)":/gm)].map(([, status, code]) => ({ status: Number(status), code }));
}

function outcomeOf({ status, code }) {
  const body = status === 200 ? { status: code } : { error: code, fields: ["goal"] };
  return interpretPublishResponse({ status, body });
}

function sectionOf(doc, heading) {
  const start = doc.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const next = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, next === -1 ? undefined : next);
}

test("snapshot contract doc covers every publish rule, the snapshot fields, the upgrade policy and failure behaviour", async () => {
  const keys = await ruleKeys();
  const fields = Object.keys(buildSnapshot({ roadmap: { goal: "g", problems: [] }, pace: null, productId: "p", sourceRevision: "r", sourceCommittedAt: "t", generatedAt: "t" }));

  const doc = await readFile(new URL("../docs/snapshot-contract.md", import.meta.url), "utf8");

  assert.ok(keys.length >= 10, "expected to read every RULES key from the source");
  for (const key of keys) {
    const { exitCode, retryable } = outcomeOf(key);
    const row = new RegExp(`^\\| \`${escape(`${key.status}:${key.code}`)}\` \\| ${exitCode} \\| ${retryable ? "yes" : "no"} \\|`, "m");
    assert.match(doc, row, `rule ${key.status}:${key.code} needs a row with exit ${exitCode}, retryable ${retryable}`);
  }
  assert.match(doc, /`schemaVersion`: `1`/);
  for (const field of fields) assert.match(doc, new RegExp(`\`${field}\``), `snapshot field ${field}`);
  assert.match(doc, /a new schemaVersion is accepted alongside the old one for at least one kit release/);
  const failure = sectionOf(doc, "Failure behaviour");
  for (const phrase of ["429", "503", "unrecognised 5xx", "network errors", `${MAX_ATTEMPTS} attempts`, `${CAP_MS} ms`, "Retry-After", "jitter", "fails fast", "production does not run"]) {
    assert.ok(failure.includes(phrase), `failure behaviour names: ${phrase}`);
  }
});

async function templateSettingNames() {
  const template = await readFile(new URL("../kit/roadmap.yml", import.meta.url), "utf8");
  return [...new Set([...template.matchAll(/\$\{\{ (?:vars|secrets)\.([A-Z0-9_]+) \}\}/g)].map(([, name]) => name))];
}

async function productIdPattern() {
  const source = await readFile(new URL("../src/share/validate-snapshot.js", import.meta.url), "utf8");
  return source.match(/productId: matches\(\/(.+)\/\)/)[1];
}

test("snapshot contract doc tells a product repo how to install, configure and run the kit, and its known limits", async () => {
  const settingNames = await templateSettingNames();
  const slug = await productIdPattern();
  const doc = await readFile(new URL("../docs/snapshot-contract.md", import.meta.url), "utf8");

  const usage = sectionOf(doc, "Using the kit in a product repo");

  assert.deepEqual(settingNames.toSorted(), ["ROADMAP_KIT_SHA256", "SHARE_PUBLISH_KEY", "SHARE_URL"]);
  for (const phrase of [
    "`npm run kit`", "`dist/roadmap-kit/`", "`tools/roadmap-kit/`", "`kit/roadmap.yml`", "`.github/workflows/roadmap.yml`",
    ...settingNames.map((name) => `\`${name}\``),
    "`ROADMAP_KIT_SHA256` is a repository variable, set by a repo admin", "every job that runs kit code",
    "`SHARE_URL` is a variable set per environment", "`SHARE_PUBLISH_KEY` is a secret set per environment", "deployment branch rule", "default branch",
    "The roadmap validate job is never a required status check", "paths filter", "stuck at \"expected\"",
    "folder names must match the product id", `\`${slug}\``,
    "publish prints only its result line on stdout", "log and error lines go to stderr", "validate and pace failure lines go to stderr",
  ]) {
    assert.ok(usage.includes(phrase), `Using the kit names: ${phrase}`);
  }
  assert.ok(usage.includes("### Known limits"), "a Known limits list");
  const limits = usage.slice(usage.indexOf("### Known limits"));
  for (const phrase of ["`|| true` regression is untested", "Node 24.2 or later"]) {
    assert.match(limits, new RegExp(`^- .*${escape(phrase)}`, "m"), `Known limits lists: ${phrase}`);
  }
  assert.ok(!limits.includes("tag named like the default branch"), "the tag limit is fixed, so it is no longer listed");
  const scopes = sectionOf(doc, "Permission scopes");
  for (const phrase of [
    "`node kit/repo-settings.mjs apply <owner/repo>` needs repo admin", "only an operator runs it, never CI", "sets no secret or variable value",
    "`node kit/repo-settings.mjs check <owner/repo>` needs read-only access", "an operator or CI with a read token", "never values", "one line per difference",
    "`SHARE_PUBLISH_KEY` can publish snapshots for one product only", "stored per environment", "rotated by minting a new key", "revoked with the site's publish-key tool",
  ]) {
    assert.ok(scopes.includes(phrase), `Permission scopes names: ${phrase}`);
  }
});

const LOCAL_EXIT_ROWS = {
  0: ["ok"],
  1: ["roadmap unreadable or invalid", "decisions unreadable", "no key", "snapshot invalid", "a publish failure"],
  2: ["usage", "a bad `--url`"],
};

const KIT_RUNS = [
  { phrase: "ok", argv: ["--version"] },
  { phrase: "usage", argv: [] },
  { phrase: "a bad `--url`", argv: ["publish", "--product", "p", "--url", "http://example.test", "r"] },
  { phrase: "roadmap unreadable or invalid", argv: ["validate", "r"] },
  { phrase: "no key", argv: ["publish", "--product", "p", "--url", "https://example.test", "r"] },
];

const silent = { write: () => true };
const kitDeps = { readFile: async () => { throw new Error("absent"); }, env: {}, cwd: "/", out: silent, err: silent };

const documentedExits = () => Object.entries(LOCAL_EXIT_ROWS).flatMap(([code, phrases]) => phrases.map((phrase) => ({ code, phrase })));

function exitRows(section) {
  return Object.fromEntries([...section.matchAll(/^\| (\d) \| (.+) \|$/gm)].map(([, code, meaning]) => [code, meaning]));
}

test("snapshot contract doc lists the local exit codes the kit returns, the upgrade note and kit version 0.1.1", async () => {
  const returned = await Promise.all(KIT_RUNS.map(async (run) => ({ ...run, exitCode: await roadmapKit(run.argv, kitDeps) })));

  const doc = await readFile(new URL("../docs/snapshot-contract.md", import.meta.url), "utf8");

  const rows = exitRows(sectionOf(doc, "Local exit codes"));
  assert.deepEqual(Object.keys(rows), ["0", "1", "2"], "one row per local exit code");
  const rowsNaming = (phrase) => Object.keys(rows).filter((code) => rows[code].includes(phrase));
  for (const { code, phrase } of documentedExits()) assert.deepEqual(rowsNaming(phrase), [code], `only the exit ${code} row names: ${phrase}`);
  for (const { phrase, exitCode } of returned) {
    assert.deepEqual(rowsNaming(phrase), [String(exitCode)], `the kit returns ${exitCode} for ${phrase}, so only its row says so`);
  }
  const usage = sectionOf(doc, "Using the kit in a product repo");
  for (const phrase of ["remove `dist/roadmap-kit/` before `npm run kit`", "copy the whole folder, replacing `tools/roadmap-kit/`"]) {
    assert.ok(usage.includes(phrase), `upgrade note names: ${phrase}`);
  }
  assert.equal(KIT_VERSION, "0.1.1");
  assert.ok(doc.includes(`This contract describes roadmap kit ${KIT_VERSION}.`), "the doc names the kit version");
});

// A fake gh for one repo whose staging environment is as given; it records every write.
function liveRepo({ staging, policies = [] }) {
  const writes = [];
  const answers = {
    "repos/o/r": { default_branch: "main" },
    "repos/o/r/environments": [{ environments: [{ name: "staging", ...staging }] }],
    "repos/o/r/environments/staging/deployment-branch-policies": [{ branch_policies: policies }],
  };
  const gh = async (args) => {
    if (args.includes("--method")) {
      writes.push(`${args[args.indexOf("--method") + 1]} ${args.find((arg) => arg.startsWith("repos/"))}`);
      return "{}";
    }
    return JSON.stringify(answers[args.at(-1)]);
  };
  return { gh, writes };
}

const APPLY_RUNS = {
  unownedRules: { staging: { protection_rules: [{ type: "required_reviewers" }] } },
  noBypassAnyCase: { staging: { name: "Staging", can_admins_bypass: false } },
  badIdOnCustom: { staging: { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }, policies: [{ id: "x", name: "main", type: "branch" }] },
  badIdNotYetCustom: { staging: { deployment_branch_policy: null }, policies: [{ id: "x", name: "main", type: "branch" }] },
};

async function applyRun(live) {
  const { gh, writes } = liveRepo(live);
  const lines = [];
  const exitCode = await repoSettings(["apply", "o/r"], { gh, out: silent, err: { write: (text) => lines.push(text.trim()) } });
  return { exitCode, line: lines[0], writes };
}

test("snapshot contract doc says apply deletes undeclared branch policies, refuses undeclared protection rules, and when its policy-id check runs", async () => {
  const doc = await readFile(new URL("../docs/snapshot-contract.md", import.meta.url), "utf8");
  const scopes = sectionOf(doc, "Permission scopes");

  const runs = Object.fromEntries(await Promise.all(Object.entries(APPLY_RUNS).map(async ([name, live]) => [name, await applyRun(live)])));

  for (const phrase of [
    "deletes every branch policy it does not declare", "refuses an environment with protection rules it does not declare", "changes no environment",
    "not yet on custom branch policies", "apply's own PUT happens before the id check",
    "does not let admins bypass its protection rules", "whatever their case",
    "retries a gh read or the environment PUT that fails with HTTP 429, a 5xx or a network error",
    "A POST or DELETE is never retried: a rerun converges", "a stopped run is safe to rerun: apply converges",
  ]) {
    assert.ok(scopes.includes(phrase), `Permission scopes names: ${phrase}`);
  }
  assert.ok(runs.unownedRules.line.startsWith("repo-settings: refused to change staging"));
  assert.deepEqual([runs.unownedRules.exitCode, runs.unownedRules.writes], [1, []], "undeclared rules: refused before any write");
  assert.ok(scopes.includes("`repo-settings: refused to change <environment>"), "the doc quotes the rules refusal line");
  assert.deepEqual([runs.noBypassAnyCase.exitCode, runs.noBypassAnyCase.writes], [1, []], "admins cannot bypass, live name in another case: refused before any write");
  assert.ok(runs.noBypassAnyCase.line.startsWith("repo-settings: refused to change Staging: "), runs.noBypassAnyCase.line);
  assert.ok(scopes.includes(`\`${runs.noBypassAnyCase.line.replace("Staging", "<environment>")}\``), `the doc quotes: ${runs.noBypassAnyCase.line}`);
  assert.deepEqual([runs.badIdOnCustom.exitCode, runs.badIdOnCustom.writes], [1, []], "a bad id on custom policies: refused before any write");
  assert.deepEqual([runs.badIdNotYetCustom.exitCode, runs.badIdNotYetCustom.writes], [1, ["PUT repos/o/r/environments/staging"]], "not yet custom: apply's own PUT, then the refusal");
  for (const { line } of [runs.badIdOnCustom, runs.badIdNotYetCustom]) assert.ok(scopes.includes(`\`${line}\``), `the doc quotes: ${line}`);
});
