import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateRoadmap } from "../src/validate.js";
import { validateDecisionLog } from "../src/decisions.js";
import { validatePortfolio } from "../src/portfolio.js";
import { validatePace } from "../src/pace/validate.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const REGISTRY = "portfolio/portfolio.json";

function readRepoText(path) {
  try {
    return readFileSync(`${repoRoot}${path}`, "utf8");
  } catch (error) {
    throw new Error(`could not read ${path}: ${error.code ?? error.message}`);
  }
}

function parseRepoJson(path, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

const readRepoJson = (path) => parseRepoJson(path, readRepoText(path));

function readRepoJsonLines(path) {
  return readRepoText(path)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => parseRepoJson(`${path} line ${index + 1}`, line));
}

function registryRoots() {
  const registry = readRepoJson(REGISTRY);
  assert.deepEqual(validatePortfolio(registry).errors, [], `${REGISTRY} is invalid`);
  const roots = registry.products.map((product) => product.roadmapRoot);
  assert.ok(roots.length > 0, `${REGISTRY} lists no products`);
  return roots;
}

const failuresOf = (checked) =>
  checked.filter(({ result }) => !result.valid).map(({ path, result }) => ({ path, errors: result.errors }));

test("validateRoadmap_withEveryRealRoadmapFile_reportsNoErrors", () => {
  const paths = registryRoots().map((root) => `${root}/roadmap.json`);

  const invalid = failuresOf(paths.map((path) => ({ path, result: validateRoadmap(readRepoJson(path)) })));

  assert.deepEqual(invalid, [], `invalid roadmap files:\n${JSON.stringify(invalid, null, 2)}`);
});

test("validateDecisionLog_withEveryRegistryProductLog_reportsNoErrors", () => {
  const roots = registryRoots();

  const invalid = failuresOf(roots.map((root) => ({
    path: `${root}/decisions.jsonl`,
    result: validateDecisionLog(readRepoJsonLines(`${root}/decisions.jsonl`), readRepoJson(`${root}/roadmap.json`)),
  })));

  assert.deepEqual(invalid, [], `invalid decision logs:\n${JSON.stringify(invalid, null, 2)}`);
});

test("validatePace_withEveryRegistryPaceFile_isNotInvalid", () => {
  const roots = registryRoots().filter((root) => existsSync(`${repoRoot}${root}/pace.json`));

  const invalid = roots
    .map((root) => ({ path: `${root}/pace.json`, pace: readRepoJson(`${root}/pace.json`), roadmap: readRepoJson(`${root}/roadmap.json`) }))
    .filter(({ pace, roadmap }) => validatePace(pace, roadmap, pace.generatedAt).state === "invalid")
    .map(({ path }) => path);

  assert.deepEqual(invalid, [], `pace files with an invalid shape: ${invalid.join(", ")}`);
});
