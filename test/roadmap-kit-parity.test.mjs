import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:https";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKit } from "../scripts/build-kit.mjs";
import { KIT_VERSION } from "../src/kit/version.js";
import { SNAPSHOT_SCHEMA_VERSION } from "../src/share/snapshot.js";
import { committedRepo } from "./support/kit-repo.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const KIT_DIR = join("tools", "roadmap-kit");
const KIT_ENTRY = join(KIT_DIR, "scripts", "roadmap-kit.mjs");
const SCHEMA_SOURCE = "src/share/snapshot.js";
const SCHEMA_LINE = `export const SNAPSHOT_SCHEMA_VERSION = ${SNAPSHOT_SCHEMA_VERSION};`;
const BUMPED_SCHEMA = SNAPSHOT_SCHEMA_VERSION + 1;

const VALID_ROADMAP = { goal: "Ship the kit", wipLimit: 1, staleAfterDays: 14, problems: [] };
const INVALID_ROADMAP = { wipLimit: 0, problems: [] };

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const readFromRepo = (path) => readFile(join(REPO_ROOT, path), "utf8");

function diskWriterUnder(root) {
  return async (path, source) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), source);
  };
}

async function buildKitInto(root, readSource = readFromRepo) {
  return buildKit({ readFile: readSource, writeFile: diskWriterUnder(join(root, KIT_DIR)) });
}

async function readerWithSchemaBumped(path) {
  const source = await readFromRepo(path);
  return path === SCHEMA_SOURCE ? source.replace(SCHEMA_LINE, `export const SNAPSHOT_SCHEMA_VERSION = ${BUMPED_SCHEMA};`) : source;
}

function runBuiltKit(kitRoot, args, { cwd, env = process.env }) {
  return new Promise((resolve) => execFile(process.execPath, [join(kitRoot, KIT_ENTRY), ...args], { cwd, env, encoding: "utf8" },
    (error, stdout, stderr) => resolve({ exitCode: error ? error.code : 0, out: stdout, err: stderr })));
}

async function rehashKitSums(kitRoot) {
  const sums = await readFile(join(kitRoot, KIT_DIR, "SHA256SUMS"), "utf8");
  const mismatches = [];
  for (const line of sums.trimEnd().split("\n")) {
    const [digest, path] = line.split("  ");
    if (sha256(await readFile(join(kitRoot, KIT_DIR, path))) !== digest) mismatches.push(path);
  }
  return { mismatches, kitHashLine: `kit hash: ${sha256(sums)}` };
}

test("the built kit entry run from a product repo outside the kit validates, refuses an invalid roadmap and paces like the source kit", async () => {
  const kitRoot = await mkdtemp(join(tmpdir(), "kit-parity-build-"));
  const schemaKitRoot = await mkdtemp(join(tmpdir(), "kit-parity-schema-"));
  const productRoot = await mkdtemp(join(tmpdir(), "kit-parity-product-"));
  try {
    const kitHashLine = await buildKitInto(kitRoot);
    await buildKitInto(schemaKitRoot, readerWithSchemaBumped);
    await committedRepo(productRoot, {
      "roadmaps/demo/roadmap.json": JSON.stringify(VALID_ROADMAP),
      "roadmaps/demo/decisions.jsonl": "",
      "roadmaps/broken/roadmap.json": JSON.stringify(INVALID_ROADMAP),
      "roadmaps/broken/decisions.jsonl": "",
    });

    const outcomes = {
      validate: await runBuiltKit(kitRoot, ["validate", "roadmaps/demo"], { cwd: productRoot }),
      invalid: await runBuiltKit(kitRoot, ["validate", "roadmaps/broken"], { cwd: productRoot }),
      pace: await runBuiltKit(kitRoot, ["pace", "roadmaps/demo"], { cwd: productRoot }),
      version: await runBuiltKit(schemaKitRoot, ["--version"], { cwd: productRoot }),
    };

    assert.deepEqual(outcomes, {
      validate: { exitCode: 0, out: "roadmap valid\n", err: "" },
      invalid: { exitCode: 1, out: "", err: "roadmap invalid: missing_field, out_of_range\n" },
      pace: { exitCode: 0, out: "pace file written: insufficient\n", err: "" },
      version: { exitCode: 0, out: `roadmap-kit ${KIT_VERSION} snapshot-schema ${BUMPED_SCHEMA}\n`, err: "" },
    });
    assert.equal(existsSync(join(productRoot, "roadmaps", "demo", "pace.json")), true);
    assert.deepEqual(await rehashKitSums(kitRoot), { mismatches: [], kitHashLine });
  } finally {
    for (const dir of [kitRoot, schemaKitRoot, productRoot]) await rm(dir, { recursive: true, force: true });
  }
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FAKE_PUBLISH_KEY = `ccps_${"K".repeat(43)}`;
const STORED_REPLY = { status: 200, body: { status: "stored", publishedAt: "2026-11-15T09:00:00.000Z" } };
const INVALID_REPLY = { status: 422, body: { error: "invalid_snapshot", fields: ["problems[0].title", "goal"] } };

function selfSignedLocalhostCert(dir) {
  const [key, cert] = [join(dir, "stub-key.pem"), join(dir, "stub-cert.pem")];
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", cert,
  ], { stdio: "ignore" });
  return { key, cert };
}

async function snapshotStub({ key, cert }, replies) {
  const seen = [];
  const server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    seen.push({ method: request.method, path: request.url, authorization: request.headers.authorization, idempotencyKey: request.headers["idempotency-key"] });
    const reply = replies[seen.length - 1];
    response.writeHead(reply.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { seen, server, url: `https://127.0.0.1:${server.address().port}` };
}

const resultOnly = ({ exitCode, out }) => ({ exitCode, out });

test("the built kit entry publishes a committed product roadmap to a local https stub: 200 stored prints published and exits 0, 422 prints the invalid snapshot line and exits 1", async () => {
  const kitRoot = await mkdtemp(join(tmpdir(), "kit-parity-build-"));
  const productRoot = await mkdtemp(join(tmpdir(), "kit-parity-product-"));
  const certDir = await mkdtemp(join(tmpdir(), "kit-parity-cert-"));
  const certs = selfSignedLocalhostCert(certDir);
  const stub = await snapshotStub(certs, [STORED_REPLY, INVALID_REPLY]);
  try {
    await buildKitInto(kitRoot);
    await committedRepo(productRoot, {
      "roadmaps/demo/roadmap.json": JSON.stringify(VALID_ROADMAP),
      "roadmaps/demo/decisions.jsonl": "",
    });
    const args = ["publish", "--product", "demo", "--url", stub.url, "roadmaps/demo"];
    const child = { cwd: productRoot, env: { PATH: process.env.PATH, SHARE_PUBLISH_KEY: FAKE_PUBLISH_KEY, NODE_EXTRA_CA_CERTS: certs.cert } };

    const stored = await runBuiltKit(kitRoot, args, child);
    const invalid = await runBuiltKit(kitRoot, args, child);

    assert.deepEqual({ stored: resultOnly(stored), invalid: resultOnly(invalid) }, {
      stored: { exitCode: 0, out: "published\n" },
      invalid: { exitCode: 1, out: "invalid snapshot: problems[0].title, goal\n" },
    });
    const requests = stub.seen.map(({ idempotencyKey, ...request }) => ({ ...request, uuidKey: UUID.test(idempotencyKey) }));
    assert.deepEqual(requests, Array(2).fill({ method: "PUT", path: "/api/share/snapshots/demo", authorization: `Bearer ${FAKE_PUBLISH_KEY}`, uuidKey: true }));
    assert.notEqual(stub.seen[0].idempotencyKey, stub.seen[1].idempotencyKey);
    assert.equal(`${stored.err}${invalid.err}`.includes(FAKE_PUBLISH_KEY), false);
  } finally {
    stub.server.close();
    for (const dir of [kitRoot, productRoot, certDir]) await rm(dir, { recursive: true, force: true });
  }
});
