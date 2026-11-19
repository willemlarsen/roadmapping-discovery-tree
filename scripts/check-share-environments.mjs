import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENVIRONMENTS = ["staging", "production"];
const BASE = "repos/willemlarsen/roadmapping-discovery-tree/environments";
const SECRET = "SHARE_PUBLISH_KEY";
const VARIABLE = "SHARE_URL";

const read = async (gh, path) => JSON.parse(await gh(["api", path]));
const names = (list) => list.map((entry) => entry.name);

async function readEnvironment(gh, environment) {
  const path = `${BASE}/${environment}`;
  try {
    const details = await read(gh, path);
    const policies = await read(gh, `${path}/deployment-branch-policies`);
    const secrets = await read(gh, `${path}/secrets`);
    const variables = await read(gh, `${path}/variables`);
    return {
      custom: details.deployment_branch_policy?.custom_branch_policies === true,
      policies: names(policies.branch_policies),
      secrets: names(secrets.secrets),
      variables: names(variables.variables),
    };
  } catch {
    return null;
  }
}

function checksFor(environment, found) {
  if (!found) return [[false, environment, "environment"]];
  const policyText = found.policies.join(", ");
  return [
    [true, environment, "environment exists"],
    [found.custom, environment, "deployment branches are custom"],
    [found.policies.length === 1 && found.policies[0] === "main", environment, "branch policy is main only", `branch policies are ${policyText} (want exactly main)`],
    [found.secrets.includes(SECRET), environment, `secret ${SECRET}`],
    [found.variables.includes(VARIABLE), environment, `variable ${VARIABLE}`],
  ];
}

export async function main(deps) {
  let missing = false;
  for (const environment of ENVIRONMENTS) {
    const found = await readEnvironment(deps.gh, environment);
    for (const [passed, name, text, missText = text] of checksFor(environment, found)) {
      deps.out.write(passed ? `ok ${name}: ${text}\n` : `MISSING ${name}: ${missText}\n`);
      missing ||= !passed;
    }
  }
  return missing ? 1 : 0;
}

const execText = (command, args) => new Promise((resolve, reject) =>
  execFile(command, args, { encoding: "utf8" }, (error, stdout) => (error ? reject(new Error("gh failed")) : resolve(stdout))));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main({ gh: (args) => execText("gh", args), out: process.stdout, err: process.stderr });
}
