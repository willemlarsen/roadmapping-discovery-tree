import { pulsingIds } from "./pulse.js";
import { fetchText, fileSource, readRoadmap } from "./load.js";
import { staleness } from "./stale.js";
import { deriveLastRerank } from "./decisions.js";

const REGISTRY_FIELDS = ["version", "products"];
const STATUSES = ["active", "archived"];
const SLUG = "[a-z0-9]+(-[a-z0-9]+)*";
const SAFE_SLUG = new RegExp(`^${SLUG}$`);
const SAFE_ROOT_PATH = new RegExp(`^${SLUG}(/${SLUG})*$`);
const REGISTRY_PATH = "portfolio/portfolio.json";
const PRODUCT_FIELDS = ["id", "name", "status", "roadmapRoot"];

export function validatePortfolio(registry) {
  const errors = isRecord(registry) ? registryErrors(registry) : [wrongType("registry")];
  return { valid: errors.length === 0, errors };
}

function registryErrors(registry) {
  const products = "products" in registry ? registry.products : [];
  if (!Array.isArray(products)) return [wrongType("products")];
  return [
    ...recordErrors(registry, REGISTRY_FIELDS, null),
    ...duplicateIdErrors(products),
    ...products.flatMap((product) =>
      isRecord(product) ? productErrors(product) : [wrongType("product")],
    ),
  ];
}

function duplicateIdErrors(products) {
  const ids = products.filter((product) => isRecord(product) && "id" in product).map((product) => product.id);
  const repeated = new Set(ids.filter((id, index) => ids.indexOf(id) !== index));
  return [...repeated].map((productId) => ({ productId, reason: "duplicate_id", field: "id" }));
}

function productErrors(product) {
  const productId = product.id ?? null;
  const badStatus = "status" in product && !STATUSES.includes(product.status);
  const unsafeId = "id" in product && !(typeof product.id === "string" && SAFE_SLUG.test(product.id));
  const unsafeRoot = "roadmapRoot" in product && !isSafeRoot(product.roadmapRoot);
  return [
    ...recordErrors(product, PRODUCT_FIELDS, productId),
    ...nameErrors(product),
    ...(unsafeId ? [{ productId, reason: "unsafe_id", field: "id" }] : []),
    ...(badStatus ? [{ productId, reason: "invalid_status", field: "status" }] : []),
    ...(unsafeRoot ? [{ productId, reason: "unsafe_root", field: "roadmapRoot" }] : []),
  ];
}

function isSafeRoot(root) {
  return typeof root === "string" && SAFE_ROOT_PATH.test(root);
}

function nameErrors(product) {
  return "name" in product && !isNonEmptyString(product.name) ? [wrongType("name")] : [];
}

const VISIBLE_CHARACTER = /[^\s\p{Cf}]/u;

function isNonEmptyString(value) {
  return typeof value === "string" && VISIBLE_CHARACTER.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wrongType(field) {
  return { productId: null, reason: "wrong_type", field };
}

function recordErrors(record, fields, productId) {
  return [
    ...fields.filter((field) => !(field in record)).map((field) => ({ productId, reason: "missing_field", field })),
    ...(Object.keys(record).some((key) => !fields.includes(key)) ? [{ productId, reason: "unknown_field" }] : []),
  ];
}

export function solvingNow(roadmap, stale) {
  if (stale) return { stale: true };
  const ids = pulsingIds(roadmap, stale);
  const cards = roadmap.problems.filter((entry) => ids.has(entry.id)).map((entry) => entry.problem);
  return cards.length === 0 ? { none: true } : { cards };
}

export function statusWords(result) {
  if (result.state === "unavailable") return "This product's roadmap could not be read";
  if (result.state === "stale") return "Roadmap is stale";
  return result.solving.none ? "Nothing is being solved now" : `Solving now: ${result.solving.cards.join("; ")}`;
}

export async function loadPortfolio(io) {
  const { registry, failure } = await loadRegistry(io);
  if (failure) return [{ failure }];
  const active = registry.products.filter((product) => product.status === "active");
  return Promise.all(active.map((product) => loadOneProduct(io, product)));
}

export async function loadRegistry(io) {
  const text = await fetchText(io.fetch, REGISTRY_PATH);
  const registry = text === null ? null : parseRegistry(text);
  if (registry === null) return { failure: "registry_unavailable" };
  return validatePortfolio(registry).valid ? { registry } : { failure: "registry_invalid" };
}

function parseRegistry(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function loadOneProduct(io, product) {
  const { roadmapText, logText } = await fileSource(io.fetch, product.roadmapRoot).read();
  const loaded = readRoadmap(roadmapText, logText);
  if (loaded.failure) return unavailableProduct(product);
  const { roadmap, entries } = loaded;
  const { stale } = staleness(roadmap, io.now(), deriveLastRerank(entries));
  return { id: product.id, name: product.name, goal: roadmap.goal, state: stale ? "stale" : "ok", solving: solvingNow(roadmap, stale) };
}

function unavailableProduct(product) {
  return { id: product.id, name: product.name, state: "unavailable" };
}

export function productHref(id) {
  return `workspace.html?product=${encodeURIComponent(id)}`;
}
