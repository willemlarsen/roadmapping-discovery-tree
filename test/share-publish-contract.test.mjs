import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { interpretPublishResponse } from "../src/share/publish-contract.js";
import { validateSnapshot } from "../src/share/validate-snapshot.js";

const SNAPSHOT_SHA256 = "5041e5a0124fd344a79b3558b112a5a1996cfd99403e13d3d223ce243fc38ab3";
const MARKER = "MARKER-BODY-TEXT";
const dir = new URL("./fixtures/share-publish/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
const withMarker = ({ status, body }) => ({ status, body: { ...body, echo: MARKER, error: body.error } });

const rows = [
  ["stored", 0, false, /published/],
  ["bad-request", 1, false, /bad request.*bug/],
  ["unauthorized", 1, false, /publish key revoked or wrong; mint a new one/],
  ["forbidden", 1, false, /publish key is for another product/],
  ["conflict", 1, false, /idempotency key was reused with a different snapshot/],
  ["stale", 0, false, /site already has a newer snapshot/],
  ["payload-too-large", 1, false, /snapshot is too large/],
  ["invalid-snapshot", 1, false, /invalid snapshot: extra, goal, nodes\.0\.problem/],
  ["rate-limited", 1, true, /rate limited; wait a minute and run again/],
  ["unavailable", 1, true, /publish failed \(server unavailable\); run again, it is safe to repeat/],
];
const unexpected = [
  [{ status: 418, body: { error: "teapot", echo: MARKER } }, false],
  [{ status: 502, body: { echo: MARKER } }, true],
  [{ status: 200, body: { status: "weird", echo: MARKER } }, false],
  [{ status: 401, body: { error: "other", echo: MARKER } }, false],
  [{ status: 409, body: { error: "mystery", echo: MARKER } }, false],
  [{ status: 422, body: { error: "invalid_snapshot", fields: MARKER } }, false],
  [{ status: 401, body: MARKER }, false],
  [{ status: 503, body: null }, true],
  [{ status: 422, body: { error: "invalid_snapshot", fields: [] } }, false],
  [{ status: 422, body: { error: "invalid_snapshot", fields: Array.from({ length: 51 }, (_, i) => `f${i}`) } }, false],
  [{ status: 422, body: { error: "invalid_snapshot", fields: [7] } }, false],
  [{ status: 429, body: { error: "other" } }, false],
];

test("interpretPublishResponse maps every contract response to one exit code and operator line", () => {
  const snapshot = readFileSync(new URL("snapshot.json", dir));
  assert.equal(createHash("sha256").update(snapshot).digest("hex"), SNAPSHOT_SHA256);
  assert.deepEqual(validateSnapshot(JSON.parse(snapshot)), []);

  for (const [name, exitCode, retryable, line] of rows) {
    const response = fixture(name);
    const plain = interpretPublishResponse(response);
    const echoed = interpretPublishResponse(withMarker(response));
    assert.equal(plain.exitCode, exitCode, name);
    assert.equal(plain.retryable, retryable, name);
    assert.match(plain.line, line, name);
    assert.deepEqual(echoed, plain, `${name}: extra body keys change nothing`);
    assert.ok(!echoed.line.includes(MARKER), name);
  }
  for (const [response, retryable] of unexpected) {
    const got = interpretPublishResponse(response);
    assert.deepEqual(got, { exitCode: 1, line: `unexpected response (status ${response.status})`, retryable });
  }
  assert.equal(interpretPublishResponse({ status: 422, body: { error: "invalid_snapshot", fields: ["a;b"] } }).line, "unexpected response (status 422)");
});
