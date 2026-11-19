import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publish } from "../src/share/publish.js";
import { createLogger } from "../src/share/log.js";

const dir = new URL("./fixtures/share-publish/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
const KEY = `ccps_${"K".repeat(43)}`;
const MARKER = "MARKER-SNAPSHOT-TEXT";
const UUID = "11111111-2222-4333-8444-555555555555";

const reply = (status, text) => ({ status, headers: { get: () => null }, text: async () => text, json: async () => JSON.parse(text) });

test("publish sends one PUT with contract headers and body, logs only allowlisted fields", async () => {
  const snapshot = { ...fixture("snapshot"), goal: MARKER };
  const calls = [];
  const fetch = async (...args) => (calls.push(args), reply(200, JSON.stringify(fixture("stored").body)));
  const sinkCalls = [];
  const logCalls = [];
  const logger = createLogger((...args) => sinkCalls.push(args));
  const log = (...args) => (logCalls.push(args), logger(...args));

  const result = await publish(snapshot, { fetch, key: KEY, url: "https://site.test", uuid: () => UUID, log });
  const notJson = await publish(snapshot, { fetch: async () => reply(502, "<html>"), key: KEY, url: "https://site.test", uuid: () => UUID, log: () => {}, sleep: async () => {}, random: () => 0 });
  const dropped = createLogger((...args) => sinkCalls.push(args))("e", { key: KEY, body: MARKER, status: 1 });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    `https://site.test/api/share/snapshots/${snapshot.productId}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "Idempotency-Key": UUID },
      body: JSON.stringify(snapshot),
    },
  ]);
  assert.deepEqual(result, { exitCode: 0, line: "published", retryable: false });
  assert.deepEqual(notJson, { exitCode: 1, line: "unexpected response (status 502)", retryable: true });
  assert.equal(logCalls.length, 1);
  assert.equal(sinkCalls.length, 2);
  assert.deepEqual(JSON.parse(sinkCalls[0][0]), { event: "share.publish.attempt", productId: snapshot.productId, status: 200, attempt: 1, outcome: "published" });
  assert.deepEqual(JSON.parse(sinkCalls[1][0]), { event: "e", status: 1 });
  for (const args of [...logCalls, ...sinkCalls]) {
    assert.ok(!JSON.stringify(args).includes(KEY));
    assert.ok(!JSON.stringify(args).includes(MARKER));
  }
  assert.equal(dropped, undefined);
});
