// The publish settings a product repo needs, declared once, applied (`apply`) and checked for
// drift (`check`) through `gh api`. Secret and variable VALUES never pass through here: the
// operator sets them, and check asks gh for names only. Every name and the repo argument are
// checked against an allowlist before any gh call.
import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export const SETTINGS = Object.freeze({
  environments: ["staging", "production"],
  environmentSecrets: ["SHARE_PUBLISH_KEY"],
  environmentVariables: ["SHARE_URL"],
  repoVariables: ["ROADMAP_KIT_SHA256"],
});

const ENVIRONMENTS = new Set(["staging", "production"]);
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const REPO = /^(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$/;
const BRANCH = /^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_./-]{0,63}$/;
const USAGE = "repo-settings: refused the arguments (usage: repo-settings apply|check <owner/repo>)";

const isRepo = (text) => {
  const parts = text.split("/");
  return parts.length === 2 && OWNER.test(parts[0]) && REPO.test(parts[1]);
};

const declaredNames = (settings) => [...settings.environmentSecrets, ...settings.environmentVariables, ...settings.repoVariables];

// Checked in order, before any gh call; the first that matches is the refusal.
const REFUSALS = [
  [(argv) => !Object.hasOwn(COMMANDS, argv[0]) || argv.length !== 2, USAGE],
  [(argv) => !isRepo(argv[1]), "repo-settings: refused the repository name"],
  [(_, settings) => !settings.environments.every((name) => ENVIRONMENTS.has(name)), "repo-settings: refused an environment name"],
  [(_, settings) => !declaredNames(settings).every((name) => NAME.test(name)), "repo-settings: refused a secret or variable name"],
];

const refusalFor = (argv, settings) => REFUSALS.find(([refuses]) => refuses(argv, settings))?.[1];

const read = async (gh, path) => JSON.parse(await gh(["api", path]));
// Every page of a list: --paginate follows GitHub's pages and --slurp wraps them in one array.
const readList = async (gh, path, key) => JSON.parse(await gh(["api", "--paginate", "--slurp", path])).flatMap((page) => page[key]);
const isBranchRule = (branch) => typeof branch === "string" && BRANCH.test(branch);

const isDeclaredPolicy = (branch) => (policy) => policy.name === branch && policy.type === "branch";

// A policy id goes into a DELETE path, so it is checked where it is read: GitHub documents an integer.
const REFUSED_VALUE = "repo-settings: refused a value gh returned";
const isPolicyId = (id) => Number.isSafeInteger(id) && id > 0;
// The branch policies of one environment, or null when gh returned an id apply will not reuse.
async function readPolicies(gh, path) {
  const policies = await readList(gh, `${path}/deployment-branch-policies`, "branch_policies");
  return policies.every((policy) => isPolicyId(policy.id)) ? policies : null;
}

// Converges: every branch policy apply does not declare is deleted, so check after apply is clean.
async function limitToBranch(gh, out, environment, path, branch) {
  await gh(["api", "--method", "PUT", path,
    "-F", "deployment_branch_policy[protected_branches]=false",
    "-F", "deployment_branch_policy[custom_branch_policies]=true"]);
  const policies = await readPolicies(gh, path);
  if (!policies) return false;
  for (const policy of policies.filter((candidate) => !isDeclaredPolicy(branch)(candidate))) {
    await gh(["api", "--method", "DELETE", `${path}/deployment-branch-policies/${policy.id}`]);
    out.write(`ok ${environment}: removed extra ${policy.type} policy ${JSON.stringify(policy.name)}\n`);
  }
  if (!policies.some(isDeclaredPolicy(branch))) {
    await gh(["api", "--method", "POST", `${path}/deployment-branch-policies`, "-f", `name=${branch}`, "-f", "type=branch"]);
  }
  return true;
}

// The only protection rule apply declares; any other (reviewers, a wait timer, a rule GitHub adds
// later) belongs to someone else, and apply's PUT would replace it.
const DECLARED_RULE = "branch_policy";

// Every environment is checked before any write, so a refusal leaves all of them untouched.
// An environment JSON without protection_rules has none. apply's PUT does not send
// can_admins_bypass; on a live repo a PUT that omits it kept an existing false, but an
// environment that stops admins bypassing its rules is still refused, as caution: apply
// declares no such setting, so it leaves that environment to its owner.
function refusalReason(live) {
  const types = (live.protection_rules ?? []).map((rule) => rule.type).filter((type) => type !== DECLARED_RULE);
  if (types.length > 0) return `it has protection rules apply does not declare (${types.join(", ")})`;
  if (live.can_admins_bypass === false) return "it does not let admins bypass its protection rules";
  return undefined;
}

function firstRefusedEnvironment(environments) {
  for (const live of environments) {
    const reason = refusalReason(live);
    if (reason) return `repo-settings: refused to change ${live.name}: ${reason}`;
  }
  return undefined;
}

// GitHub lists an environment's branch policies only once it uses custom policies, so those
// environments' ids are checked before any write; the others are checked after apply's PUT,
// before any DELETE.
async function hasRefusedPolicyId(gh, repoPath, environments) {
  for (const live of environments.filter((candidate) => candidate.deployment_branch_policy?.custom_branch_policies === true)) {
    if (!(await readPolicies(gh, `${repoPath}/environments/${live.name}`))) return true;
  }
  return false;
}

const refuse = (err, line) => {
  err.write(`${line}\n`);
  return 1;
};

async function apply({ gh, out, err, settings, repoPath, branch }) {
  const declared = new Set(settings.environments.map((name) => name.toLowerCase()));
  const environments = (await readList(gh, `${repoPath}/environments`, "environments")).filter((live) => declared.has(live.name.toLowerCase()));
  const refusal = firstRefusedEnvironment(environments);
  if (refusal) return refuse(err, refusal);
  if (await hasRefusedPolicyId(gh, repoPath, environments)) return refuse(err, REFUSED_VALUE);
  for (const environment of settings.environments) {
    if (!(await limitToBranch(gh, out, environment, `${repoPath}/environments/${environment}`, branch))) return refuse(err, REFUSED_VALUE);
    out.write(`ok ${environment}: limited to the default branch ${branch}\n`);
  }
  return 0;
}

// Names only, one per line from every page: gh projects each page to names, so no value reaches this process.
const liveNames = (gh, path, kind) => gh(["api", "--paginate", path, "--jq", `.${kind}[].name`]).then((text) => text.split("\n").filter(Boolean));
const missing = (declared, live) => declared.filter((name) => !live.includes(name));
const isLimited = (rule) => rule?.protected_branches === false && rule?.custom_branch_policies === true;

async function branchDrift(gh, path, branch) {
  const policies = await readList(gh, `${path}/deployment-branch-policies`, "branch_policies");
  return [
    ...(policies.some(isDeclaredPolicy(branch)) ? [] : [`branch policy ${JSON.stringify(branch)} missing`]),
    ...policies.filter((policy) => !isDeclaredPolicy(branch)(policy)).map((policy) => `extra ${policy.type} policy ${JSON.stringify(policy.name)}`),
  ];
}

async function environmentDrift(gh, settings, path, live, branch) {
  if (!live) return ["environment missing"];
  const rule = isLimited(live.deployment_branch_policy) ? await branchDrift(gh, path, branch) : ["not limited to custom branch policies"];
  return [
    ...rule,
    ...missing(settings.environmentSecrets, await liveNames(gh, `${path}/secrets`, "secrets")).map((name) => `secret ${name} missing`),
    ...missing(settings.environmentVariables, await liveNames(gh, `${path}/variables`, "variables")).map((name) => `variable ${name} missing`),
  ];
}

async function check({ gh, out, err, settings, repoPath, branch }) {
  const environments = await readList(gh, `${repoPath}/environments`, "environments");
  const drift = [];
  for (const environment of settings.environments) {
    const live = environments.find((candidate) => candidate.name === environment);
    const lines = await environmentDrift(gh, settings, `${repoPath}/environments/${environment}`, live, branch);
    drift.push(...lines.map((line) => `${environment}: ${line}`));
  }
  const repoVariables = await liveNames(gh, `${repoPath}/actions/variables`, "variables");
  drift.push(...missing(settings.repoVariables, repoVariables).map((name) => `repo: variable ${name} missing`));
  for (const line of drift) err.write(`drift ${line}\n`);
  if (drift.length > 0) return 1;
  out.write(`ok ${repoPath.slice("repos/".length)}: settings match\n`);
  return 0;
}

const COMMANDS = { apply, check };

export async function main(argv, deps) {
  const settings = deps.settings ?? SETTINGS;
  const refusal = refusalFor(argv, settings);
  if (refusal) {
    deps.err.write(`${refusal}\n`);
    return 2;
  }
  const repoPath = `repos/${argv[1]}`;
  const { default_branch: branch } = await read(deps.gh, repoPath);
  if (!isBranchRule(branch)) {
    deps.err.write("repo-settings: refused the default branch name\n");
    return 1;
  }
  return COMMANDS[argv[0]]({ ...deps, settings, repoPath, branch });
}

// A transient gh failure: GitHub rate-limited (429) or failed (500/502/503/504), or the network
// did. Anything else (403, 404, 422, no stderr) fails at once.
const TRANSIENT_GH = [/\bHTTP (?:429|50[0234])\b/, /\b(?:timeout|connection reset|connection refused|could not resolve)\b/i];
export const GH_ATTEMPTS = 4;
const FIRST_WAIT_MS = 1000;
const WAIT_CAP_MS = 8000;
const isTransient = (error) => TRANSIENT_GH.some((pattern) => pattern.test(error.stderr ?? ""));
// 1000, 2000, 4000 ms: doubling from FIRST_WAIT_MS, never above WAIT_CAP_MS.
const waitAfter = (attempt) => Math.min(WAIT_CAP_MS, FIRST_WAIT_MS * 2 ** (attempt - 1));

// Runs call() until it succeeds, a failure is not transient, or GH_ATTEMPTS ran. gh's stderr may
// hold URLs, so only the attempt number reaches the operator.
export function retryGh(call, { sleep, err }) {
  const attemptFrom = (attemptNumber) => call().catch(async (error) => {
    if (attemptNumber === GH_ATTEMPTS || !isTransient(error)) throw error;
    await sleep(waitAfter(attemptNumber));
    err.write(`repo-settings: retrying gh (attempt ${attemptNumber + 1} of ${GH_ATTEMPTS})\n`);
    return attemptFrom(attemptNumber + 1);
  });
  return attemptFrom(1);
}

// Only a read (no --method, or GET) or the environment PUT is retried: sending it twice leaves the
// same state. A POST or DELETE is never retried: if GitHub applied it and the response was lost,
// the retry meets a duplicate or a 404 and stops anyway; a rerun of apply converges instead
// (proven on a live repo).
const RETRYABLE_METHODS = new Set(["GET", "PUT"]);
const isRetryable = (args) => !args.includes("--method") || RETRYABLE_METHODS.has(args[args.indexOf("--method") + 1]);

// The gh the command line uses: exec(args) runs gh once; a retryable call goes through retryGh.
export function ghWithRetry(exec, { sleep, err }) {
  return (args) => (isRetryable(args) ? retryGh(() => exec(args), { sleep, err }) : exec(args));
}

const execText = (command, args) => new Promise((resolve, reject) =>
  execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => (error ? reject(Object.assign(new Error("gh failed"), { stderr })) : resolve(stdout))));

if (import.meta.main) {
  const deps = { gh: ghWithRetry((args) => execText("gh", args), { sleep, err: process.stderr }), out: process.stdout, err: process.stderr };
  process.exitCode = await main(process.argv.slice(2), deps).catch(() => {
    deps.err.write("repo-settings: gh failed\n");
    return 1;
  });
}
