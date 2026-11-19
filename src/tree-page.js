import { createReadAtStatus, fileSource, isValidSnapshot, showSnapshot } from "./load.js";
import { watchRoadmap } from "./live.js";
import { mountMotionToggle } from "./motion.js";
import { resolveProduct } from "./product.js";

const UNAVAILABLE_WORDS = {
  not_in_portfolio: "This product is not in the portfolio",
  registry: "The portfolio list could not be read",
};

const TITLE_SUFFIX = " — ClickChain roadmap";

const UNAVAILABLE_TITLES = {
  not_in_portfolio: "Not in the portfolio",
  registry: "Portfolio could not be read",
};

function showUnavailable(document, container, words) {
  const alert = document.createElement("div");
  alert.setAttribute("role", "alert");
  alert.textContent = words;
  container.appendChild(alert);
  return alert;
}

export function mountUnavailable(document, container, unavailable) {
  document.title = UNAVAILABLE_TITLES[unavailable] + TITLE_SUFFIX;
  const alert = showUnavailable(document, container, UNAVAILABLE_WORDS[unavailable]);
  return { destroy: () => container.removeChild(alert) };
}

export function initPageChrome(document) {
  const readAtSlot = document.getElementById("read-at");
  const status = createReadAtStatus(document);
  readAtSlot.replaceChildren(status.element);
  mountMotionToggle(document, readAtSlot);
  return status;
}

export async function mountTree(container, io, roadmapRoot) {
  const { document, fetch, schedule, now, emit, isHidden, status } = io;
  const snapshotIo = { document, emit, now, showReadAt: (_line, at, entries) => status.showRead(at, entries) };
  const source = fileSource(fetch, roadmapRoot);
  const rendered = await source.read();
  let view = showSnapshot(rendered, snapshotIo);
  container.appendChild(view);
  const watcher = watchRoadmap({
    source,
    baseline: rendered,
    validate: isValidSnapshot,
    schedule,
    isHidden,
    emit,
    onChange: (snapshot) => {
      const next = showSnapshot(snapshot, snapshotIo);
      view.replaceWith(next);
      view = next;
    },
    onFailure: () => status.showFailure(),
    onRecover: (snapshot) => showSnapshot(snapshot, snapshotIo),
  });
  return {
    destroy() {
      watcher.stop();
      container.removeChild(view);
    },
  };
}

export async function startTreePage(document, { fetch, search, schedule, now, emit, isHidden }) {
  const status = initPageChrome(document);
  const { product, roadmapRoot, unavailable } = await resolveProduct({ fetch }, search);
  if (product) document.title = product.name + TITLE_SUFFIX;
  const container = document.getElementById("app");
  if (unavailable) {
    mountUnavailable(document, container, unavailable);
    return;
  }
  await mountTree(container, { document, fetch, schedule, now, emit, isHidden, status }, roadmapRoot);
}
