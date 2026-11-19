import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProduct } from "../src/product.js";

const alpha = { id: "alpha", name: "Alpha Tool", status: "active", roadmapRoot: "products/alpha" };
const beta = { id: "beta", name: "Beta Tool", status: "active", roadmapRoot: "products/beta" };
const registry = JSON.stringify({ version: 1, products: [alpha, beta] });

test("resolveProduct with a product parameter returns that active product and its root after reading only the registry", async () => {
  const reads = [];
  const io = {
    fetch: async (path) => {
      reads.push(path);
      return { ok: true, text: async () => registry };
    },
  };

  const resolved = await resolveProduct(io, "?product=beta");

  assert.deepEqual(resolved, { product: { id: "beta", name: "Beta Tool" }, roadmapRoot: "products/beta" });
  assert.deepEqual(reads, ["portfolio/portfolio.json"]);
});

test("resolveProduct with no product parameter returns the default root and never reads the registry", async () => {
  const reads = [];
  const io = {
    fetch: async (path) => {
      reads.push(path);
      return { ok: true, text: async () => registry };
    },
  };

  const resolved = [await resolveProduct(io, ""), await resolveProduct(io, "?x=1")];

  assert.deepEqual(resolved, [
    { product: null, roadmapRoot: "roadmap" },
    { product: null, roadmapRoot: "roadmap" },
  ]);
  assert.deepEqual(reads, []);
});

test("resolveProduct with an unknown or archived product id returns not_in_portfolio after reading only the registry", async () => {
  const gamma = { id: "gamma", name: "Gamma Tool", status: "archived", roadmapRoot: "products/gamma" };
  const withArchived = JSON.stringify({ version: 1, products: [alpha, gamma] });
  const reads = [];
  const io = {
    fetch: async (path) => {
      reads.push(path);
      return { ok: true, text: async () => withArchived };
    },
  };

  const resolved = [await resolveProduct(io, "?product=delta"), await resolveProduct(io, "?product=gamma")];

  assert.deepEqual(resolved, [{ unavailable: "not_in_portfolio" }, { unavailable: "not_in_portfolio" }]);
  assert.deepEqual(reads, ["portfolio/portfolio.json", "portfolio/portfolio.json"]);
});

test("resolveProduct with a malformed, empty or look-alike product id returns not_in_portfolio after reading only the registry", async () => {
  const searches = [
    "?product=",
    "?product=..%2Froadmap",
    "?product=../roadmap",
    "?product=%2e%2e",
    "?product=a/b",
    "?product=Beta",
    "?product=beta%20",
  ];
  const reads = [];
  const io = {
    fetch: async (path) => {
      reads.push(path);
      return { ok: true, text: async () => registry };
    },
  };

  const resolved = [];
  for (const search of searches) resolved.push(await resolveProduct(io, search));

  assert.deepEqual(resolved, searches.map(() => ({ unavailable: "not_in_portfolio" })));
  assert.deepEqual(reads, searches.map(() => "portfolio/portfolio.json"));
});

test("resolveProduct with an unreadable, non-JSON, duplicate-id or unsafe-root registry returns unavailable registry after reading only the registry", async () => {
  const duplicateIds = JSON.stringify({ version: 1, products: [alpha, { ...beta, id: "alpha" }] });
  const unsafeRoot = JSON.stringify({ version: 1, products: [alpha, { ...beta, roadmapRoot: "../x" }] });
  const responses = [
    { ok: false, text: async () => registry },
    { ok: true, text: async () => "not json {" },
    { ok: true, text: async () => duplicateIds },
    { ok: true, text: async () => unsafeRoot },
  ];
  const reads = [];
  let call = 0;
  const io = {
    fetch: async (path) => {
      reads.push(path);
      return responses[call++];
    },
  };

  const resolved = [];
  for (let i = 0; i < responses.length; i++) resolved.push(await resolveProduct(io, "?product=alpha"));

  assert.deepEqual(resolved, responses.map(() => ({ unavailable: "registry" })));
  assert.deepEqual(reads, responses.map(() => "portfolio/portfolio.json"));
});
