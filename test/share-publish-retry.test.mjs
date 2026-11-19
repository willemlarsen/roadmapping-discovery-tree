import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publish } from "../src/share/publish.js";
import { shouldRetry, backoffDelay } from "../src/share/retry.js";
import { createLogger } from "../src/share/log.js";

const dir = new URL("./fixtures/share-publish/", import.meta.url);
const snapshot = JSON.parse(readFileSync(new URL("snapshot.json", dir), "utf8"));
const stored = readFileSync(new URL("stored.json", dir), "utf8");
const KEY = `ccps_${"K".repeat(43)}`;
const UUID = "11111111-2222-4333-8444-555555555555";
const SECRET = "MARKER-NETWORK-DETAIL";
const NETWORK_LINE = "publish failed (network); run again, it is safe to repeat";

const reply = (status, text, headers = {}) => ({ status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => JSON.parse(text) });
const ok = () => reply(200, JSON.stringify(JSON.parse(stored).body));
const err = (status, error, headers) => reply(status, JSON.stringify({ error }), headers);
const boom = () => { throw new Error(SECRET); };

async function run(script) {
  const calls = [];
  const sleeps = [];
  const sink = [];
  const UUIDS = [UUID, "other-1", "other-2", "other-3", "other-4"];
  const logger = createLogger((line) => sink.push(line));
  const fetch = async (_url, init) => (calls.push(init), script[calls.length - 1]());
  const result = await publish(snapshot, { fetch, key: KEY, url: "https://site.test", uuid: () => UUIDS.shift(), log: logger, sleep: async (ms) => sleeps.push(ms), random: () => 0.5 });
  return { result, calls, sleeps, events: sink.map((line) => JSON.parse(line)), sink };
}

test("publish retries transient failures with the same key and bounded backoff, never retries 4xx", async () => {
  const retried = await run([() => err(503, "unavailable"), ok]);
  const limited = await run([() => err(429, "rate_limited", { "retry-after": "3" }), ok]);
  const capped = await run([() => err(429, "rate_limited", { "retry-after": "999" }), ok]);
  const down = await run([boom, boom, boom, boom]);
  const bad = await run([() => err(400, "bad_request")]);
  const unauth = await run([() => err(401, "unauthorized")]);

  assert.deepEqual(retried.result, { exitCode: 0, line: "published", retryable: false });
  assert.equal(retried.calls.length, 2);
  assert.deepEqual(retried.calls.map((c) => c.headers["Idempotency-Key"]), [UUID, UUID]);
  assert.deepEqual(retried.sleeps, [250]);
  assert.deepEqual(retried.events.map((e) => [e.event, e.attempt, e.status]), [["share.publish.attempt", 1, 503], ["share.publish.attempt", 2, 200]]);
  assert.deepEqual(limited.sleeps, [3250]);
  assert.deepEqual(capped.sleeps, [8000]);
  assert.deepEqual(down.result, { exitCode: 1, line: NETWORK_LINE, retryable: true });
  assert.equal(down.calls.length, 4);
  assert.equal(down.sleeps.length, 3);
  assert.deepEqual(down.events.map((e) => e.attempt), [1, 2, 3, 4]);
  for (const refused of [bad, unauth]) {
    assert.equal(refused.calls.length, 1);
    assert.equal(refused.sleeps.length, 0);
  }
  assert.equal(shouldRetry({ retryable: true }, 3), true);
  assert.equal(shouldRetry({ retryable: true }, 4), false);
  assert.equal(shouldRetry({ retryable: false }, 1), false);
  assert.equal(backoffDelay(3, undefined, () => 1), 2000);
  assert.equal(backoffDelay(10, undefined, () => 1), 8000);
  assert.equal(backoffDelay(1, undefined, () => 0), 0);
  assert.equal(backoffDelay(1, 8, () => 0), 8000);
  assert.equal(backoffDelay(1, 9, () => 0), 8000);
  for (const r of [retried, limited, capped, down, bad, unauth]) {
    const seen = JSON.stringify([r.sink, r.calls.length]);
    assert.ok(!seen.includes(KEY));
    assert.ok(!seen.includes(SECRET));
    assert.ok(!r.sink.join("").includes(KEY));
  }
});

test("publish stops after four transient failures with one key, exits 1 with the retryable line, and succeeds when the fourth call works", async () => {
  const rows = [
    ["network error", [boom, boom, boom, boom], NETWORK_LINE],
    ["503", Array(4).fill(() => err(503, "unavailable")), "publish failed (server unavailable); run again, it is safe to repeat"],
    ["429", Array(4).fill(() => err(429, "rate_limited")), "rate limited; wait a minute and run again"],
  ];

  for (const [label, script, line] of rows) {
    const exhausted = await run([...script, ok]);

    assert.deepEqual(exhausted.result, { exitCode: 1, line, retryable: true }, label);
    assert.equal(exhausted.calls.length, 4, label);
    assert.equal(exhausted.sleeps.length, 3, label);
    assert.deepEqual(exhausted.calls.map((c) => c.headers["Idempotency-Key"]), Array(4).fill(UUID), label);
  }
  const recovered = await run([boom, () => err(503, "unavailable"), () => err(429, "rate_limited"), ok]);

  assert.deepEqual(recovered.result, { exitCode: 0, line: "published", retryable: false });
  assert.equal(recovered.calls.length, 4);
  assert.equal(recovered.sleeps.length, 3);
});

test("publish handles a 409 end to end with one call and no retry: conflict exits 1, stale exits 0, unknown exits 1, none leaking key, url or Idempotency-Key", async () => {
  const rows = [
    ["conflict", "conflict", { exitCode: 1, line: "idempotency key was reused with a different snapshot; run again", retryable: false }],
    ["stale", "stale", { exitCode: 0, line: "site already has a newer snapshot; nothing was changed", retryable: false }],
    ["unknown", "mystery", { exitCode: 1, line: "unexpected response (status 409)", retryable: false }],
  ];

  for (const [label, error, expected] of rows) {
    const run409 = await run([() => err(409, error), ok]);

    assert.deepEqual(run409.result, expected, label);
    assert.equal(run409.calls.length, 1, label);
    assert.equal(run409.sleeps.length, 0, label);
    const shown = run409.result.line;
    for (const secret of [KEY, "https://site.test", "Idempotency-Key", UUID]) {
      assert.ok(!shown.includes(secret), `${label} shows ${secret}`);
    }
  }
});

test("backoffDelay adds bounded jitter on top of a server Retry-After and never goes below it", () => {
  const rows = [
    [2, 3, 0, 3000],
    [2, 3, 0.75, 3750],
    [2, 3, 0.999, 3999],
    [1, 7.9, 0, 7900],
    [1, 7.9, 0.999, 8000],
    [1, 999, 0, 8000],
    [1, 999, 0.5, 8000],
    [4, 999, 0.999, 8000],
  ];

  for (const [attempt, seconds, random, expected] of rows) {
    assert.equal(Math.round(backoffDelay(attempt, seconds, () => random)), expected);
  }
  assert.ok(backoffDelay(2, 3, () => 0.999) < 4000);
  for (const attempt of [1, 2, 3, 4]) {
    for (const random of [0, 0.25, 0.5, 0.75, 0.999]) {
      for (const seconds of [0, 1, 3, 7.9, 8]) {
        assert.ok(backoffDelay(attempt, seconds, () => random) >= seconds * 1000);
      }
    }
  }
});
