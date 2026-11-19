import { test } from "node:test";
import assert from "node:assert/strict";
import { markOpen, refreshProductsLive } from "../src/workspace.js";

function fakeLink(id) {
  const attributes = { "data-product-id": id };
  return {
    attributes,
    getAttribute: (name) => attributes[name],
    setAttribute: (name, value) => { attributes[name] = value; },
    removeAttribute: (name) => { delete attributes[name]; },
  };
}

function fakeNav(ids) {
  const nav = { links: ids.map(fakeLink) };
  nav.querySelectorAll = () => nav.links;
  return nav;
}

test("markOpen marks only the open product's link in the nav as it is now, after a redraw too", () => {
  const nav = fakeNav(["alpha", "beta"]);
  markOpen(nav, { id: "beta" });
  const first = nav.links.map((link) => link.attributes["aria-current"]);

  nav.links = fakeNav(["alpha", "beta"]).links;
  markOpen(nav, { id: "beta" });

  assert.deepEqual(first, [undefined, "page"]);
  assert.deepEqual(nav.links.map((link) => link.attributes["aria-current"]), [undefined, "page"]);
});

function fakeSidebar(replies) {
  const element = () => ({ setAttribute() {}, appendChild() {}, set textContent(_) {} });
  const document = { activeElement: null, createElement: () => element() };
  const nav = {
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    appendChild() {},
    replaceChildren() {},
  };
  const fetch = async () => {
    const reply = replies.shift();
    if (reply === "throw") nav.appendChild = () => { throw new Error("redraw failed"); };
    return reply === "good"
      ? { ok: true, text: async () => '{"version":1,"products":[]}' }
      : { ok: false, text: async () => "" };
  };
  return { workspace: { document, nav, product: null }, fetch };
}

test("refreshProductsLive_failuresThenAThrowThenSuccess_backsOffTenTwentyFortyThenReturnsToFiveSeconds", async () => {
  const { workspace, fetch } = fakeSidebar(["bad", "bad", "throw", "good"]);
  const delays = [];
  let tick;
  const io = { fetch, now: () => 0, isHidden: () => false, random: () => 0.5, schedule: (fn, delayMs) => { tick = fn; delays.push(delayMs); } };

  refreshProductsLive(workspace, io);
  for (let i = 0; i < 4; i++) await tick();

  assert.deepEqual(delays, [5000, 10000, 20000, 40000, 5000]);
});
