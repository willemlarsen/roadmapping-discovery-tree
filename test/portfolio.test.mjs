import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOneProduct, loadPortfolio, loadRegistry, productHref, solvingNow, statusWords, validatePortfolio } from "../src/portfolio.js";

const product = { id: "dashboard", name: "Product Dashboard", status: "active", roadmapRoot: "roadmap" };
const registry = { version: 1, products: [product] };
const roadmapOf = (goal, problem) =>
  JSON.stringify({
    version: 1, goal, wipLimit: 1, staleAfterDays: 3,
    problems: [{ id: "up-001", parent: null, problem, status: "now", statusSince: "2026-10-31", order: 1, slices: ["s"], waitingOn: null, resumesAfter: null, doneOn: null, confirmedBy: null }],
  });
const seededLog = JSON.stringify({ at: "2026-10-31T09:00:00Z", problemId: "up-001", actor: "Amal", action: "coach-add", before: null, after: "now", why: "Seeded" });

test("a registry with a missing or unknown field fails with a named error and a valid one passes", () => {
  const withoutTop = (field) => Object.fromEntries(Object.entries(registry).filter(([key]) => key !== field));
  const withoutProductField = (field) => ({
    ...registry,
    products: [Object.fromEntries(Object.entries(product).filter(([key]) => key !== field))],
  });

  assert.deepEqual(validatePortfolio(registry), { valid: true, errors: [] });
  for (const field of ["version", "products"]) {
    assert.deepEqual(validatePortfolio(withoutTop(field)).errors, [{ productId: null, reason: "missing_field", field }]);
  }
  for (const field of ["id", "name", "status", "roadmapRoot"]) {
    assert.deepEqual(validatePortfolio(withoutProductField(field)).errors, [{ productId: field === "id" ? null : "dashboard", reason: "missing_field", field }]);
  }
  assert.deepEqual(validatePortfolio({ ...registry, owner: "w" }).errors, [{ productId: null, reason: "unknown_field" }]);
  assert.deepEqual(validatePortfolio({ ...registry, products: [{ ...product, colour: "red" }] }).errors, [{ productId: "dashboard", reason: "unknown_field" }]);
});

test("a registry, products list or product of the wrong type returns a wrong_type error and never throws", () => {
  const wrongType = (productId, field) => ({ valid: false, errors: [{ productId, reason: "wrong_type", field }] });

  assert.deepEqual(validatePortfolio(registry), { valid: true, errors: [] });
  for (const notARegistry of [null, [], "portfolio"]) {
    assert.deepEqual(validatePortfolio(notARegistry), wrongType(null, "registry"));
  }
  for (const notProducts of [null, {}, "dashboard"]) {
    assert.deepEqual(validatePortfolio({ ...registry, products: notProducts }), wrongType(null, "products"));
  }
  for (const notAProduct of [null, [], "dashboard"]) {
    assert.deepEqual(validatePortfolio({ ...registry, products: [product, notAProduct] }), wrongType(null, "product"));
  }
});

test("a product status other than active or archived fails with a named invalid_status error and both allowed values pass", () => {
  const withStatus = (status) => validatePortfolio({ ...registry, products: [{ ...product, status }] });

  for (const allowed of ["active", "archived"]) {
    assert.deepEqual(withStatus(allowed), { valid: true, errors: [] });
  }
  for (const notAllowed of ["Active", "paused", "", 7]) {
    assert.deepEqual(withStatus(notAllowed), {
      valid: false,
      errors: [{ productId: "dashboard", reason: "invalid_status", field: "status" }],
    });
  }
});

test("a registry with a repeated product id fails with a named duplicate_id error for each repeated id and distinct ids pass", () => {
  const named = (id, name) => ({ ...product, id, name });
  const withProducts = (...products) => validatePortfolio({ ...registry, products });
  const duplicate = (productId) => ({ productId, reason: "duplicate_id", field: "id" });
  const alpha = named("alpha", "Alpha");
  const beta = named("beta", "Beta");
  const gamma = named("gamma", "Gamma");

  assert.deepEqual(withProducts(alpha, beta, gamma), { valid: true, errors: [] });
  assert.deepEqual(withProducts(alpha, beta, named("alpha", "Alpha again")).errors, [duplicate("alpha")]);
  assert.deepEqual(
    withProducts(alpha, beta, gamma, named("beta", "Beta again"), named("alpha", "Alpha third")).errors,
    [duplicate("beta"), duplicate("alpha")],
  );
});

test("a product id that is not a safe slug fails with a named unsafe_id error, safe slugs pass and missing ids are not duplicates", () => {
  const withId = (id) => validatePortfolio({ ...registry, products: [{ ...product, id }] });
  const withoutId = (name) => {
    const { id, ...rest } = product;
    return { ...rest, name };
  };

  for (const safe of ["clickchain-platform", "p1"]) {
    assert.deepEqual(withId(safe), { valid: true, errors: [] });
  }
  for (const unsafe of ["a/b", "..", "../x", "a b", "Upper", "-lead", "trail-", "a--b", "%2e%2e", 7]) {
    assert.deepEqual(withId(unsafe), {
      valid: false,
      errors: [{ productId: unsafe, reason: "unsafe_id", field: "id" }],
    });
  }
  assert.deepEqual(
    validatePortfolio({ ...registry, products: [withoutId("First"), withoutId("Second")] }).errors,
    [
      { productId: null, reason: "missing_field", field: "id" },
      { productId: null, reason: "missing_field", field: "id" },
    ],
  );
});

test("a product roadmapRoot that is not a safe relative path fails with a named unsafe_root error, safe relative roots pass and a missing root is only missing_field", () => {
  const withRoot = (roadmapRoot) => validatePortfolio({ ...registry, products: [{ ...product, roadmapRoot }] });
  const { roadmapRoot, ...withoutRoot } = product;

  for (const safe of ["roadmap", "products/clickchain-platform/roadmap", "a/b-c/d"]) {
    assert.deepEqual(withRoot(safe), { valid: true, errors: [] });
  }
  for (const unsafe of ["..", "a/../b", "../x", "%2e%2e/x", "a/%2E%2e", "/abs", "\\win", "a\\b", "http://x", "file:x", "", 7]) {
    assert.deepEqual(withRoot(unsafe), {
      valid: false,
      errors: [{ productId: "dashboard", reason: "unsafe_root", field: "roadmapRoot" }],
    });
  }
  assert.deepEqual(validatePortfolio({ ...registry, products: [withoutRoot] }).errors, [
    { productId: "dashboard", reason: "missing_field", field: "roadmapRoot" },
  ]);
});

test("a product roadmapRoot holding a control character or whitespace fails with a named unsafe_root error and a plain safe root passes", () => {
  const withRoot = (roadmapRoot) => validatePortfolio({ ...registry, products: [{ ...product, roadmapRoot }] });

  assert.deepEqual(withRoot("products/x/roadmap"), { valid: true, errors: [] });
  for (const unsafe of ["a/.\n./.\n./x", "a/.\t./x", "a b/roadmap"]) {
    assert.deepEqual(withRoot(unsafe), {
      valid: false,
      errors: [{ productId: "dashboard", reason: "unsafe_root", field: "roadmapRoot" }],
    });
  }
});

test("a product roadmapRoot holding U+0000 or U+007F, which are not whitespace, fails with a named unsafe_root error and a plain safe root passes", () => {
  const withRoot = (roadmapRoot) => validatePortfolio({ ...registry, products: [{ ...product, roadmapRoot }] });

  assert.deepEqual(withRoot("products/x/roadmap"), { valid: true, errors: [] });
  for (const unsafe of ["a\u0000b/roadmap", "a\u007fb/roadmap"]) {
    assert.deepEqual(withRoot(unsafe), {
      valid: false,
      errors: [{ productId: "dashboard", reason: "unsafe_root", field: "roadmapRoot" }],
    });
  }
});

test("a product roadmapRoot holding ? or # fails with a named unsafe_root error while a plain root and a nested slug path pass", () => {
  const withRoot = (roadmapRoot) => validatePortfolio({ ...registry, products: [{ ...product, roadmapRoot }] });

  assert.deepEqual(withRoot("roadmap"), { valid: true, errors: [] });
  assert.deepEqual(withRoot("products/clickchain-platform/roadmap"), { valid: true, errors: [] });
  for (const unsafe of ["a?b", "a#b"]) {
    assert.deepEqual(withRoot(unsafe), {
      valid: false,
      errors: [{ productId: "dashboard", reason: "unsafe_root", field: "roadmapRoot" }],
    });
  }
});

test("solvingNow lists the problem texts of now leaves in roadmap order, leaves out blocked cards and a now parent, says none when nothing is in flight and stale when stale", () => {
  const card = (id, parent, status) => ({ id, parent, status, order: 1, problem: `Solve ${id}` });
  const busy = {
    problems: [
      card("up-001", null, "now"),
      card("up-020", "up-001", "now"),
      card("up-005", null, "blocked"),
      card("up-030", "up-001", "now"),
      card("up-040", null, "next"),
    ],
  };
  const idle = { problems: [card("up-050", null, "next"), card("up-060", null, "done")] };

  assert.deepEqual(solvingNow(busy, false), { cards: ["Solve up-020", "Solve up-030"] });
  assert.deepEqual(solvingNow(idle, false), { none: true });
  assert.deepEqual(solvingNow(idle, true), { stale: true });
  assert.deepEqual(solvingNow(busy, true), { stale: true });
});

test("loadPortfolio returns one result per active product with its own name, goal, ok or stale state and solving cards", async () => {
  const card = (id, problem, statusSince) => ({
    id, parent: null, problem, status: "now", statusSince, order: 1, slices: ["s"], waitingOn: null, resumesAfter: null, doneOn: null, confirmedBy: null,
  });
  const roadmapOf = (goal, problem, statusSince) =>
    JSON.stringify({ version: 1, goal, wipLimit: 1, staleAfterDays: 3, problems: [card("up-001", problem, statusSince)] });
  const logOf = (at) =>
    JSON.stringify({ at, problemId: "up-001", actor: "Amal", action: "coach-add", before: null, after: "now", why: "Seeded" });
  const files = {
    "portfolio/portfolio.json": JSON.stringify({
      version: 1,
      products: [
        { id: "alpha", name: "Alpha Product", status: "active", roadmapRoot: "products/alpha/roadmap" },
        { id: "beta", name: "Beta Product", status: "active", roadmapRoot: "products/beta/roadmap" },
      ],
    }),
    "products/alpha/roadmap/roadmap.json": roadmapOf("Alpha goal", "Alpha problem", "2026-10-31"),
    "products/alpha/roadmap/decisions.jsonl": logOf("2026-10-31T09:00:00Z"),
    "products/alpha/roadmap/pace.json": "{}",
    "products/beta/roadmap/roadmap.json": roadmapOf("Beta goal", "Beta problem", "2026-10-10"),
    "products/beta/roadmap/decisions.jsonl": logOf("2026-10-10T09:00:00Z"),
    "products/beta/roadmap/pace.json": "{}",
  };
  const fetch = async (path) => (path in files ? { ok: true, text: async () => files[path] } : { ok: false });

  const results = await loadPortfolio({ fetch, now: () => "2026-11-01T12:00:00Z" });

  assert.deepEqual(results, [
    { id: "alpha", name: "Alpha Product", goal: "Alpha goal", state: "ok", solving: { cards: ["Alpha problem"] } },
    { id: "beta", name: "Beta Product", goal: "Beta goal", state: "stale", solving: { stale: true } },
  ]);
});

test("a registry that cannot be fetched, is not JSON or fails validation yields one portfolio failure, never throws and loads no product", async () => {
  const good = { version: 1, products: [{ id: "alpha", name: "Alpha", status: "active", roadmapRoot: "products/alpha/roadmap" }] };
  const unsafe = { version: 1, products: [{ id: "alpha", name: "Alpha", status: "active", roadmapRoot: "../secret" }] };
  const serving = (text) => {
    const paths = [];
    const fetch = async (path) => {
      paths.push(path);
      return text === null ? { ok: false } : { ok: true, text: async () => text };
    };
    return { fetch, paths, now: () => "2026-11-01T12:00:00Z" };
  };
  const cases = [
    [null, "registry_unavailable"],
    ["{not json", "registry_unavailable"],
    [JSON.stringify(unsafe), "registry_invalid"],
  ];

  for (const [text, failure] of cases) {
    const io = serving(text);
    assert.deepEqual(await loadRegistry(io), { failure });
    assert.deepEqual(await loadPortfolio(io), [{ failure }]);
    assert.deepEqual(io.paths, ["portfolio/portfolio.json", "portfolio/portfolio.json"]);
  }
  assert.deepEqual(await loadRegistry(serving(JSON.stringify(good))), { registry: good });
});

test("a registry fetch that rejects or whose text rejects yields one registry_unavailable failure, never throws, and a good registry still loads", async () => {
  const good = { version: 1, products: [{ id: "alpha", name: "Alpha", status: "active", roadmapRoot: "products/alpha/roadmap" }] };
  const now = () => "2026-11-01T12:00:00Z";
  const fetchRejects = async () => {
    throw new Error("network down");
  };
  const textRejects = async () => ({
    ok: true,
    text: async () => {
      throw new Error("body cut off");
    },
  });
  const failure = [{ failure: "registry_unavailable" }];

  const fromFetch = await loadPortfolio({ fetch: fetchRejects, now });
  const fromText = await loadPortfolio({ fetch: textRejects, now });
  const loaded = await loadRegistry({ fetch: async () => ({ ok: true, text: async () => JSON.stringify(good) }), now });

  assert.deepEqual(fromFetch, failure);
  assert.deepEqual(fromText, failure);
  assert.deepEqual(loaded, { registry: good });
});

test("archived products are neither loaded nor returned: active A and C come back in order and B's roadmap root is never fetched", async () => {
  const entry = (id, name, status) => ({ id, name, status, roadmapRoot: `products/${id}/roadmap` });
  const files = {
    "portfolio/portfolio.json": JSON.stringify({
      version: 1,
      products: [entry("alpha", "Alpha Product", "active"), entry("beta", "Beta Product", "archived"), entry("gamma", "Gamma Product", "active")],
    }),
  };
  for (const [id, goal, problem] of [["alpha", "Alpha goal", "Alpha problem"], ["beta", "Beta goal", "Beta problem"], ["gamma", "Gamma goal", "Gamma problem"]]) {
    files[`products/${id}/roadmap/roadmap.json`] = roadmapOf(goal, problem);
    files[`products/${id}/roadmap/decisions.jsonl`] = seededLog;
    files[`products/${id}/roadmap/pace.json`] = "{}";
  }
  const fetched = [];
  const fetch = async (path) => {
    fetched.push(path);
    return path in files ? { ok: true, text: async () => files[path] } : { ok: false };
  };

  const results = await loadPortfolio({ fetch, now: () => "2026-11-01T12:00:00Z" });

  assert.deepEqual(results, [
    { id: "alpha", name: "Alpha Product", goal: "Alpha goal", state: "ok", solving: { cards: ["Alpha problem"] } },
    { id: "gamma", name: "Gamma Product", goal: "Gamma goal", state: "ok", solving: { cards: ["Gamma problem"] } },
  ]);
  assert.deepEqual(fetched.filter((path) => path.startsWith("products/beta/")), []);
});

test("a product whose roadmap fetch fails is unavailable with only its id and name while the other product still loads ok", async () => {
  const entry = (id, name) => ({ id, name, status: "active", roadmapRoot: `products/${id}/roadmap` });
  const alpha = entry("alpha", "Alpha Product");
  const beta = entry("beta", "Beta Product");
  const files = {
    "portfolio/portfolio.json": JSON.stringify({ version: 1, products: [alpha, beta] }),
    "products/beta/roadmap/roadmap.json": JSON.stringify({
      version: 1, goal: "Beta goal", wipLimit: 1, staleAfterDays: 3,
      problems: [{ id: "up-001", parent: null, problem: "Beta problem", status: "now", statusSince: "2026-10-31", order: 1, slices: ["s"], waitingOn: null, resumesAfter: null, doneOn: null, confirmedBy: null }],
    }),
    "products/beta/roadmap/decisions.jsonl": JSON.stringify({ at: "2026-10-31T09:00:00Z", problemId: "up-001", actor: "Amal", action: "coach-add", before: null, after: "now", why: "Seeded" }),
    "products/beta/roadmap/pace.json": "{}",
  };
  const fetch = async (path) => (path in files ? { ok: true, text: async () => files[path] } : { ok: false });
  const io = { fetch, now: () => "2026-11-01T12:00:00Z" };

  const results = await loadPortfolio(io);

  assert.deepEqual(await loadOneProduct(io, alpha), { id: "alpha", name: "Alpha Product", state: "unavailable" });
  assert.deepEqual(results, [
    { id: "alpha", name: "Alpha Product", state: "unavailable" },
    { id: "beta", name: "Beta Product", goal: "Beta goal", state: "ok", solving: { cards: ["Beta problem"] } },
  ]);
});

test("a product whose roadmap is not JSON, fails the schema or disagrees with its decision log is unavailable with only its id and name while the good product still loads ok", async () => {
  const entry = (id, name) => ({ id, name, status: "active", roadmapRoot: `products/${id}/roadmap` });
  const logOf = (after) =>
    [{ at: "2026-10-31T09:00:00Z", action: "coach-add", before: null, after: "now" }, { at: "2026-10-31T10:00:00Z", action: "coach-status", before: "now", after }]
      .map((line) => JSON.stringify({ problemId: "up-001", actor: "Amal", why: "Seeded", ...line }))
      .join("\n");
  const products = [entry("badjson", "Bad Json Product"), entry("goodone", "Good Product"), entry("badschema", "Bad Schema Product"), entry("badlog", "Bad Log Product")];
  const files = { "portfolio/portfolio.json": JSON.stringify({ version: 1, products }) };
  const put = (id, roadmapText, logText) => {
    files[`products/${id}/roadmap/roadmap.json`] = roadmapText;
    files[`products/${id}/roadmap/decisions.jsonl`] = logText;
    files[`products/${id}/roadmap/pace.json`] = "{}";
  };
  put("badjson", "{ not json", logOf("now"));
  put("goodone", roadmapOf("Good goal", "Good problem"), logOf("now"));
  put("badschema", JSON.stringify({ version: 1, goal: "Schema goal" }), logOf("now"));
  put("badlog", roadmapOf("Log goal", "Log problem"), logOf("next"));
  const fetch = async (path) => (path in files ? { ok: true, text: async () => files[path] } : { ok: false });

  const results = await loadPortfolio({ fetch, now: () => "2026-11-01T12:00:00Z" });

  assert.deepEqual(results, [
    { id: "badjson", name: "Bad Json Product", state: "unavailable" },
    { id: "goodone", name: "Good Product", goal: "Good goal", state: "ok", solving: { cards: ["Good problem"] } },
    { id: "badschema", name: "Bad Schema Product", state: "unavailable" },
    { id: "badlog", name: "Bad Log Product", state: "unavailable" },
  ]);
});

test("a product whose fetch rejects is unavailable with only its id and name while the products before and after it still load ok", async () => {
  const entry = (id, name) => ({ id, name, status: "active", roadmapRoot: `products/${id}/roadmap` });
  const products = [entry("first", "First Product"), entry("broken", "Broken Product"), entry("last", "Last Product")];
  const files = { "portfolio/portfolio.json": JSON.stringify({ version: 1, products }) };
  for (const [id, goal, problem] of [["first", "First goal", "First problem"], ["last", "Last goal", "Last problem"]]) {
    files[`products/${id}/roadmap/roadmap.json`] = roadmapOf(goal, problem);
    files[`products/${id}/roadmap/decisions.jsonl`] = seededLog;
    files[`products/${id}/roadmap/pace.json`] = "{}";
  }
  const fetch = async (path) => {
    if (path.startsWith("products/broken/")) throw new Error("network down");
    return path in files ? { ok: true, text: async () => files[path] } : { ok: false };
  };

  const results = await loadPortfolio({ fetch, now: () => "2026-11-01T12:00:00Z" });

  assert.deepEqual(results, [
    { id: "first", name: "First Product", goal: "First goal", state: "ok", solving: { cards: ["First problem"] } },
    { id: "broken", name: "Broken Product", state: "unavailable" },
    { id: "last", name: "Last Product", goal: "Last goal", state: "ok", solving: { cards: ["Last problem"] } },
  ]);
});

test("statusWords says Solving now with every card, nothing being solved, stale, or could not be read, one line per state", () => {
  const ok = (solving) => ({ id: "p", name: "P", goal: "g", state: "ok", solving });
  const results = [
    ok({ cards: ["Find the pulse", "Fix the gate"] }),
    ok({ cards: ["Only one"] }),
    ok({ none: true }),
    { id: "p", name: "P", goal: "g", state: "stale", solving: { stale: true } },
    { id: "p", name: "P", state: "unavailable" },
  ];

  const words = results.map(statusWords);

  assert.deepEqual(words, [
    "Solving now: Find the pulse; Fix the gate",
    "Solving now: Only one",
    "Nothing is being solved now",
    "Roadmap is stale",
    "This product's roadmap could not be read",
  ]);
});

test("productHref escapes an id holding &, #, a space and / and leaves a plain slug unchanged", () => {
  const unsafe = productHref("a&b#c d/e");
  const plain = productHref("beta");

  assert.equal(unsafe, "workspace.html?product=a%26b%23c%20d%2Fe");
  assert.equal(plain, "workspace.html?product=beta");
});

test("productHref points an escaped id and a plain slug at workspace.html, not index.html", () => {
  const unsafe = productHref("a&b#c d/e");
  const plain = productHref("beta");

  assert.equal(unsafe, "workspace.html?product=a%26b%23c%20d%2Fe");
  assert.equal(plain, "workspace.html?product=beta");
});

test("a product name that is not a non-empty string fails with a named wrong_type error on name for {}, 7 and \"\", and a plain string name passes", () => {
  const withName = (name) => ({ ...registry, products: [{ ...product, name }] });

  assert.deepEqual(validatePortfolio(withName("Plain Name")), { valid: true, errors: [] });
  for (const badName of [{}, 7, ""]) {
    assert.deepEqual(validatePortfolio(withName(badName)).errors, [{ productId: null, reason: "wrong_type", field: "name" }]);
  }
});

test("a product name with no visible character fails with a named wrong_type error on name for spaces, a zero-width space and a mixed run, while an inner-space name and a zero-width space before text pass", () => {
  const withName = (name) => ({ ...registry, products: [{ ...product, name }] });

  for (const invisible of ["   ", "\u200b", "\u202e\u200b "]) {
    assert.deepEqual(validatePortfolio(withName(invisible)).errors, [{ productId: null, reason: "wrong_type", field: "name" }]);
  }
  assert.deepEqual(validatePortfolio(withName("Beta Product")), { valid: true, errors: [] });
  assert.deepEqual(validatePortfolio(withName("\u200bBeta")), { valid: true, errors: [] });
});
