import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "../scripts/publish-share.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/share-publish/${name}.json`, import.meta.url), "utf8"));
const KEY = `ccps_${"K".repeat(43)}`;
const MARKER = "MARKER-PROBLEM-TEXT";
const WAITING = "MARKER-WAITING-ON";
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const ARGV = ["--product", "marker-product", "--roadmap", "roadmap/roadmap.json", "--url", "https://site.test"];
const USAGE = "usage: publish-share --product <id> --roadmap <path> --url <base>\n";

const roadmap = (order) => JSON.stringify({
  goal: "Marker goal",
  problems: [{ id: "up-001", parent: null, problem: MARKER, status: "done", order, doneOn: "2026-11-05", waitingOn: WAITING }],
});
const reply = ({ status, body }) => ({ status, headers: { get: () => null }, json: async () => body });

const rows = [
  { name: "usage: no flags", argv: [], exitCode: 2, err: USAGE, reads: 0, keyReads: 0, fetches: 0 },
  { name: "usage: unknown flag", argv: [...ARGV, "--bogus", "x"], exitCode: 2, err: USAGE, reads: 0, keyReads: 0, fetches: 0 },
  { name: "no key", keyText: "not a key", exitCode: 1, err: "no publish key; set SHARE_PUBLISH_KEY and run again\n", reads: 0, keyReads: 1, fetches: 0 },
  { name: "invalid snapshot", file: roadmap(-1), exitCode: 1, err: "snapshot invalid: nodes[0].order\n", reads: 1, keyReads: 1, fetches: 0 },
  { name: "200 stored", script: ["stored"], exitCode: 0, out: "published\n", reads: 1, keyReads: 1, fetches: 1 },
  { name: "401", script: ["unauthorized"], exitCode: 1, reads: 1, keyReads: 1, fetches: 1 },
  { name: "503 then 200", script: ["unavailable", "stored"], exitCode: 0, out: "published\n", reads: 1, keyReads: 1, fetches: 2, sleeps: 1 },
];

async function drive(row) {
  const seen = { reads: 0, keyReads: 0, fetches: [], sleeps: [], gitCalls: [], out: [], err: [], log: [] };
  const script = [...(row.script ?? [])];
  const deps = {
    readFile: async (path) => {
      if (path === "roadmap/pace.json") throw new Error("ENOENT");
      return (seen.reads += 1, assert.equal(path, "roadmap/roadmap.json"), row.file ?? roadmap(1));
    },
    git: async (args) => (seen.gitCalls.push(args), `${REVISION}\u001f2026-11-07T12:00:00+02:00\n`),
    clock: () => new Date("2026-11-08T09:00:00.789Z"),
    env: { get SHARE_PUBLISH_KEY() { seen.keyReads += 1; return row.keyText ?? KEY; } },
    fetch: async (url, init) => (seen.fetches.push({ url, init }), reply(fixture(script.shift()))),
    uuid: () => "11111111-2222-4333-8444-555555555555",
    sleep: async (ms) => seen.sleeps.push(ms),
    random: () => 0.5,
    out: { write: (text) => seen.out.push(text) },
    err: { write: (text) => seen.err.push(text) },
    log: (line) => seen.log.push(line),
    ...row.deps,
  };
  const exitCode = await main(row.argv ?? ARGV, deps);
  return { exitCode, seen };
}

test("main wires key, roadmap, snapshot, validation and publish in order, and no row leaks the key or snapshot text", async () => {
  for (const row of rows) {
    const { exitCode, seen } = await drive(row);

    assert.equal(exitCode, row.exitCode, row.name);
    assert.equal(seen.reads, row.reads, row.name);
    assert.equal(seen.keyReads, row.keyReads, row.name);
    assert.equal(seen.fetches.length, row.fetches, row.name);
    if (row.err !== undefined) assert.equal(seen.err.join(""), row.err, row.name);
    if (row.out !== undefined) assert.equal(seen.out.join(""), row.out, row.name);
    if (row.sleeps !== undefined) assert.equal(seen.sleeps.length, row.sleeps, row.name);
    const visible = [...seen.out, ...seen.err, ...seen.log].join("\n");
    for (const secret of [KEY, MARKER, WAITING]) assert.ok(!visible.includes(secret), `${row.name} leaked ${secret}`);
    if (row.fetches > 0) {
      const { url, init } = seen.fetches[0];
      assert.equal(url, "https://site.test/api/share/snapshots/marker-product");
      assert.deepEqual(JSON.parse(init.body), {
        schemaVersion: 1, productId: "marker-product", sourceRevision: REVISION,
        generatedAt: "2026-11-08T09:00:00Z", sourceCommittedAt: "2026-11-07T10:00:00Z", goal: "Marker goal",
        nodes: [{ id: "up-001", parent: null, problem: MARKER, status: "done", order: 1, doneOn: "2026-11-05" }],
        forecast: [],
      });
      assert.deepEqual(seen.gitCalls, [["log", "-1", "--format=%H%x1f%cI", "--", "roadmap.json", "pace.json"]]);
    }
    if (row.name === "401") assert.ok(seen.out.join("").length > 0, "401 line printed");
  }
});

test("main with no usable publish key exits 1 with the fixed line before any file read or fetch", async () => {
  const NO_KEY = "no publish key; set SHARE_PUBLISH_KEY and run again\n";
  const refused = [
    { name: "empty", deps: { env: { SHARE_PUBLISH_KEY: "" } } },
    { name: "whitespace only", deps: { env: { SHARE_PUBLISH_KEY: " \n\t " } } },
    { name: "wrong prefix", deps: { env: { SHARE_PUBLISH_KEY: `ccpx_${"K".repeat(43)}` } } },
    { name: "42 characters after the prefix", deps: { env: { SHARE_PUBLISH_KEY: `ccps_${"K".repeat(42)}` } } },
    { name: "44 characters after the prefix", deps: { env: { SHARE_PUBLISH_KEY: `ccps_${"K".repeat(44)}` } } },
  ];
  for (const row of refused) {
    const { exitCode, seen } = await drive(row);

    assert.equal(exitCode, 1, row.name);
    assert.equal(seen.err.join(""), NO_KEY, row.name);
    assert.equal(seen.reads, 0, row.name);
    assert.equal(seen.gitCalls.length, 0, row.name);
    assert.equal(seen.fetches.length, 0, row.name);
    assert.equal(seen.out.join(""), "", row.name);
  }

  const accepted = await drive({ keyText: `ccps_${"K".repeat(43)}`, script: ["stored"] });

  assert.equal(accepted.exitCode, 0);
  assert.equal(accepted.seen.err.join(""), "");
  assert.equal(accepted.seen.fetches.length, 1);
});

test("main reads the publish key only from deps.env SHARE_PUBLISH_KEY: seven shapes, refusals exit 1 with the fixed line, zero fetches and no key in any output; a valid key is the bearer token", async () => {
  const LINE = "no publish key; set SHARE_PUBLISH_KEY and run again\n";
  const VALID = `ccps_${"V".repeat(43)}`;
  const shapes = [
    { name: "absent", env: {}, refused: true },
    { name: "empty", env: { SHARE_PUBLISH_KEY: "" }, refused: true },
    { name: "whitespace only", env: { SHARE_PUBLISH_KEY: " \n\t " }, refused: true },
    { name: "wrong prefix", env: { SHARE_PUBLISH_KEY: `ccpx_${"W".repeat(43)}` }, refused: true },
    { name: "one character short", env: { SHARE_PUBLISH_KEY: `ccps_${"S".repeat(42)}` }, refused: true },
    { name: "exactly valid", env: { SHARE_PUBLISH_KEY: VALID }, refused: false },
    { name: "one character long", env: { SHARE_PUBLISH_KEY: `ccps_${"L".repeat(44)}` }, refused: true },
  ];

  for (const shape of shapes) {
    const { exitCode, seen } = await drive({ deps: { env: shape.env }, script: ["stored"] });

    const visible = [...seen.out, ...seen.err, ...seen.log].join("\n");
    assert.equal(exitCode, shape.refused ? 1 : 0, shape.name);
    assert.equal(seen.fetches.length, shape.refused ? 0 : 1, shape.name);
    assert.equal(seen.err.join(""), shape.refused ? LINE : "", shape.name);
    for (const value of Object.values(shape.env)) {
      if (value.trim() !== "") assert.ok(!visible.includes(value.trim()), `${shape.name} leaked the key`);
    }
    if (!shape.refused) assert.equal(seen.fetches[0].init.headers.Authorization, `Bearer ${VALID}`);
  }
});

const PRIVATE = "MARKER-PRIVATE-TEXT";
const ROADMAP_LINE = "roadmap unreadable or not JSON\n";
const GIT_LINE = "no git commit for roadmap; commit it first\n";
const failRead = { readFile: async () => { throw new Error(`cannot read ${PRIVATE}`); } };
const badJson = { readFile: async () => `{not json ${PRIVATE}` };
const failGit = { git: async () => { throw new Error(`git broke ${PRIVATE}`); } };
const emptyGit = { git: async () => "" };

test("main fails safely on unreadable or non-JSON roadmap and on git failure, with fixed lines and no leaked text", async () => {
  const failures = [
    { name: "readFile rejects", deps: failRead, err: ROADMAP_LINE },
    { name: "roadmap is not JSON", deps: badJson, err: ROADMAP_LINE },
    { name: "git rejects", deps: failGit, err: GIT_LINE },
    { name: "git returns empty output", deps: emptyGit, err: GIT_LINE },
  ];
  for (const row of failures) {
    const { exitCode, seen } = await drive(row);

    assert.equal(exitCode, 1, row.name);
    assert.equal(seen.err.join(""), row.err, row.name);
    assert.equal(seen.out.length, 0, row.name);
    assert.equal(seen.log.length, 0, row.name);
    assert.equal(seen.keyReads, 1, row.name);
    assert.equal(seen.fetches.length, 0, row.name);
    const visible = [...seen.out, ...seen.err, ...seen.log].join("\n");
    for (const secret of [KEY, PRIVATE]) assert.ok(!visible.includes(secret), `${row.name} leaked ${secret}`);
  }
});

const URL_LINE = "--url must start with https://\n";
const withUrl = (url) => ARGV.map((arg) => (arg === "https://site.test" ? url : arg));

test("main refuses a --url that is not https before reading the key, any file or fetching", async () => {
  const rejected = ["http://example.test", "ftp://x", "example.test", ""];
  const accepted = ["https://example.test", "HTTPS://example.test"];
  for (const url of rejected) {
    const { exitCode, seen } = await drive({ argv: withUrl(url) });

    assert.equal(exitCode, 2, url);
    assert.equal(seen.err.join(""), URL_LINE, url);
    assert.equal(seen.out.length, 0, url);
    assert.equal(seen.keyReads, 0, url);
    assert.equal(seen.reads, 0, url);
    assert.equal(seen.fetches.length, 0, url);
  }
  for (const url of accepted) {
    const { exitCode, seen } = await drive({ argv: withUrl(url), script: ["stored"] });

    assert.equal(exitCode, 0, url);
    assert.equal(seen.keyReads, 1, url);
    assert.equal(seen.fetches.length, 1, url);
  }
});

test("main refuses a malformed https --url (no slashes, query, hash, credentials) with the fixed line before the key or any fetch, pins unparseable bases, and accepts a plain origin or prefix", async () => {
  const MALFORMED_LINE = "--url must be an https origin with an optional path, no query, hash or credentials\n";
  const refused = [
    { url: "https://", line: URL_LINE },
    { url: "https://exa mple.test", line: URL_LINE },
    { url: "https:/x", line: MALFORMED_LINE },
    { url: "https://site.test?x=1", line: MALFORMED_LINE },
    { url: "https://site.test/prefix/?x=1", line: MALFORMED_LINE },
    { url: "https://site.test?", line: MALFORMED_LINE },
    { url: "https://site.test#top", line: MALFORMED_LINE },
    { url: "https://site.test#", line: MALFORMED_LINE },
    { url: "https://user:pass@site.test", line: MALFORMED_LINE },
    { url: "https://user@site.test", line: MALFORMED_LINE },
    { url: "https://:pass@site.test", line: MALFORMED_LINE },
  ];
  const accepted = [
    { url: "https://site.test", fetched: "https://site.test/api/share/snapshots/marker-product" },
    { url: "https://site.test/prefix/", fetched: "https://site.test/prefix/api/share/snapshots/marker-product" },
  ];
  for (const { url, line } of refused) {
    const { exitCode, seen } = await drive({ argv: withUrl(url) });

    assert.equal(exitCode, 2, url);
    assert.equal(seen.err.join(""), line, url);
    assert.equal(seen.out.length, 0, url);
    assert.equal(seen.keyReads, 0, url);
    assert.equal(seen.reads, 0, url);
    assert.equal(seen.fetches.length, 0, url);
  }
  for (const { url, fetched } of accepted) {
    const { exitCode, seen } = await drive({ argv: withUrl(url), script: ["stored"] });

    assert.equal(exitCode, 0, url);
    assert.deepEqual(seen.fetches.map((call) => call.url), [fetched], url);
  }
});

test("main refuses a --url path with a .. segment, plain or percent-encoded in either case, before the key or any fetch, accepts a..b names, and refuses traversal-shaped product ids with zero fetches", async () => {
  const TRAVERSAL_LINE = "--url must not contain a .. path segment\n";
  const refusedUrls = [
    "https://site.test/a/../b",
    "https://site.test/..",
    "https://site.test/../",
    "https://site.test/%2e%2e/x",
    "https://site.test/%2E%2E/x",
    "https://site.test/a/%2e./x",
    "https://site.test/a/.%2E",
    "https://site.test/a\\..\\b",
    "https://site.test/%zz/../b",
  ];
  const acceptedUrls = [
    { url: "https://site.test/a..b/", fetched: "https://site.test/a..b/api/share/snapshots/marker-product" },
    { url: "https://site.test/..a", fetched: "https://site.test/..a/api/share/snapshots/marker-product" },
    { url: "https://site.test/.hidden", fetched: "https://site.test/.hidden/api/share/snapshots/marker-product" },
  ];
  const badProducts = ["..", "../x", "a/b", "%2e%2e", "a%2fb", "Upper", ""];
  for (const url of refusedUrls) {
    const { exitCode, seen } = await drive({ argv: withUrl(url) });

    assert.equal(exitCode, 2, url);
    assert.equal(seen.err.join(""), TRAVERSAL_LINE, url);
    assert.deepEqual([seen.out.length, seen.keyReads, seen.reads, seen.fetches.length], [0, 0, 0, 0], url);
  }
  for (const { url, fetched } of acceptedUrls) {
    const { exitCode, seen } = await drive({ argv: withUrl(url), script: ["stored"] });

    assert.equal(exitCode, 0, url);
    assert.deepEqual(seen.fetches.map((call) => call.url), [fetched], url);
  }
  for (const product of badProducts) {
    const { exitCode, seen } = await drive({ argv: ARGV.map((arg) => (arg === "marker-product" ? product : arg)) });

    assert.equal(exitCode, 1, product);
    assert.equal(seen.fetches.length, 0, product);
  }
});

test("main refuses a trailing flag with no value, and the script run with no arguments exits 2 with the usage line", async () => {
  for (const flag of ["--roadmap", "--product", "--url"]) {
    const rest = ARGV.filter((_, i) => !(ARGV[i - 1] === flag || ARGV[i] === flag));
    const { exitCode, seen } = await drive({ argv: [...rest, flag] });

    assert.equal(exitCode, 2, flag);
    assert.equal(seen.err.join(""), USAGE, flag);
    assert.deepEqual([seen.reads, seen.keyReads, seen.fetches.length], [0, 0, 0], flag);
  }

  const script = fileURLToPath(new URL("../scripts/publish-share.mjs", import.meta.url));
  const child = await new Promise((resolve) =>
    execFile(process.execPath, [script], { encoding: "utf8", env: {} }, (error, stdout, stderr) => resolve({ code: error?.code, stdout, stderr })));

  assert.equal(child.code, 2);
  assert.equal(child.stderr, USAGE);
  assert.equal(child.stdout, "");
});

test("main sends forecast p95Hours from the pace file beside the roadmap, rounded to one decimal, capped at 10000, for roadmap nodes only", async () => {
  const rows = [
    ["up-001", 9999.96, 10000], ["up-002", 10000.04, 10000], ["up-003", 10000.05, 10000],
    ["up-004", 12.25, 12.3], ["up-005", 12.34, 12.3], ["up-006", 0, 0],
  ];
  const nodes = rows.map(([id], index) => ({ id, parent: null, problem: MARKER, status: "next", order: index + 1, doneOn: null }));
  const results = [...rows.map(([id, p95Hours]) => ({ id, remainingCycles: 7, p50Hours: 1.11, p85Hours: 2.22, p95Hours })),
    { id: "up-999", remainingCycles: 7, p50Hours: 1, p85Hours: 2, p95Hours: 3 }];
  const pace = { contractVersion: 3, generator: "MARKER-GENERATOR", status: "ok", pace: { hoursPerDay: 1.2345 }, inputs: { commits: 714 }, results };
  const sent = [];
  const deps = {
    readFile: async (path) => (path === "roadmap/pace.json" ? JSON.stringify(pace) : JSON.stringify({ goal: "Marker goal", problems: nodes })),
    git: async () => `${REVISION}\u001f2026-11-07T12:00:00+02:00\n`,
    clock: () => new Date("2026-11-08T09:00:00.789Z"),
    env: { SHARE_PUBLISH_KEY: KEY },
    fetch: async (url, init) => (sent.push(init), reply(fixture("stored"))),
    uuid: () => "11111111-2222-4333-8444-555555555555",
    sleep: async () => {},
    random: () => 0.5,
    out: { write: () => {} },
    err: { write: () => {} },
    log: () => {},
  };

  const exitCode = await main(ARGV, deps);

  assert.equal(exitCode, 0);
  const body = JSON.parse(sent[0].body);
  assert.deepEqual(body.forecast, rows.map(([id, , p95Hours]) => ({ id, p95Hours })));
  assert.ok(!sent[0].body.includes("MARKER-GENERATOR") && !sent[0].body.includes("1.2345") && !sent[0].body.includes("remainingCycles"));
});

test("main sends forecast [] when the pace file is absent, unreadable or has no results array, and only id and p95Hours per item otherwise, with no pace field in the body", async () => {
  const item = { id: "up-001", remainingCycles: 7, p50Hours: 1.1, p85Hours: 2.2, p95Hours: 3.3 };
  const full = { contractVersion: 3, generator: "MARKER-GENERATOR", status: "ok", pace: { hoursPerDay: 1.2345 }, inputs: { commits: 714 } };
  const rows = [
    { name: "absent", pace: null, forecast: [] },
    { name: "not JSON", pace: "{oops", forecast: [] },
    { name: "no results key", pace: JSON.stringify({ ...full, status: "insufficient" }), forecast: [] },
    { name: "results not an array", pace: JSON.stringify({ ...full, results: "up-001" }), forecast: [] },
    { name: "empty results", pace: JSON.stringify({ ...full, results: [] }), forecast: [] },
    { name: "one result", pace: JSON.stringify({ ...full, results: [item] }), forecast: [{ id: "up-001", p95Hours: 3.3 }] },
  ];
  const seen = [];
  for (const row of rows) {
    const sent = [];
    const deps = {
      readFile: async (path) => {
        if (path !== "roadmap/pace.json") return roadmap(1);
        if (row.pace === null) throw new Error("ENOENT");
        return row.pace;
      },
      git: async () => `${REVISION}\u001f2026-11-07T12:00:00+02:00\n`,
      clock: () => new Date("2026-11-08T09:00:00.789Z"),
      env: { SHARE_PUBLISH_KEY: KEY },
      fetch: async (url, init) => (sent.push(init), reply(fixture("stored"))),
      uuid: () => "11111111-2222-4333-8444-555555555555",
      sleep: async () => {},
      random: () => 0.5,
      out: { write: () => {} },
      err: { write: () => {} },
      log: () => {},
    };

    const exitCode = await main(ARGV, deps);

    seen.push({ name: row.name, exitCode, body: JSON.parse(sent[0].body), expected: row.forecast });
  }

  for (const { name, exitCode, body, expected } of seen) {
    assert.equal(exitCode, 0, name);
    assert.deepEqual(body.forecast, expected, name);
    assert.deepEqual(Object.keys(body).sort(), ["forecast", "generatedAt", "goal", "nodes", "productId", "schemaVersion", "sourceCommittedAt", "sourceRevision"], name);
    for (const entry of body.forecast) assert.deepEqual(Object.keys(entry).sort(), ["id", "p95Hours"], name);
  }
});

test("main takes sourceRevision and sourceCommittedAt from the newest commit touching roadmap.json or pace.json, falls back to the roadmap's commit when pace is absent, and exits 1 when neither has a commit", async () => {
  const PACE_REVISION = "fedcba9876543210fedcba9876543210fedcba98";
  const OLD = { hash: REVISION, time: "2026-11-07T12:00:00+02:00", files: ["roadmap.json"] };
  const NEWER_PACE = { hash: PACE_REVISION, time: "2026-11-09T08:30:00-08:00", files: ["pace.json"] };
  const NEWER_ROADMAP = { ...NEWER_PACE, files: ["roadmap.json"] };
  const OLD_PACE = { ...OLD, files: ["pace.json"] };
  const rows = [
    { name: "pace newer than roadmap", history: [NEWER_PACE, OLD], hasPace: true, exitCode: 0, revision: PACE_REVISION, committedAt: "2026-11-09T16:30:00Z" },
    { name: "roadmap newer than pace", history: [NEWER_ROADMAP, OLD_PACE], hasPace: true, exitCode: 0, revision: PACE_REVISION, committedAt: "2026-11-09T16:30:00Z" },
    { name: "pace file absent", history: [OLD], hasPace: false, exitCode: 0, revision: REVISION, committedAt: "2026-11-07T10:00:00Z" },
    { name: "no commit at all", history: [], hasPace: true, exitCode: 1, err: "no git commit for roadmap; commit it first\n" },
  ];
  const seen = [];
  for (const row of rows) {
    const sent = [];
    const gitCalls = [];
    const err = [];
    const deps = {
      readFile: async (path) => {
        if (path !== "roadmap/pace.json") return roadmap(1);
        if (!row.hasPace) throw new Error("ENOENT");
        return JSON.stringify({ status: "ok", results: [] });
      },
      git: async (args) => {
        gitCalls.push(args);
        const paths = args.slice(args.indexOf("--") + 1);
        const newest = row.history.find((commit) => commit.files.some((file) => paths.includes(file)));
        return newest ? `${newest.hash}\u001f${newest.time}\n` : "";
      },
      clock: () => new Date("2026-11-10T09:00:00.789Z"),
      env: { SHARE_PUBLISH_KEY: KEY },
      fetch: async (url, init) => (sent.push(init), reply(fixture("stored"))),
      uuid: () => "11111111-2222-4333-8444-555555555555",
      sleep: async () => {},
      random: () => 0.5,
      out: { write: () => {} },
      err: { write: (text) => err.push(text) },
      log: () => {},
    };

    const exitCode = await main(ARGV, deps);

    seen.push({ row, exitCode, gitCalls, err: err.join(""), body: sent.length > 0 ? JSON.parse(sent[0].body) : null });
  }

  for (const { row, exitCode, gitCalls, err, body } of seen) {
    assert.equal(exitCode, row.exitCode, row.name);
    assert.deepEqual(gitCalls, [["log", "-1", "--format=%H%x1f%cI", "--", "roadmap.json", "pace.json"]], row.name);
    if (row.exitCode === 0) {
      assert.equal(body.sourceRevision, row.revision, row.name);
      assert.equal(body.sourceCommittedAt, row.committedAt, row.name);
    } else {
      assert.equal(body, null, row.name);
      assert.equal(err, row.err, row.name);
    }
  }
});

test("main fetches one single-slash URL whatever trailing slashes --url has, keeping any path prefix", async () => {
  const TAIL = "api/share/snapshots/marker-product";
  const rows = [
    { base: "https://site.test", expected: `https://site.test/${TAIL}` },
    { base: "https://site.test/", expected: `https://site.test/${TAIL}` },
    { base: "https://site.test//", expected: `https://site.test/${TAIL}` },
    { base: "https://site.test/prefix", expected: `https://site.test/prefix/${TAIL}` },
    { base: "https://site.test/prefix/", expected: `https://site.test/prefix/${TAIL}` },
  ];
  const fetched = [];
  for (const row of rows) {
    const deps = {
      readFile: async (path) => { if (path === "roadmap/pace.json") throw new Error("ENOENT"); return roadmap(1); },
      git: async () => `${REVISION}\u001f2026-11-07T12:00:00+02:00\n`,
      clock: () => new Date("2026-11-08T09:00:00.789Z"),
      env: { SHARE_PUBLISH_KEY: KEY },
      fetch: async (url) => (fetched.push({ base: row.base, url }), reply(fixture("stored"))),
      uuid: () => "11111111-2222-4333-8444-555555555555",
      sleep: async () => {},
      random: () => 0.5,
      out: { write: () => {} },
      err: { write: () => {} },
      log: () => {},
    };

    const exitCode = await main(["--product", "marker-product", "--roadmap", "roadmap/roadmap.json", "--url", row.base], deps);

    assert.equal(exitCode, 0, row.base);
  }

  assert.deepEqual(fetched, rows.map((row) => ({ base: row.base, url: row.expected })));
});

test("main runs git in the roadmap's folder: cwd is that folder for relative, absolute and nested roadmap paths, pathspecs are relative to it, and a real git in a temp repo finds the commit from another working directory", async () => {
  const absolute = join(tmpdir(), "marker-abs", "roadmap.json");
  const fakeRows = [
    { roadmap: "roadmap/roadmap.json", cwd: "roadmap", spec: ["roadmap.json", "pace.json"] },
    { roadmap: "roadmap.json", cwd: ".", spec: ["roadmap.json", "pace.json"] },
    { roadmap: absolute, cwd: join(tmpdir(), "marker-abs"), spec: ["roadmap.json", "pace.json"] },
    { roadmap: "a/b/c/plan.json", cwd: "a/b/c", spec: ["plan.json", "pace.json"] },
  ];
  const depsFor = (git, sent, readFileFn) => ({
    readFile: readFileFn, git, clock: () => new Date("2026-11-08T09:00:00.789Z"), env: { SHARE_PUBLISH_KEY: KEY },
    fetch: async (url, init) => (sent.push(init), reply(fixture("stored"))), uuid: () => "11111111-2222-4333-8444-555555555555",
    sleep: async () => {}, random: () => 0.5, out: { write: () => {} }, err: { write: () => {} }, log: () => {},
  });
  const seen = [];
  for (const row of fakeRows) {
    const calls = [];
    const git = async (args, options) => (calls.push({ args, cwd: options?.cwd }), `${REVISION}\u001f2026-11-07T12:00:00+02:00\n`);
    const exitCode = await main(["--product", "marker-product", "--roadmap", row.roadmap, "--url", "https://site.test"], depsFor(git, [], async (path) => (path.endsWith("pace.json") ? "{}" : roadmap(1))));
    seen.push({ row, exitCode, calls });
  }

  const repo = mkdtempSync(join(tmpdir(), "share-d5-"));
  const run = (args, cwd) => new Promise((resolve, reject) => execFile("git", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: repo } }, (error, stdout) => (error ? reject(error) : resolve(stdout))));
  mkdirSync(join(repo, "deep", "roadmap"), { recursive: true });
  writeFileSync(join(repo, "deep", "roadmap", "roadmap.json"), roadmap(1));
  writeFileSync(join(repo, "decoy.json"), "{}");
  await run(["init", "-q"], repo);
  await run(["add", "."], repo);
  await run(["-c", "user.name=t", "-c", "user.email=t@t.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "marker"], repo);
  const head = (await run(["rev-parse", "HEAD"], repo)).trim();
  const realSent = [];
  const realCodes = [];
  const elsewhere = process.cwd();
  for (const roadmapPath of [join(repo, "deep", "roadmap", "roadmap.json"), relative(elsewhere, join(repo, "deep", "roadmap", "roadmap.json"))]) {
    const sent = [];
    realCodes.push(await main(["--product", "marker-product", "--roadmap", roadmapPath, "--url", "https://site.test"], depsFor((args, options) => run(args, options.cwd), sent, (path) => readFile(path, "utf8"))));
    realSent.push(...sent);
  }
  rmSync(repo, { recursive: true, force: true });

  for (const { row, exitCode, calls } of seen) {
    assert.equal(exitCode, 0, row.roadmap);
    assert.deepEqual(calls, [{ args: ["log", "-1", "--format=%H%x1f%cI", "--", ...row.spec], cwd: row.cwd }], row.roadmap);
  }
  assert.deepEqual(realCodes, [0, 0]);
  assert.deepEqual(realSent.map((init) => JSON.parse(init.body).sourceRevision), [head, head]);
});

test("main gives the generic roadmap line, exit 1 and no fetch for a roadmap that parses to null, {}, [], a number, a string or has no problems list, and keeps the real validation line for a missing goal", async () => {
  const shapeRows = [
    { name: "null", file: "null" },
    { name: "empty object", file: "{}" },
    { name: "empty array", file: "[]" },
    { name: "number", file: "42" },
    { name: "string", file: "\"x\"" },
    { name: "problems not a list", file: JSON.stringify({ problems: "not a list" }) },
    { name: "problems an object", file: JSON.stringify({ goal: "g", problems: {} }) },
  ];
  for (const row of shapeRows) {
    const { exitCode, seen } = await drive({ file: row.file });

    assert.equal(exitCode, 1, row.name);
    assert.equal(seen.err.join(""), ROADMAP_LINE, row.name);
    assert.equal(seen.out.length, 0, row.name);
    assert.equal(seen.fetches.length, 0, row.name);
  }

  const noGoal = await drive({ file: JSON.stringify({ problems: [] }) });
  const empty = await drive({ file: JSON.stringify({ goal: "g", problems: [] }), script: ["stored"] });

  assert.equal(noGoal.exitCode, 1);
  assert.equal(noGoal.seen.err.join(""), "snapshot invalid: goal\n");
  assert.equal(noGoal.seen.fetches.length, 0);
  assert.equal(empty.exitCode, 0);
  assert.equal(empty.seen.out.join(""), "published\n");
  assert.deepEqual(JSON.parse(empty.seen.fetches[0].init.body).nodes, []);
});

test("main sends one fresh Idempotency-Key per run, shared by its retries, and never prints it to stdout, stderr or any log line", async () => {
  const uuids = ["aaaaaaaa-1111-4222-8333-aaaaaaaaaaaa", "bbbbbbbb-1111-4222-8333-bbbbbbbbbbbb"];
  const runs = [];
  for (const uuid of uuids) {
    runs.push(await drive({ script: ["unavailable", "unavailable", "stored"], deps: { uuid: () => uuid } }));
  }

  runs.forEach(({ exitCode, seen }, index) => {
    const keys = seen.fetches.map((call) => call.init.headers["Idempotency-Key"]);
    assert.equal(exitCode, 0);
    assert.deepEqual(keys, Array(3).fill(uuids[index]));
    for (const uuid of uuids) {
      for (const line of [...seen.out, ...seen.err, ...seen.log]) assert.ok(!line.includes(uuid), `run ${index} printed ${uuid}`);
    }
    assert.deepEqual(seen.log.map((line) => {
      const { productId, attempt, outcome } = JSON.parse(line);
      return { productId, attempt, outcome };
    }), [1, 2, 3].map((attempt) => ({
      productId: "marker-product", attempt, outcome: attempt < 3 ? "publish failed (server unavailable); run again, it is safe to repeat" : "published",
    })));
  });
  assert.notEqual(runs[0].seen.fetches[0].init.headers["Idempotency-Key"], runs[1].seen.fetches[0].init.headers["Idempotency-Key"]);
});
