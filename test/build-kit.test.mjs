import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildKit } from "../scripts/build-kit.mjs";

const REPO = {
  "scripts/roadmap-kit.mjs": [
    'import { readFile } from "node:fs/promises";',
    "import {",
    "  validateCommand,",
    '} from "../src/kit/validate-command.js";',
    'export { KIT_VERSION } from "../src/kit/version.js";',
    "import './side-effect.mjs';",
    'const later = () => import("../src/kit/lazy.js");',
  ].join("\n"),
  "src/kit/validate-command.js": 'import { validateRoadmap } from "../validate.js";\nimport { join } from "node:path";',
  "src/kit/version.js": 'export const KIT_VERSION = "0.1.0";',
  "src/kit/lazy.js": 'import { KIT_VERSION } from "./version.js";',
  "scripts/side-effect.mjs": "globalThis.loaded = true;",
  "src/validate.js": "export const validateRoadmap = () => ({ valid: true, errors: [] });",
  "test/roadmap-kit.test.mjs": 'import { main } from "../scripts/roadmap-kit.mjs";',
  "src/page.js": 'import { renderTree } from "./render.js";',
  "src/render.js": "export const renderTree = () => {};",
  "test-browser/layout.check.mjs": 'import "../src/page.js";',
};

const CLOSURE = [
  "scripts/roadmap-kit.mjs",
  "scripts/side-effect.mjs",
  "src/kit/lazy.js",
  "src/kit/validate-command.js",
  "src/kit/version.js",
  "src/validate.js",
];

function fakeFileSystem(files) {
  const written = {};
  return {
    readFile: async (path) => {
      if (!(path in files)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      return files[path];
    },
    writeFile: async (path, text) => {
      if (path in written) throw new Error(`written twice: ${path}`);
      written[path] = text;
    },
    written,
  };
}

test("build-kit writes the kit entry and exactly its relative-import closure at the same relative paths", async () => {
  const fs = fakeFileSystem(REPO);

  await buildKit(fs);

  const { SHA256SUMS: _sums, ...copied } = fs.written;
  assert.deepEqual(copied, Object.fromEntries(CLOSURE.map((path) => [path, REPO[path]])));
});

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

test("build-kit writes a sorted SHA256SUMS over the kit files and returns the kit hash line", async () => {
  const fs = fakeFileSystem(REPO);

  const reported = await buildKit(fs);

  const sums = CLOSURE.map((path) => `${sha256(REPO[path])}  ${path}\n`).join("");
  assert.equal(fs.written.SHA256SUMS, sums);
  assert.equal(reported, `kit hash: ${sha256(sums)}`);
  assert.match(reported, /^kit hash: [0-9a-f]{64}$/);
});

const MIXED_CASE_REPO = {
  ...REPO,
  "src/kit/lazy.js": `${REPO["src/kit/lazy.js"]}\nimport { zeta } from "./Zeta.js";`,
  "src/kit/Zeta.js": "export const zeta = 1;",
};

function readerAnsweringIn(order, files) {
  const fs = fakeFileSystem(Object.fromEntries(order.map((path) => [path, files[path]])));
  const delayOf = new Map(order.map((path, index) => [path, index]));
  const read = fs.readFile;
  fs.readFile = async (path) => {
    await new Promise((resolve) => setTimeout(resolve, delayOf.get(path)));
    return read(path);
  };
  return fs;
}

const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

test("two builds of the same sources write byte-identical files and the same kit hash, with SHA256SUMS in byte order", async () => {
  const paths = Object.keys(MIXED_CASE_REPO);
  const first = readerAnsweringIn(paths, MIXED_CASE_REPO);
  const second = readerAnsweringIn([...paths].reverse(), MIXED_CASE_REPO);

  const kitHashLines = [await buildKit(first), await buildKit(second)];

  assert.deepEqual(second.written, first.written);
  assert.equal(kitHashLines[1], kitHashLines[0]);
  const summedPaths = first.written.SHA256SUMS.trimEnd().split("\n").map((line) => line.slice(66));
  assert.deepEqual(summedPaths, [...summedPaths].sort(byteOrder));
  assert.deepEqual(
    summedPaths.filter((path) => path.startsWith("src/kit/")),
    ["src/kit/Zeta.js", "src/kit/lazy.js", "src/kit/validate-command.js", "src/kit/version.js"],
  );
});

const KIT_PATH_REFUSED = "build-kit refused: a kit path leaves the kit root or holds a control character";

const repoImporting = (specifier) => ({
  ...REPO,
  "src/kit/lazy.js": `${REPO["src/kit/lazy.js"]}\nimport { stray } from "${specifier}";`,
});

test("build-kit refuses a kit path outside the kit root or holding a control character before any write", async () => {
  const cases = {
    escapesRepo: repoImporting("../../../outside.js"),
    absolute: repoImporting("/Users/someone/outside.js"),
    newline: repoImporting("./bad\nname.js"),
  };

  const outcomes = {};
  for (const [name, files] of Object.entries(cases)) {
    const fs = fakeFileSystem(files);
    const error = await buildKit(fs).then(() => undefined, (refusal) => refusal.message);
    outcomes[name] = { error, written: Object.keys(fs.written) };
  }

  const refused = { error: KIT_PATH_REFUSED, written: [] };
  assert.deepEqual(outcomes, { escapesRepo: refused, absolute: refused, newline: refused });
});

const COMMENTED_REPO = {
  ...REPO,
  "src/kit/lazy.js": [
    REPO["src/kit/lazy.js"],
    '// import "./missing.js";',
    '/* export { gone } from "./also-missing.js";',
    '   import("./still-missing.js"); */',
    'const home = "https://example.test//docs"; import { after } from "./after-url.js";',
    '/* one */ import { between } from "./between.js"; /* two */',
  ].join("\n"),
  "src/kit/after-url.js": "export const after = 1;",
  "src/kit/between.js": "export const between = 1;",
};

test("build-kit ignores imports inside // and /* */ comments but follows an import after a // inside a string", async () => {
  const fs = fakeFileSystem(COMMENTED_REPO);

  await buildKit(fs);

  const { SHA256SUMS: _sums, ...copied } = fs.written;
  assert.deepEqual(Object.keys(copied).sort(), [...CLOSURE, "src/kit/after-url.js", "src/kit/between.js"].sort());
});
