import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot } from "../src/share/snapshot.js";
import { validateSnapshot } from "../src/share/validate-snapshot.js";
import { assertSchemaPin } from "./support/schema-pin.mjs";

const MARKER = "MARKER-VALUE";

const roadmap = {
  goal: "Marker goal",
  problems: [
    { id: "up-001", parent: null, problem: "Marker root", status: "now", order: 1, doneOn: null },
    { id: "up-002", parent: "up-001", problem: "Marker child", status: "done", order: 2, doneOn: "2026-10-30" },
  ],
};
const built = buildSnapshot({
  roadmap, productId: "marker-product", sourceRevision: "abc1234",
  sourceCommittedAt: "2026-11-07T10:00:00Z", generatedAt: "2026-11-08T09:00:00Z",
});
const withForecast = (s) => { s.forecast = [{ id: "up-001", p95Hours: 4.5 }]; };

const rows = [
  ["valid build output", () => {}, []],
  ["valid with forecast", withForecast, []],
  ["empty nodes and forecast", (s) => { s.nodes = []; s.forecast = []; }, []],
  ["root not an object", (s) => { s.__root = null; }, ["$"]],
  ["root is an array", (s) => { s.__root = []; }, ["$"]],
  ["schemaVersion 2", (s) => { s.schemaVersion = 2; }, ["schemaVersion"]],
  ["productId 64 chars", (s) => { s.productId = "a".repeat(64); }, []],
  ["productId 65 chars", (s) => { s.productId = "a".repeat(65); }, ["productId"]],
  ["productId leading hyphen", (s) => { s.productId = "-" + MARKER; }, ["productId"]],
  ["productId uppercase", (s) => { s.productId = MARKER; }, ["productId"]],
  ["productId not a string", (s) => { s.productId = 7; }, ["productId"]],
  ["sourceRevision 7 hex", (s) => { s.sourceRevision = "ABCdef0"; }, []],
  ["sourceRevision 6 hex", (s) => { s.sourceRevision = "abcdef"; }, ["sourceRevision"]],
  ["sourceRevision 40 hex", (s) => { s.sourceRevision = "a".repeat(40); }, []],
  ["sourceRevision 41 hex", (s) => { s.sourceRevision = "a".repeat(41); }, ["sourceRevision"]],
  ["sourceRevision non hex", (s) => { s.sourceRevision = "ggggggg"; }, ["sourceRevision"]],
  ["generatedAt 9 fraction digits", (s) => { s.generatedAt = "2026-11-08T23:59:59.123456789Z"; }, []],
  ["generatedAt 10 fraction digits", (s) => { s.generatedAt = "2026-11-08T09:00:00.1234567890Z"; }, ["generatedAt"]],
  ["generatedAt hour 24", (s) => { s.generatedAt = "2026-11-08T24:00:00Z"; }, ["generatedAt"]],
  ["generatedAt minute 60", (s) => { s.generatedAt = "2026-11-08T09:60:00Z"; }, ["generatedAt"]],
  ["generatedAt no Z", (s) => { s.generatedAt = "2026-11-08T09:00:00+01:00"; }, ["generatedAt"]],
  ["sourceCommittedAt bad", (s) => { s.sourceCommittedAt = MARKER; }, ["sourceCommittedAt"]],
  ["goal 300 chars", (s) => { s.goal = "g".repeat(300); }, []],
  ["goal 301 chars", (s) => { s.goal = "g".repeat(301); }, ["goal"]],
  ["goal not a string", (s) => { s.goal = 3; }, ["goal"]],
  ["nodes 500 items", (s) => { s.nodes = Array.from({ length: 500 }, () => ({ ...s.nodes[0] })); }, []],
  ["nodes 501 items", (s) => { s.nodes = Array.from({ length: 501 }, () => ({ ...s.nodes[0] })); }, ["nodes"]],
  ["nodes not an array", (s) => { s.nodes = {}; }, ["nodes"]],
  ["node not an object", (s) => { s.nodes[1] = MARKER; }, ["nodes[1]"]],
  ["node id 40 chars", (s) => { s.nodes[0].id = "a".repeat(40); }, []],
  ["node id 41 chars", (s) => { s.nodes[0].id = "a".repeat(41); }, ["nodes[0].id"]],
  ["node id empty", (s) => { s.nodes[1].id = ""; }, ["nodes[1].id"]],
  ["node id uppercase", (s) => { s.nodes[0].id = MARKER; }, ["nodes[0].id"]],
  ["node parent bad id", (s) => { s.nodes[1].parent = MARKER; }, ["nodes[1].parent"]],
  ["node parent undefined type", (s) => { s.nodes[1].parent = 5; }, ["nodes[1].parent"]],
  ["problem 300 chars", (s) => { s.nodes[0].problem = "p".repeat(300); }, []],
  ["problem 301 chars", (s) => { s.nodes[0].problem = "p".repeat(301); }, ["nodes[0].problem"]],
  ["problem empty", (s) => { s.nodes[0].problem = ""; }, ["nodes[0].problem"]],
  ["problem space allowed", (s) => { s.nodes[0].problem = " "; }, []],
  ["problem control 1f", (s) => { s.nodes[0].problem = MARKER + "\u001f"; }, ["nodes[0].problem"]],
  ["problem control 7f", (s) => { s.nodes[0].problem = MARKER + "\u007f"; }, ["nodes[0].problem"]],
  ["problem control 9f", (s) => { s.nodes[0].problem = MARKER + "\u009f"; }, ["nodes[0].problem"]],
  ["problem a0 allowed", (s) => { s.nodes[0].problem = " "; }, []],
  ["problem trailing newline", (s) => { s.nodes[0].problem = MARKER + "\n"; }, ["nodes[0].problem"]],
  ["problem not a string", (s) => { s.nodes[0].problem = 1; }, ["nodes[0].problem"]],
  ...["next", "now", "blocked", "paused", "merged", "done", "parked"].map((status) =>
    [`status ${status}`, (s) => { s.nodes[0].status = status; }, []]),
  ["status unknown", (s) => { s.nodes[0].status = MARKER; }, ["nodes[0].status"]],
  ["order 0", (s) => { s.nodes[0].order = 0; }, []],
  ["order -1", (s) => { s.nodes[0].order = -1; }, ["nodes[0].order"]],
  ["order 9999", (s) => { s.nodes[0].order = 9999; }, []],
  ["order 10000", (s) => { s.nodes[0].order = 10000; }, ["nodes[0].order"]],
  ["order fractional", (s) => { s.nodes[0].order = 1.5; }, ["nodes[0].order"]],
  ["order string", (s) => { s.nodes[0].order = "1"; }, ["nodes[0].order"]],
  ["doneOn bad shape", (s) => { s.nodes[1].doneOn = "2026-10-3"; }, ["nodes[1].doneOn"]],
  ["doneOn marker string", (s) => { s.nodes[1].doneOn = MARKER; }, ["nodes[1].doneOn"]],
  ["doneOn number", (s) => { s.nodes[1].doneOn = 5; }, ["nodes[1].doneOn"]],
  ["forecast p95Hours 0", (s) => { withForecast(s); s.forecast[0].p95Hours = 0; }, []],
  ["forecast p95Hours 10000", (s) => { withForecast(s); s.forecast[0].p95Hours = 10000; }, []],
  ["forecast p95Hours 10000.1", (s) => { withForecast(s); s.forecast[0].p95Hours = 10000.1; }, ["forecast[0].p95Hours"]],
  ["forecast p95Hours -0.1", (s) => { withForecast(s); s.forecast[0].p95Hours = -0.1; }, ["forecast[0].p95Hours"]],
  ["forecast p95Hours string", (s) => { withForecast(s); s.forecast[0].p95Hours = MARKER; }, ["forecast[0].p95Hours"]],
  ["forecast id 41 chars", (s) => { withForecast(s); s.forecast[0].id = "a".repeat(41); }, ["forecast[0].id"]],
  ["forecast not an array", (s) => { s.forecast = MARKER; }, ["forecast"]],
  ["forecast item not an object", (s) => { s.forecast = [null]; }, ["forecast[0]"]],
  ["missing goal", (s) => { delete s.goal; }, ["goal"]],
  ["missing nodes", (s) => { delete s.nodes; }, ["nodes"]],
  ["missing node order", (s) => { delete s.nodes[0].order; }, ["nodes[0].order"]],
  ["missing forecast p95Hours", (s) => { withForecast(s); delete s.forecast[0].p95Hours; }, ["forecast[0].p95Hours"]],
  ["extra top-level key", (s) => { s.extra = MARKER; }, ["extra"]],
  ["extra node key", (s) => { s.nodes[1].extra = MARKER; }, ["nodes[1].extra"]],
  ["extra forecast key", (s) => { withForecast(s); s.forecast[0].extra = MARKER; }, ["forecast[0].extra"]],
  ["two violations in order", (s) => { s.goal = 1; s.nodes[0].order = -1; }, ["goal", "nodes[0].order"]],
];

test("validateSnapshot returns exact field paths for each schema constraint and never echoes values", () => {
  const schemaBytes = readFileSync(new URL("../contracts/share-snapshot-v1.schema.json", import.meta.url));
  assertSchemaPin(schemaBytes);

  for (const [name, mutate, expected] of rows) {
    const snapshot = structuredClone(built);
    mutate(snapshot);
    const input = "__root" in snapshot ? snapshot.__root : snapshot;

    const paths = validateSnapshot(input);

    assert.deepEqual(paths, expected, name);
    assert.ok(!JSON.stringify(paths).includes(MARKER), `${name}: path list echoed a value`);
  }
});
