import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "../scripts/check-share-environments.mjs";

const REPO = "repos/willemlarsen/roadmapping-discovery-tree/environments";
const MARKER_VALUE = "https://MARKER-VALUE.test";
const MARKER_SECRET_FIELD = "MARKER-SECRET-FIELD";
const ENVIRONMENTS = ["staging", "production"];

const healthy = () => ({
  exists: true,
  custom: true,
  policies: ["main"],
  secrets: ["SHARE_PUBLISH_KEY"],
  variables: ["SHARE_URL"],
});

const ok = (environment, text) => `ok ${environment}: ${text}`;
const miss = (environment, text) => `MISSING ${environment}: ${text}`;
const passing = (environment) => [
  ok(environment, "environment exists"),
  ok(environment, "deployment branches are custom"),
  ok(environment, "branch policy is main only"),
  ok(environment, "secret SHARE_PUBLISH_KEY"),
  ok(environment, "variable SHARE_URL"),
];
const stagingPasses = passing("staging");

const rows = [
  { name: "everything present", exitCode: 0, lines: [...stagingPasses, ...passing("production")] },
  {
    name: "production environment missing",
    production: { exists: false },
    exitCode: 1,
    lines: [...stagingPasses, miss("production", "environment")],
  },
  {
    name: "deployment branches not custom",
    production: { custom: false },
    exitCode: 1,
    lines: [...stagingPasses, ...passing("production").map((line, index) => (index === 1 ? miss("production", "deployment branches are custom") : line))],
  },
  {
    name: "branch policy is *",
    production: { policies: ["*"] },
    exitCode: 1,
    lines: [...stagingPasses, ...passing("production").map((line, index) => (index === 2 ? miss("production", "branch policies are * (want exactly main)") : line))],
  },
  {
    name: "extra branch policy",
    production: { policies: ["main", "release"] },
    exitCode: 1,
    lines: [...stagingPasses, ...passing("production").map((line, index) => (index === 2 ? miss("production", "branch policies are main, release (want exactly main)") : line))],
  },
  {
    name: "secret name missing",
    production: { secrets: ["OTHER_SECRET"] },
    exitCode: 1,
    lines: [...stagingPasses, ...passing("production").map((line, index) => (index === 3 ? miss("production", "secret SHARE_PUBLISH_KEY") : line))],
  },
  {
    name: "variable name missing",
    production: { variables: ["OTHER_VAR"] },
    exitCode: 1,
    lines: [...stagingPasses, ...passing("production").map((line, index) => (index === 4 ? miss("production", "variable SHARE_URL") : line))],
  },
];

function fakeGh(config) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    const [, path] = args;
    const environment = ENVIRONMENTS.find((name) => path.startsWith(`${REPO}/${name}`));
    const state = config[environment];
    const rest = path.slice(`${REPO}/${environment}`.length);
    if (!state.exists) throw new Error("HTTP 404: Not Found");
    if (rest === "") {
      return JSON.stringify({ name: environment, deployment_branch_policy: { protected_branches: false, custom_branch_policies: state.custom } });
    }
    if (rest === "/deployment-branch-policies") {
      return JSON.stringify({ total_count: state.policies.length, branch_policies: state.policies.map((name) => ({ name, type: "branch" })) });
    }
    if (rest === "/secrets") {
      return JSON.stringify({ total_count: state.secrets.length, secrets: state.secrets.map((name) => ({ name, value: MARKER_SECRET_FIELD })) });
    }
    if (rest === "/variables") {
      return JSON.stringify({ total_count: state.variables.length, variables: state.variables.map((name) => ({ name, value: MARKER_VALUE })) });
    }
    throw new Error(`unexpected gh call ${args.join(" ")}`);
  };
  return { gh, calls };
}

test("check-share-environments reports each environment check by name and exits 1 on any miss", async () => {
  for (const row of rows) {
    const config = { staging: healthy(), production: { ...healthy(), ...row.production } };
    const { gh, calls } = fakeGh(config);
    const out = [];
    const err = [];

    const exitCode = await main({ gh, out: { write: (text) => out.push(text) }, err: { write: (text) => err.push(text) } });

    assert.equal(exitCode, row.exitCode, row.name);
    assert.equal(out.join(""), `${row.lines.join("\n")}\n`, row.name);
    assert.equal(err.join(""), "", row.name);
    assert.ok(calls.every(([verb]) => verb === "api"), `${row.name}: only gh api reads`);
    assert.ok(!out.join("").includes(MARKER_VALUE) && !out.join("").includes(MARKER_SECRET_FIELD), `${row.name}: no value printed`);
  }
});
