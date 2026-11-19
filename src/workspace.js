import { computeBackoff } from "./live.js";
import { loadPortfolio } from "./portfolio.js";
import { renderPortfolio } from "./render.js";
import { resolveProduct } from "./product.js";
import { initPageChrome, mountTree, mountUnavailable } from "./tree-page.js";

const TITLE_SUFFIX = " — ClickChain roadmap";

const PRODUCT_ID_ATTRIBUTE = "data-product-id";

export function markOpen(nav, product) {
  nav.querySelectorAll("h2 > a").forEach((link) => {
    if (link.getAttribute(PRODUCT_ID_ATTRIBUTE) === product?.id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function mountResolved(workspace, { roadmapRoot, unavailable }) {
  if (unavailable) return mountUnavailable(workspace.document, workspace.main, unavailable);
  return mountTree(workspace.main, workspace.treeIo, roadmapRoot);
}

async function showProduct(workspace, resolving) {
  const choice = ++workspace.choice;
  workspace.tree?.destroy();
  workspace.tree = null;
  const resolved = await resolving;
  if (choice !== workspace.choice) return false;
  const { product } = resolved;
  const tree = await mountResolved(workspace, resolved);
  if (choice !== workspace.choice) {
    tree.destroy();
    return false;
  }
  workspace.tree = tree;
  workspace.product = product;
  if (product) workspace.document.title = product.name + TITLE_SUFFIX;
  markOpen(workspace.nav, product);
  return true;
}

function closeMenu(nav, button) {
  nav.removeAttribute("data-open");
  button.setAttribute("aria-expanded", "false");
}

function focusHeading(main) {
  const target = main.querySelector("h1") ?? main.querySelector('[role="alert"]');
  target.setAttribute("tabindex", "-1");
  target.focus();
}

async function chooseProduct(workspace, id) {
  const search = `?product=${encodeURIComponent(id)}`;
  if (!(await showProduct(workspace, resolveProduct({ fetch: workspace.treeIo.fetch }, search)))) return;
  workspace.history.pushState(null, "", search);
  if (workspace.nav.hasAttribute("data-open")) {
    closeMenu(workspace.nav, workspace.document.getElementById("products-menu"));
    focusHeading(workspace.main);
  }
}

function showProductOnBack(workspace) {
  const view = workspace.document.defaultView;
  view.addEventListener("popstate", async () => {
    await showProduct(workspace, resolveProduct({ fetch: workspace.treeIo.fetch }, view.location.search));
  });
}

function interceptProductLinks(workspace, results) {
  [...workspace.nav.querySelectorAll("h2 > a")].forEach((link, position) => {
    link.setAttribute(PRODUCT_ID_ATTRIBUTE, results[position].id);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      chooseProduct(workspace, link.getAttribute(PRODUCT_ID_ATTRIBUTE));
    });
  });
}

function searchWithProduct(search, results) {
  if (new URLSearchParams(search).has("product") || !results.length || results[0].failure) return search;
  return `?product=${encodeURIComponent(results[0].id)}`;
}

function labelledAsSidebar(fetch) {
  return (path, options) => fetch(path, { ...options, headers: { "x-read": "sidebar" } });
}

function focusedProductId(workspace) {
  const focused = workspace.document.activeElement;
  return workspace.nav.contains(focused) ? focused.getAttribute("data-product-id") : null;
}

function focusProductLink(nav, productId) {
  [...nav.querySelectorAll("[data-product-id]")].find((link) => link.getAttribute("data-product-id") === productId)?.focus();
}

function drawProducts(workspace, results) {
  const focusedId = focusedProductId(workspace);
  workspace.nav.replaceChildren(renderPortfolio(workspace.document, results));
  interceptProductLinks(workspace, results);
  markOpen(workspace.nav, workspace.product);
  if (focusedId) focusProductLink(workspace.nav, focusedId);
}

function showRefreshFailed(workspace) {
  if (workspace.nav.querySelector("[role='status']")) return;
  const status = workspace.document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Could not refresh the product list";
  workspace.nav.appendChild(status);
}

async function refreshProducts(workspace, io) {
  const results = await loadPortfolio({ fetch: labelledAsSidebar(io.fetch), now: io.now });
  if (results[0]?.failure) {
    showRefreshFailed(workspace);
    return false;
  }
  drawProducts(workspace, results);
  return true;
}

async function refreshSucceeded(workspace, io) {
  if (io.isHidden()) return true;
  try {
    return await refreshProducts(workspace, io);
  } catch {
    return false;
  }
}

export function refreshProductsLive(workspace, io, failures = 0) {
  io.schedule(async () => {
    const good = await refreshSucceeded(workspace, io);
    refreshProductsLive(workspace, io, good ? 0 : failures + 1);
  }, computeBackoff(failures, (io.random ?? Math.random)()));
}

function wireProductsMenu(document, nav) {
  const button = document.getElementById("products-menu");
  button.addEventListener("click", () => {
    if (nav.hasAttribute("data-open")) return closeMenu(nav, button);
    nav.setAttribute("data-open", "");
    button.setAttribute("aria-expanded", "true");
    nav.querySelector("a")?.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !nav.hasAttribute("data-open")) return;
    closeMenu(nav, button);
    button.focus();
  });
}

export async function startWorkspace(document, io) {
  const { fetch, schedule, now, emit, isHidden, history } = io;
  const results = await loadPortfolio({ fetch: labelledAsSidebar(fetch), now });
  const nav = document.getElementById("products");
  const status = initPageChrome(document);
  const workspace = { document, history, nav, product: null, main: document.getElementById("main"), tree: null, choice: 0, treeIo: { document, fetch, schedule, now, emit, isHidden, status } };
  drawProducts(workspace, results);
  refreshProductsLive(workspace, io);
  showProductOnBack(workspace);
  wireProductsMenu(document, nav);
  const search = searchWithProduct(io.search, results);
  if (search !== io.search) history.replaceState(null, "", search);
  await showProduct(workspace, resolveProduct({ fetch }, search));
}
