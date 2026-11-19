import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readPublishKey, keyOrExit } from "../src/share/key.js";

const body = (n) => "MARKER-".repeat(10).slice(0, n).padEnd(n, "k");
const KEY = "ccps_" + body(43);

function spyOutputs() {
  const seen = [];
  const record = (original) =>
    function (...args) {
      seen.push(args.map(String).join(" "));
      return original.apply(this, args);
    };
  for (const name of ["log", "info", "warn", "error"]) {
    mock.method(console, name, record(console[name]));
  }
  mock.method(process.stdout, "write", record(process.stdout.write));
  mock.method(process.stderr, "write", record(process.stderr.write));
  return seen;
}

test("readPublishKey returns a trimmed well-formed key from env, rejects malformed ones, and never emits the key", () => {
  const seen = spyOutputs();
  const values = [
    [`  ${KEY}\n`, KEY],
    [KEY, KEY],
    ["ccps_" + body(42), null],
    ["ccps_" + body(44), null],
    ["ccpx_" + body(43), null],
    ["", null],
    [undefined, null],
  ];

  const results = values.map(([text]) => readPublishKey({ env: { SHARE_PUBLISH_KEY: text } }));
  mock.restoreAll();

  assert.deepEqual(results, values.map(([, expected]) => expected));
  for (const [text] of values) {
    for (const line of seen) assert.ok(!line.includes(text?.trim() || "\u0000"));
  }
  assert.ok(!seen.some((line) => line.includes(body(43))));
});

test("keyOrExit exits 1 with one fixed line for a missing, empty or malformed key, accepts a key with _ and -, and never emits env text", () => {
  const seen = spyOutputs();
  const LINE = "no publish key; set SHARE_PUBLISH_KEY and run again\n";
  const MIXED = "ccps_" + "ab_cd-ef".repeat(6).slice(0, 43);
  const SECRET = "SECRET-ENV-TEXT";
  const rows = [{}, { SHARE_PUBLISH_KEY: "" }, { SHARE_PUBLISH_KEY: SECRET }, { SHARE_PUBLISH_KEY: `${MIXED}\n` }];
  const written = [];
  const err = { write: (text) => written.push(text) };

  const results = rows.map((env) => keyOrExit({ env, err }));
  mock.restoreAll();

  assert.deepEqual(results, [{ exitCode: 1 }, { exitCode: 1 }, { exitCode: 1 }, { exitCode: 0, key: MIXED }]);
  assert.deepEqual(written, [LINE, LINE, LINE]);
  assert.ok(MIXED.includes("_") && MIXED.includes("-"));
  assert.ok(!seen.some((line) => line.includes(SECRET) || line.includes(MIXED)));
  assert.ok(!written.some((line) => line.includes(SECRET) || line.includes(MIXED)));
});
