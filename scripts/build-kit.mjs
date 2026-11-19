import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

const KIT_ENTRY = "scripts/roadmap-kit.mjs";
const IMPORT_SPECIFIER = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const COMMENT_OR_STRING = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;

const withoutComments = (source) =>
  source.replace(COMMENT_OR_STRING, (token) => (token.startsWith("/") ? " " : token));

const KIT_PATH_REFUSED = "build-kit refused: a kit path leaves the kit root or holds a control character";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

const isLocal = (specifier) => ["./", "../", "/"].some((prefix) => specifier.startsWith(prefix));

const destinationOf = (path, specifier) =>
  posix.isAbsolute(specifier) ? specifier : posix.join(posix.dirname(path), specifier);

const leavesKitRoot = (path) => posix.isAbsolute(path) || `${path}/`.startsWith("../");

function refuseOutsideKitRoot(path) {
  if (leavesKitRoot(path) || CONTROL_CHARACTER.test(path)) throw new Error(KIT_PATH_REFUSED);
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function sha256sums(kitFiles) {
  return [...kitFiles.keys()]
    .sort()
    .map((path) => `${sha256(kitFiles.get(path))}  ${path}\n`)
    .join("");
}

function localImportsOf(path, source) {
  return [...withoutComments(source).matchAll(IMPORT_SPECIFIER)]
    .map(([, specifier]) => specifier)
    .filter(isLocal)
    .map((specifier) => destinationOf(path, specifier));
}

async function readKitClosure(readFile) {
  const pending = [KIT_ENTRY];
  const kitClosure = new Map();
  while (pending.length > 0) {
    const path = pending.pop();
    if (kitClosure.has(path)) continue;
    refuseOutsideKitRoot(path);
    const source = await readFile(path);
    kitClosure.set(path, source);
    pending.push(...localImportsOf(path, source));
  }
  return kitClosure;
}

export async function buildKit({ readFile, writeFile }) {
  const kitClosure = await readKitClosure(readFile);
  for (const [path, source] of kitClosure) await writeFile(path, source);
  const sums = sha256sums(kitClosure);
  await writeFile("SHA256SUMS", sums);
  return `kit hash: ${sha256(sums)}`;
}

const KIT_OUTPUT_DIR = join("dist", "roadmap-kit");
const KIT_DIR_EXISTS = "build-kit refused: dist/roadmap-kit already exists; remove it first";

function writerUnder(kitDir) {
  return async (path, source) => {
    await mkdir(dirname(join(kitDir, path)), { recursive: true });
    await writeFile(join(kitDir, path), source);
  };
}

const exists = (path) => access(path).then(() => true, () => false);

async function buildKitInto(root) {
  const kitDir = join(root, KIT_OUTPUT_DIR);
  if (await exists(kitDir)) throw new Error(KIT_DIR_EXISTS);
  return buildKit({ readFile: (path) => readFile(join(root, path), "utf8"), writeFile: writerUnder(kitDir) });
}

if (import.meta.main) {
  process.exitCode = await buildKitInto(process.cwd())
    .then((kitHashLine) => { process.stdout.write(`${kitHashLine}\n`); return 0; })
    .catch((error) => { process.stderr.write(`${error.message}\n`); return 1; });
}
