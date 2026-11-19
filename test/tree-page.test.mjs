import { test } from "node:test";
import assert from "node:assert/strict";
import { startTreePage, mountTree } from "../src/tree-page.js";
import { createReadAtStatus } from "../src/load.js";
import { createFakeDocument, allElements } from "./support/fake-dom.mjs";

const AT = "2026-11-01T12:00:00Z";
const roadmap = {
  version: 1, goal: "Willem always knows where we are", wipLimit: 1, staleAfterDays: 3,
  problems: [
    { id: "up-001", parent: null, problem: "See where we are", status: "now", statusSince: "2026-10-28", order: 1, slices: ["skin-roadmap-bar"], waitingOn: null, resumesAfter: null, doneOn: null, confirmedBy: null },
  ],
};
const logText = JSON.stringify({ at: AT, problemId: "up-001", actor: "Amal", action: "coach-add", before: null, after: "now", why: "Seeded from the approved design" });
const fetchFixture = async (path) => {
  if (path.endsWith("pace.json")) return { ok: false, status: 404, text: async () => "" };
  return { ok: true, text: async () => (path.endsWith(".jsonl") ? logText : JSON.stringify(roadmap)) };
};

function pageDocument() {
  const document = createFakeDocument();
  const slot = () => Object.assign(document.createElement("div"), {
    replaceChildren(...nodes) { this.children.length = 0; nodes.forEach((node) => this.appendChild(node)); },
  });
  const slots = { app: slot("app"), "read-at": slot("read-at") };
  return Object.assign(document, { getElementById: (id) => slots[id], documentElement: document.createElement("html"), hidden: false, slots });
}

test("startTreePage draws the dashboard tree and the read-at status", async () => {
  const document = pageDocument();
  const scheduled = [];

  await startTreePage(document, { fetch: fetchFixture, schedule: (fn, ms) => scheduled.push(ms), now: () => AT, emit: () => {} });

  const tree = allElements(document.slots.app).find((part) => part.attributes["aria-label"] === "Roadmap");
  const status = allElements(document.slots["read-at"]).find((part) => part.attributes.role === "status");
  assert.deepEqual(
    [tree.textContent.includes("See where we are"), status.textContent.startsWith("Roadmap read at"), scheduled.length],
    [true, true, 1],
  );
});

test("mountTree draws the tree into the given container and leaves the other container empty", async () => {
  const document = pageDocument();
  const mine = document.createElement("div");
  const other = document.createElement("div");
  const io = { document, fetch: fetchFixture, schedule: () => {}, now: () => AT, emit: () => {}, status: createReadAtStatus(document) };

  await mountTree(mine, io, "roadmap");

  const drawn = (container) => allElements(container).some((part) => part.attributes["aria-label"] === "Roadmap");
  assert.deepEqual([drawn(mine), drawn(other), other.children.length], [true, false, 0]);
});

test("mountTree destroy stops the watcher and removes the view", async () => {
  const document = pageDocument();
  const container = document.createElement("div");
  const queued = [];
  const counts = { fetches: 0 };
  const countingFetch = async (path) => { counts.fetches += 1; return fetchFixture(path); };
  const io = { document, fetch: countingFetch, schedule: (fn) => queued.push(fn), now: () => AT, emit: () => {}, status: createReadAtStatus(document) };
  const drawn = () => allElements(container).some((part) => part.attributes["aria-label"] === "Roadmap");

  const { destroy } = await mountTree(container, io, "roadmap");
  const before = [drawn(), queued.length];
  destroy();
  const afterDestroy = { fetches: counts.fetches, scheduled: queued.length };
  for (const callback of queued.slice()) await callback();

  assert.deepEqual(
    [before, drawn(), queued.length - afterDestroy.scheduled, counts.fetches - afterDestroy.fetches],
    [[true, 1], false, 0, 0],
  );
});
