import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ghWithRetry, main, retryGh, SETTINGS } from "../kit/repo-settings.mjs";

const CLI = fileURLToPath(new URL("../kit/repo-settings.mjs", import.meta.url));

const REPO = "example-org/product-repo";
const API = `repos/${REPO}`;

// The gh api flags the fakes understand: switches, and flags that take the next argument.
const SWITCHES = { "--paginate": "paginate", "--slurp": "slurp" };
const addField = (request, pair) => {
  const [key, value] = pair.split("=");
  request.fields[key] = value;
};
const TAKES_VALUE = {
  "--method": (request, value) => { request.method = value; },
  "--jq": (request, value) => { request.jq = value; },
  "-f": addField,
  "-F": addField,
};

// Reads the args of a gh api call: method, path, -f/-F fields and the paging and --jq flags.
function ghRequest(args) {
  const [api, ...rest] = args;
  const request = { api, method: "GET", path: undefined, fields: {}, paginate: false, slurp: false, jq: undefined };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (SWITCHES[arg]) request[SWITCHES[arg]] = true;
    else if (TAKES_VALUE[arg]) TAKES_VALUE[arg](request, rest[(index += 1)]);
    else if (request.path === undefined) request.path = arg;
    else throw new Error(`unexpected gh call ${args.join(" ")}`);
  }
  return request;
}

// Answers a read the way gh does: without --paginate only the first page; with --paginate every
// page, wrapped in one array by --slurp; --jq runs on each page and its outputs are joined.
const LIST_KEYS = ["environments", "branch_policies", "secrets", "variables"];
const NAMES_JQ = /^\.(\w+)\[\]\.name$/;

function pagesOf(body, pageSize) {
  const key = LIST_KEYS.find((candidate) => Array.isArray(body?.[candidate]));
  if (!key) return [body];
  const pages = [];
  for (let start = 0; start === 0 || start < body[key].length; start += pageSize) pages.push({ ...body, [key]: body[key].slice(start, start + pageSize) });
  return pages;
}

function jqOnPage(jq, page) {
  const [, kind] = jq.match(NAMES_JQ) ?? [];
  if (!kind) throw new Error(`fake gh: unsupported --jq ${jq}`);
  return page[kind].map(({ name }) => `${name}\n`).join("");
}

function ghAnswer(body, { paginate, slurp, jq }, pageSize) {
  const pages = pagesOf(body, pageSize);
  const answered = paginate ? pages : pages.slice(0, 1);
  if (jq) return answered.map((page) => jqOnPage(jq, page)).join("");
  return slurp ? JSON.stringify(answered) : answered.map((page) => JSON.stringify(page)).join("");
}

// rules: protection rules of environments that exist before apply runs, by environment name.
//   null: the environment's JSON has no protection_rules key.
// policies: branch policies ({name, type}, or {id, name, type} to set the id gh returns) of
//   environments that exist before apply runs.
// limited: names of those environments that already use custom branch policies.
// pageSize: how many items GitHub puts on one page of each list.
// live: more fields on the environments list, by environment name (e.g. can_admins_bypass).
// It also answers check's reads (names only), so apply and then check can run on one fake.
const LIMITED_FIELDS = { "deployment_branch_policy[protected_branches]": "false", "deployment_branch_policy[custom_branch_policies]": "true" };

function fakeGh({ defaultBranch = "main", rules = {}, policies = {}, limited = [], pageSize = Infinity, live = {} } = {}) {
  let nextId = 1;
  const withId = (policy) => ({ id: nextId++, ...policy });
  const environments = new Map(Object.entries(policies).map(([name, list]) => [name, {
    ...(limited.includes(name) ? { fields: LIMITED_FIELDS } : {}), policies: list.map(withId),
  }]));
  const protectionRules = (name) => (rules[name] === null ? {} : { protection_rules: rules[name] ?? [{ type: "branch_policy" }] });
  const calls = [];
  const environmentOf = (path) => path.slice(`${API}/environments/`.length).split("/")[0];
  const branchRule = (fields = {}) => ({
    protected_branches: fields["deployment_branch_policy[protected_branches]"] === "true",
    custom_branch_policies: fields["deployment_branch_policy[custom_branch_policies]"] === "true",
  });
  const routes = [
    [(method, path) => method === "GET" && path === API, () => ({ default_branch: defaultBranch })],
    [(method, path) => method === "GET" && path === `${API}/environments`, () => ({
      environments: [...new Set([...Object.keys(rules), ...Object.keys(live), ...environments.keys()])]
        .map((name) => ({ name, ...protectionRules(name), deployment_branch_policy: branchRule(environments.get(name)?.fields), ...live[name] })),
    })],
    [(method, path) => method === "PUT" && /\/environments\/[^/]+$/.test(path), (path, fields) => {
      const policies = environments.get(environmentOf(path))?.policies ?? [];
      environments.set(environmentOf(path), { fields, policies });
      return {};
    }],
    [(method, path) => method === "GET" && path.endsWith("/deployment-branch-policies"), (path) => ({
      branch_policies: environments.get(environmentOf(path)).policies,
    })],
    [(method, path) => method === "POST" && path.endsWith("/deployment-branch-policies"), (path, fields) => {
      environments.get(environmentOf(path)).policies.push(withId({ name: fields.name, type: fields.type }));
      return {};
    }],
    [(method, path) => method === "DELETE" && path.includes("/deployment-branch-policies/"), (path) => {
      const environment = environments.get(environmentOf(path));
      environment.policies = environment.policies.filter(({ id }) => id !== Number(path.split("/").at(-1)));
      return {};
    }],
    [(method, path) => method === "GET" && /\/(secrets|variables)$/.test(path), (path) => ({
      [path.split("/").at(-1)]: [...SETTINGS.environmentSecrets, ...SETTINGS.environmentVariables, ...SETTINGS.repoVariables].map((name) => ({ name })),
    })],
  ];
  const gh = async (args) => {
    calls.push(args);
    const request = ghRequest(args);
    const route = request.api === "api" && routes.find(([matches]) => matches(request.method, request.path));
    if (!route) throw new Error(`unexpected gh call ${args.join(" ")}`);
    return ghAnswer(route[1](request.path, request.fields), request, pageSize);
  };
  return { gh, calls, environments };
}

const sink = () => {
  const text = [];
  return { text, write: (chunk) => text.push(chunk) };
};

async function run(argv, { gh, settings } = {}) {
  const out = sink();
  const err = sink();
  const exitCode = await main(argv, { gh, out, err, settings });
  return { exitCode, out: out.text.join(""), err: err.text.join("") };
}

// A run with a fresh fake gh that should be refused, and how many gh calls it made.
async function refusedRun(argv, { settings, fake = fakeGh } = {}) {
  const { gh, calls } = fake();
  return { argv, ...(await run(argv, { gh, settings })), calls: calls.length };
}

function assertRefusedBeforeGh(refused) {
  const evidence = JSON.stringify(refused);
  assert.equal(refused.exitCode, 2, evidence);
  assert.equal(refused.out, "", evidence);
  assert.match(refused.err, /^repo-settings: refused /, evidence);
  assert.equal(refused.calls, 0, evidence);
}

test("repo-settings apply limits staging and production to the default branch through gh api and refuses a malformed value before gh changes anything", async () => {
  const fresh = fakeGh();
  const malformedArgv = [["apply"], ["apply", "no-slash"], ["apply", "org/repo/extra"], ["apply", "org/.."], ["apply", "org/repo;rm"], ["apply", "org;rm/repo"], ["apply", REPO, "extra"]];
  const malformedSettings = [
    { ...SETTINGS, environments: ["staging", "prod"] },
    { ...SETTINGS, environmentSecrets: ["SHARE PUBLISH KEY"] },
    { ...SETTINGS, environmentVariables: ["SHARE_URL/../x"] },
    { ...SETTINGS, repoVariables: ["R".repeat(65)] },
  ];
  const badBranch = fakeGh({ defaultBranch: "main/../x" });

  const first = await run(["apply", REPO], { gh: fresh.gh });
  const firstCalls = fresh.calls.splice(0);
  const second = await run(["apply", REPO], { gh: fresh.gh });
  const refusedArgv = await Promise.all(malformedArgv.map((argv) => refusedRun(argv)));
  const refusedSettings = await Promise.all(malformedSettings.map((settings) => refusedRun(["apply", REPO], { settings })));
  const branchRefused = await run(["apply", REPO], { gh: badBranch.gh });

  const lines = "ok staging: limited to the default branch main\nok production: limited to the default branch main\n";
  assert.deepEqual(first, { exitCode: 0, out: lines, err: "" });
  assert.deepEqual(second, first, "a second apply makes the same result");
  assert.ok(firstCalls.every(([verb]) => verb === "api"), "only gh api");
  assert.ok(firstCalls.flat().every((arg) => !/secret/i.test(arg)), "apply never touches secrets");
  assert.equal(firstCalls.filter((args) => args.includes("POST")).length, 2, "one branch policy per environment");
  assert.equal(fresh.calls.filter((args) => args.includes("POST")).length, 0, "no duplicate branch policy on the second apply");
  for (const name of ["staging", "production"]) {
    assert.deepEqual(fresh.environments.get(name), {
      fields: LIMITED_FIELDS,
      policies: [{ id: name === "staging" ? 1 : 2, name: "main", type: "branch" }],
    }, name);
  }
  for (const refused of [...refusedArgv, ...refusedSettings]) assertRefusedBeforeGh(refused);
  assert.deepEqual(branchRefused, { exitCode: 1, out: "", err: "repo-settings: refused the default branch name\n" });
  assert.deepEqual(badBranch.calls, [["api", API]], "only the default-branch read, no write");
});

test("repo-settings apply refuses to change an existing environment that has reviewers, a wait timer or another undeclared rule, before writing to any environment", async () => {
  const branchRule = { type: "branch_policy" };
  const scenarios = {
    reviewers: { staging: [branchRule], production: [{ type: "required_reviewers", reviewers: [] }, branchRule] },
    waitTimer: { staging: [{ type: "wait_timer", wait_timer: 30 }] },
    unknownRule: { production: [branchRule, { type: "wait_timer", wait_timer: 5 }, { type: "some_future_rule" }] },
    branchOnly: { staging: [branchRule], preview: [{ type: "required_reviewers", reviewers: [] }] },
  };
  const fakes = Object.fromEntries(Object.entries(scenarios).map(([name, rules]) => [name, fakeGh({ rules })]));

  const results = {};
  for (const [name, { gh }] of Object.entries(fakes)) results[name] = await run(["apply", REPO], { gh });

  const refused = (environment, types) => ({ exitCode: 1, out: "", err: `repo-settings: refused to change ${environment}: it has protection rules apply does not declare (${types})\n` });
  assert.deepEqual(results.reviewers, refused("production", "required_reviewers"));
  assert.deepEqual(results.waitTimer, refused("staging", "wait_timer"));
  assert.deepEqual(results.unknownRule, refused("production", "wait_timer, some_future_rule"));
  for (const name of ["reviewers", "waitTimer", "unknownRule"]) {
    assert.deepEqual(fakes[name].calls, [["api", API], ["api", "--paginate", "--slurp", `${API}/environments`]], `${name}: reads only, no write to any environment`);
  }
  assert.deepEqual(results.branchOnly, {
    exitCode: 0, out: "ok staging: limited to the default branch main\nok production: limited to the default branch main\n", err: "",
  });
});

test("repo-settings apply matches live environments to declared ones whatever their case and refuses one whose protection rules admins cannot bypass, before writing to any environment", async () => {
  const reviewers = [{ type: "branch_policy" }, { type: "required_reviewers", reviewers: [] }];
  const scenarios = {
    capitalReviewers: { rules: { Staging: reviewers } },
    noBypass: { live: { production: { can_admins_bypass: false } } },
    capitalNoBypass: { live: { staging: { can_admins_bypass: true }, PRODUCTION: { can_admins_bypass: false } } },
    bypass: { live: { staging: { can_admins_bypass: true }, production: { can_admins_bypass: true } } },
    bypassAbsent: { rules: { staging: [{ type: "branch_policy" }], production: [{ type: "branch_policy" }] } },
    undeclaredNoBypass: { live: { preview: { can_admins_bypass: false } } },
  };
  const fakes = Object.fromEntries(Object.entries(scenarios).map(([name, options]) => [name, fakeGh(options)]));

  const results = {};
  for (const [name, { gh }] of Object.entries(fakes)) results[name] = await run(["apply", REPO], { gh });

  const refused = (line) => ({ exitCode: 1, out: "", err: `repo-settings: refused to change ${line}\n` });
  const noBypass = (environment) => refused(`${environment}: it does not let admins bypass its protection rules`);
  assert.deepEqual(results.capitalReviewers, refused("Staging: it has protection rules apply does not declare (required_reviewers)"));
  assert.deepEqual(results.noBypass, noBypass("production"));
  assert.deepEqual(results.capitalNoBypass, noBypass("PRODUCTION"));
  for (const name of ["capitalReviewers", "noBypass", "capitalNoBypass"]) {
    assert.deepEqual(fakes[name].calls, [["api", API], ["api", "--paginate", "--slurp", `${API}/environments`]], `${name}: reads only, no write to any environment`);
  }
  const applied = { exitCode: 0, out: "ok staging: limited to the default branch main\nok production: limited to the default branch main\n", err: "" };
  for (const name of ["bypass", "bypassAbsent", "undeclaredNoBypass"]) assert.deepEqual(results[name], applied, name);
});

test("repo-settings apply deletes exactly the branch policies it does not declare, so check right after apply reports no drift", async () => {
  const fake = fakeGh({ policies: {
    production: [{ name: "main", type: "branch" }, { name: "release/*", type: "branch" }, { name: "main", type: "tag" }],
    staging: [{ name: "main", type: "tag" }],
  } });

  const applied = await run(["apply", REPO], { gh: fake.gh });
  const checked = await run(["check", REPO], { gh: fake.gh });

  assert.deepEqual(applied, { exitCode: 0, err: "", out: [
    "ok staging: removed extra tag policy \"main\"",
    "ok staging: limited to the default branch main",
    "ok production: removed extra branch policy \"release/*\"",
    "ok production: removed extra tag policy \"main\"",
    "ok production: limited to the default branch main",
  ].map((line) => `${line}\n`).join("") });
  const policiesPath = (environment, id) => `${API}/environments/${environment}/deployment-branch-policies/${id}`;
  assert.deepEqual(fake.calls.filter((args) => args.includes("DELETE")).map((args) => args.at(-1)),
    [policiesPath("staging", 4), policiesPath("production", 2), policiesPath("production", 3)], "deletes exactly the undeclared policies");
  assert.deepEqual(checked, { exitCode: 0, out: `ok ${REPO}: settings match\n`, err: "" });
});

test("repo-settings apply and check read every page of each list gh returns, so an environment, branch policy, secret or variable on page 2 counts", async () => {
  const refusing = fakeGh({ pageSize: 1, rules: { staging: [{ type: "branch_policy" }], production: [{ type: "required_reviewers", reviewers: [] }] } });
  const converging = fakeGh({ pageSize: 1, policies: { staging: [], production: [{ name: "release/*", type: "branch" }, { name: "main", type: "branch" }] } });
  const extraFirst = { ...matching(), pageSize: 1 };
  extraFirst.environments.production.branches = [{ name: "release/*", type: "branch" }, { name: "main", type: "branch" }];

  const refused = await run(["apply", REPO], { gh: refusing.gh });
  const applied = await run(["apply", REPO], { gh: converging.gh });
  const checked = await run(["check", REPO], { gh: converging.gh });
  const checkedExtra = await run(["check", REPO], { gh: liveGh(extraFirst).gh });

  assert.deepEqual(checked, { exitCode: 0, out: `ok ${REPO}: settings match\n`, err: "" }, "environments, secrets and variables on later pages are found");
  assert.deepEqual(applied, { exitCode: 0, err: "", out: [
    "ok staging: limited to the default branch main",
    "ok production: removed extra branch policy \"release/*\"",
    "ok production: limited to the default branch main",
  ].map((line) => `${line}\n`).join("") });
  assert.equal(converging.calls.filter((args) => args.includes("POST")).length, 1, "the declared policy on page 2 is not posted again");
  assert.deepEqual(checkedExtra, { exitCode: 1, out: "", err: "drift production: extra branch policy \"release/*\"\n" }, "check finds the declared policy on page 2");
  assert.deepEqual(refused, {
    exitCode: 1, out: "", err: "repo-settings: refused to change production: it has protection rules apply does not declare (required_reviewers)\n",
  }, "an environment on page 2 is checked before any write");
});

test("repo-settings apply refuses a branch-policy id gh returns that is not a positive integer before deleting anything, and counts an environment without protection_rules as having none", async () => {
  const badIds = ["4; rm -rf /", "../4", 0, -3, 1.5, undefined];
  const extra = (id) => ({ id, name: "release/*", type: "branch" });
  const alreadyLimited = badIds.map((id) => fakeGh({ limited: ["production"], policies: { staging: [], production: [{ name: "main", type: "branch" }, extra(id)] } }));
  const limitedByApply = fakeGh({ policies: { staging: [extra("7/../../8")] } });
  const noRules = fakeGh({ rules: { staging: null, production: null } });

  const refusedBefore = [];
  for (const { gh } of alreadyLimited) refusedBefore.push(await run(["apply", REPO], { gh }));
  const refusedAfterPut = await run(["apply", REPO], { gh: limitedByApply.gh });
  const withoutRules = await run(["apply", REPO], { gh: noRules.gh });

  const refused = { exitCode: 1, out: "", err: "repo-settings: refused a value gh returned\n" };
  const writes = (calls) => calls.filter((args) => args.includes("--method"));
  for (const [index, result] of refusedBefore.entries()) {
    assert.deepEqual(result, refused, `id ${JSON.stringify(badIds[index])}`);
    assert.deepEqual(writes(alreadyLimited[index].calls), [], `id ${JSON.stringify(badIds[index])}: no write to any environment`);
  }
  assert.deepEqual(refusedAfterPut, refused, "an id read after apply's own PUT");
  assert.deepEqual(writes(limitedByApply.calls).map((args) => args[2]), ["PUT"], "the PUT only: no DELETE and no POST");
  assert.deepEqual(withoutRules, {
    exitCode: 0, out: "ok staging: limited to the default branch main\nok production: limited to the default branch main\n", err: "",
  });
});

const VALUE = "a-value-check-must-never-read";
const NAMES_ONLY = { secrets: ".secrets[].name", variables: ".variables[].name" };

function liveGh({ defaultBranch = "main", environments, repoVariables, pageSize = Infinity }) {
  const calls = [];
  const named = (kind, names) => ({ [kind]: names.map((name) => ({ name, value: VALUE })) });
  const environmentRead = (path) => {
    const [name, list] = path.slice(`${API}/environments/`.length).split("/");
    const environment = environments[name];
    if (list === "deployment-branch-policies") return { branch_policies: environment.branches };
    return named(list, environment[list]);
  };
  const reads = (path) => {
    if (path === API) return { default_branch: defaultBranch };
    if (path === `${API}/environments`) {
      return { environments: Object.entries(environments).map(([name, { rule }]) => ({ name, deployment_branch_policy: rule })) };
    }
    if (path === `${API}/actions/variables`) return named("variables", repoVariables);
    return environmentRead(path);
  };
  const gh = async (args) => {
    calls.push(args);
    const request = ghRequest(args);
    if (request.api !== "api" || request.method !== "GET" || Object.keys(request.fields).length > 0) throw new Error(`unexpected gh call ${args.join(" ")}`);
    return ghAnswer(reads(request.path), request, pageSize);
  };
  return { gh, calls };
}

const LIMITED = { protected_branches: false, custom_branch_policies: true };
const matching = () => ({
  environments: Object.fromEntries(["staging", "production"].map((name) => [name, {
    rule: LIMITED, branches: [{ name: "main", type: "branch" }], secrets: ["SHARE_PUBLISH_KEY"], variables: ["SHARE_URL", "OTHER"],
  }])),
  repoVariables: ["ROADMAP_KIT_SHA256"],
});

async function fakeGhOnPath(t, script) {
  const dir = await mkdtemp(join(tmpdir(), "repo-settings-gh-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "gh"), `#!/bin/sh\necho "$@" >> "${join(dir, "calls")}"\n${script}\n`, { mode: 0o755 });
  return dir;
}

function runCli(dir, argv) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...argv], {
    encoding: "utf8", env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` },
  });
  return { status, stdout, stderr };
}

test("repo-settings check names each drifted environment, branch rule, secret and variable with exit 1, reads no value, and the command line runs through gh", async (t) => {
  const live = matching();
  const drifted = matching();
  drifted.environments.staging.rule = { protected_branches: true, custom_branch_policies: false };
  drifted.environments.staging.variables = [];
  drifted.environments.production.branches = [{ name: "release/*", type: "branch" }, { name: "main", type: "tag" }];
  drifted.environments.production.secrets = [];
  drifted.repoVariables = [];
  const noProduction = matching();
  delete noProduction.environments.production;
  const unlimited = matching();
  unlimited.environments.production.rule = null;
  const protectedToo = matching();
  protectedToo.environments.staging.rule = { protected_branches: true, custom_branch_policies: true };
  const scenarios = { live, drifted, noProduction, unlimited, protectedToo };
  const malformed = [["check"], ["check", "no-slash"], ["check", REPO, "extra"], ["remove", REPO]];
  const failingGh = await fakeGhOnPath(t, "exit 1");
  const badBranchGh = await fakeGhOnPath(t, `echo '{"default_branch":"main/../x"}'`);

  const results = {};
  const reads = [];
  for (const [name, settings] of Object.entries(scenarios)) {
    const { gh, calls } = liveGh(settings);
    results[name] = await run(["check", REPO], { gh });
    reads.push(...calls);
  }
  const refused = await Promise.all(malformed.map((argv) => refusedRun(argv, { fake: () => liveGh(matching()) })));
  const cli = { failing: runCli(failingGh, ["check", REPO]), badBranch: runCli(badBranchGh, ["apply", REPO]) };
  const cliCalls = await Promise.all([failingGh, badBranchGh].map((dir) => readFile(join(dir, "calls"), "utf8").catch(() => "")));

  assert.deepEqual(results.live, { exitCode: 0, out: `ok ${REPO}: settings match\n`, err: "" });
  assert.deepEqual(results.drifted, { exitCode: 1, out: "", err: [
    "drift staging: not limited to custom branch policies",
    "drift staging: variable SHARE_URL missing",
    "drift production: branch policy \"main\" missing",
    "drift production: extra branch policy \"release/*\"",
    "drift production: extra tag policy \"main\"",
    "drift production: secret SHARE_PUBLISH_KEY missing",
    "drift repo: variable ROADMAP_KIT_SHA256 missing",
  ].map((line) => `${line}\n`).join("") });
  assert.deepEqual(results.noProduction, { exitCode: 1, out: "", err: "drift production: environment missing\n" });
  assert.deepEqual(results.unlimited, { exitCode: 1, out: "", err: "drift production: not limited to custom branch policies\n" });
  assert.deepEqual(results.protectedToo, { exitCode: 1, out: "", err: "drift staging: not limited to custom branch policies\n" });
  assert.ok(reads.every((args) => args[0] === "api" && !args.includes("--method")), "check only reads");
  const listReads = reads.filter((args) => /(secrets|variables)$/.test(ghRequest(args).path));
  assert.ok(listReads.length > 0 && listReads.every((args) => Object.values(NAMES_ONLY).includes(ghRequest(args).jq)), "secret and variable reads ask gh for names only");
  assert.ok(Object.values(results).every(({ out, err }) => !`${out}${err}`.includes(VALUE)), "no value is printed");
  for (const refusal of refused) assertRefusedBeforeGh(refusal);
  assert.deepEqual(cli, {
    failing: { status: 1, stdout: "", stderr: "repo-settings: gh failed\n" },
    badBranch: { status: 1, stdout: "", stderr: "repo-settings: refused the default branch name\n" },
  });
  assert.deepEqual(cliCalls, [`api ${API}\n`, `api ${API}\n`], "the command line called the fake gh, once each");
});

// A gh call that answers from a script: each entry is gh's stdout, or { stderr } for a failure
// shaped like execText's (an Error "gh failed" carrying gh's stderr).
const URL_IN_STDERR = "https://api.github.com/repos/example-org/product-repo/environments";
function scriptedGh(outcomes) {
  const calls = [];
  const call = async () => {
    const outcome = outcomes[calls.length];
    calls.push(outcome);
    if (typeof outcome === "string") return outcome;
    throw Object.assign(new Error("gh failed"), { stderr: outcome.stderr });
  };
  return { call, calls };
}

async function retried(outcomes) {
  const { call, calls } = scriptedGh(outcomes);
  const waits = [];
  const err = { text: "", write(chunk) { this.text += chunk; } };
  const result = await retryGh(call, { sleep: async (ms) => { waits.push(ms); }, err }).then((stdout) => ({ stdout }), (error) => ({ rejected: error.message }));
  return { ...result, attempts: calls.length, waits, err: err.text };
}

// The one line the operator sees when gh is retried.
const retryLine = (attempt) => `repo-settings: retrying gh (attempt ${attempt} of 4)\n`;
const failure = (status) => ({ stderr: `gh: Something (HTTP ${status})\n{"message":"x","documentation_url":"${URL_IN_STDERR}"}\n` });
const TRANSIENT = [
  failure(429), failure(500), failure(502), failure(503), failure(504),
  { stderr: `Get "${URL_IN_STDERR}": dial tcp 140.82.112.6:443: i/o timeout\n` },
  { stderr: `Get "${URL_IN_STDERR}": net/http: request canceled (Client.Timeout exceeded while awaiting headers)\n` },
  { stderr: `Get "${URL_IN_STDERR}": read tcp: connection reset by peer\n` },
  { stderr: `Get "${URL_IN_STDERR}": dial tcp: connect: connection refused\n` },
  { stderr: "error connecting to api.github.com: could not resolve host\n" },
];
const PERMANENT = [failure(403), failure(404), failure(422), failure(401), failure(501), failure(505), { stderr: "" }, { stderr: undefined }];

test("repo-settings retries gh on HTTP 429, a 5xx or a network error with waits of 1, 2 and 4 seconds and at most 4 attempts, fails at once on any other error, and never prints gh's stderr", async () => {
  const scenarios = {
    unavailableThenOk: [failure(503), "{\"ok\":true}"],
    notFound: [failure(404), "never reached"],
    alwaysTransient: [failure(503), failure(429), failure(502), failure(500), "never reached"],
  };
  const transientThenOk = TRANSIENT.map((outcome) => [outcome, "ok"]);
  const permanentThenOk = PERMANENT.map((outcome) => [outcome, "never reached"]);

  const results = {};
  for (const [name, outcomes] of Object.entries(scenarios)) results[name] = await retried(outcomes);
  const transient = await Promise.all(transientThenOk.map(retried));
  const permanent = await Promise.all(permanentThenOk.map(retried));

  assert.deepEqual(results.unavailableThenOk, { stdout: "{\"ok\":true}", attempts: 2, waits: [1000], err: retryLine(2) });
  assert.deepEqual(results.notFound, { rejected: "gh failed", attempts: 1, waits: [], err: "" });
  assert.deepEqual(results.alwaysTransient, { rejected: "gh failed", attempts: 4, waits: [1000, 2000, 4000], err: [2, 3, 4].map(retryLine).join("") });
  for (const [index, result] of transient.entries()) assert.deepEqual(result, { stdout: "ok", attempts: 2, waits: [1000], err: retryLine(2) }, `transient: ${JSON.stringify(TRANSIENT[index])}`);
  for (const [index, result] of permanent.entries()) assert.deepEqual(result, { rejected: "gh failed", attempts: 1, waits: [], err: "" }, `no retry: ${JSON.stringify(PERMANENT[index])}`);
  assert.ok([...Object.values(results), ...transient].every(({ err }) => !err.includes("http") && !err.includes("HTTP")), "gh's stderr never reaches the operator");
});

// A fake gh script: the first call fails with GitHub's 503 text; every later call answers a clean check.
const LIMITED_JSON = JSON.stringify(LIMITED);
const GH_UNAVAILABLE_ONCE_THEN_CLEAN = `[ -e "$(dirname "$0")/failed-once" ] || { : > "$(dirname "$0")/failed-once"; echo "gh: Service Unavailable (HTTP 503)" >&2; exit 1; }
case "$*" in
  "api ${API}") echo '{"default_branch":"main"}' ;;
  *" ${API}/environments") echo '[{"environments":[{"name":"staging","deployment_branch_policy":${LIMITED_JSON}},{"name":"production","deployment_branch_policy":${LIMITED_JSON}}]}]' ;;
  *"/deployment-branch-policies") echo '[{"branch_policies":[{"name":"main","type":"branch"}]}]' ;;
  *"/secrets --jq .secrets[].name") echo SHARE_PUBLISH_KEY ;;
  *"/environments/"*"/variables --jq .variables[].name") echo SHARE_URL ;;
  *"/actions/variables --jq .variables[].name") echo ROADMAP_KIT_SHA256 ;;
  *) echo "unexpected gh call $*" >&2; exit 1 ;;
esac`;

test("repo-settings on the command line retries a gh call that failed with HTTP 503, prints one retry line, and then runs as a clean run does", async (t) => {
  const unavailableOnceGh = await fakeGhOnPath(t, GH_UNAVAILABLE_ONCE_THEN_CLEAN);

  const result = runCli(unavailableOnceGh, ["check", REPO]);

  assert.deepEqual(result, { status: 0, stdout: `ok ${REPO}: settings match\n`, stderr: retryLine(2) });
  const calls = (await readFile(join(unavailableOnceGh, "calls"), "utf8")).split("\n");
  assert.deepEqual(calls.slice(0, 2), [`api ${API}`, `api ${API}`], "the failed call is the one retried");
});

// The command line's gh, given args, with an exec that fails once with HTTP 503 and then answers "ok".
async function unavailableOnceThroughGh(args) {
  const { call, calls } = scriptedGh([failure(503), "ok"]);
  const sent = [];
  const err = { text: "", write(chunk) { this.text += chunk; } };
  const gh = ghWithRetry((received) => { sent.push(received); return call(); }, { sleep: async () => {}, err });
  const result = await gh(args).then((stdout) => ({ stdout }), (error) => ({ rejected: error.message }));
  return { ...result, attempts: calls.length, err: err.text, sentArgs: sent.every((received) => received === args) };
}

test("repo-settings retries a transient gh failure only for a read or the environment PUT and never for a POST or DELETE", async () => {
  const policies = `${API}/environments/staging/deployment-branch-policies`;
  const calls = {
    read: ["api", API],
    get: ["api", "--method", "GET", `${API}/environments`],
    put: ["api", "--method", "PUT", `${API}/environments/staging`, "-F", "deployment_branch_policy[protected_branches]=false"],
    post: ["api", "--method", "POST", policies, "-f", "name=main", "-f", "type=branch"],
    delete: ["api", "--method", "DELETE", `${policies}/7`],
  };

  const results = {};
  for (const [name, args] of Object.entries(calls)) results[name] = await unavailableOnceThroughGh(args);

  const retriedOnce = { stdout: "ok", attempts: 2, err: retryLine(2), sentArgs: true };
  const failedAtOnce = { rejected: "gh failed", attempts: 1, err: "", sentArgs: true };
  assert.deepEqual(results, { read: retriedOnce, get: retriedOnce, put: retriedOnce, post: failedAtOnce, delete: failedAtOnce });
});
