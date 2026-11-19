import { loadRegistry } from "./portfolio.js";

export async function resolveProduct(io, search) {
  const params = new URLSearchParams(search);
  if (!params.has("product")) return { product: null, roadmapRoot: "roadmap" };
  const id = params.get("product");
  const { registry, failure } = await loadRegistry(io);
  if (failure) return { unavailable: "registry" };
  const found = registry.products.find((product) => product.status === "active" && product.id === id);
  if (!found) return { unavailable: "not_in_portfolio" };
  const { name, roadmapRoot } = found;
  return { product: { id, name }, roadmapRoot };
}
