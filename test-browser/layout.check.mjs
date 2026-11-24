import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { forecastOrder } from "../src/pace/order.js";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SANDBOX_FLAGS = process.env.CI ? ["--no-sandbox"] : [];
const ZOOMED_WIDTH = 900;
const CONTENT_TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".jsonl": "text/plain" };

function serveRepo(overrides = new Map(), delays = new Map()) {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
    try {
      await new Promise((resolve) => setTimeout(resolve, delays.get(path) ?? 0));
      const body = overrides.has(path) ? overrides.get(path) : await readFile(join(ROOT, path));
      if (body === null) throw new Error("override answers 404");
      response.writeHead(200, { "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// The checked-in pace.json is generated from this repo's own git history, which is too short
// for a forecast, and any real forecast goes stale three days after it is generated. Checks that
// need forecast words serve the sample roadmap with a pace file made now, listing its cards.
async function pacedOverrides() {
  const roadmap = JSON.parse(await readFile(join(ROOT, "roadmap/roadmap.json"), "utf8"));
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const results = forecastOrder(roadmap.problems).map(({ id }, index) => ({
    id, remainingCycles: 5, p50Hours: 2 * (index + 1), p85Hours: 3 * (index + 1), p95Hours: 4 * (index + 1), p50Date: day, p85Date: day,
  }));
  const pace = {
    contractVersion: 3, generator: "scripts/pace.mjs", generatedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    inputs: {
      sessionGapMinutes: 60, windowDays: 4, rollingDays: 14, dailyCapHours: 10, simulationSeed: 20261031,
      commits: 40, cycleCommits: 30, cycleIntervals: 25, activeDays: 6, sizeSamples: [],
    },
    status: "ok", pace: { hoursPerDay: 3.5 }, results,
  };
  return new Map([["/roadmap/pace.json", JSON.stringify(pace)]]);
}

const servePaced = async () => serveRepo(await pacedOverrides());

async function launchChrome() {
  const profile = await mkdtemp(join(tmpdir(), "layout-check-"));
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", ...SANDBOX_FLAGS, "about:blank"]);
  const endpoint = await new Promise((resolve, reject) => {
    chrome.stderr.on("data", (chunk) => {
      const match = /DevTools listening on (ws:\S+)/.exec(chunk.toString());
      if (match) resolve(match[1]);
    });
    chrome.on("exit", () => reject(new Error("Chrome exited before DevTools was ready")));
  });
  return { chrome, endpoint };
}

function devtools(endpoint) {
  const socket = new WebSocket(endpoint);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return new Promise((resolve) => socket.addEventListener("open", () => resolve({ send, close: () => socket.close() })));
}

const LEFTMOST_CARD = `new Promise((resolve) => {
  const giveUpAt = Date.now() + 5000;
  const measure = () => {
    const cards = [...document.querySelectorAll('section[aria-label="Roadmap"] li > div')];
    if (cards.length === 0) return Date.now() < giveUpAt ? setTimeout(measure, 50) : resolve("no tree");
    resolve(Math.min(...cards.map((card) => card.getBoundingClientRect().left + window.scrollX)));
  };
  measure();
})`;

const ACTIVE_CARDS = `new Promise((resolve) => {
  const giveUpAt = Date.now() + 5000;
  const measure = () => {
    const cards = [...document.querySelectorAll('section[aria-label="Roadmap"] li > div[data-status="now"], section[aria-label="Roadmap"] li > div[data-status="next"]')];
    if (cards.length === 0) return Date.now() < giveUpAt ? setTimeout(measure, 50) : resolve([]);
    resolve(cards.map((card) => {
      const line = card.querySelector(":scope > p");
      const group = card.querySelector(':scope > div[role="group"]');
      const box = line?.getBoundingClientRect();
      return {
        hasLine: line !== null,
        visible: Boolean(box) && box.width > 0 && box.height > 0 && getComputedStyle(line).display !== "none",
        followsGroup: group !== null && line?.previousElementSibling === group,
      };
    }));
  };
  measure();
})`;

async function withPage(url, use, { media, width, height = 800 } = {}) {
  const { chrome, endpoint } = await launchChrome();
  const browser = await devtools(endpoint);
  try {
    const { result: { targetId } } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { result: { sessionId } } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => browser.send(method, params, sessionId);
    if (width) await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    if (media) await send("Emulation.setEmulatedMedia", { features: [media] });
    await send("Page.navigate", { url });
    return await use(send);
  } finally {
    browser.close();
    chrome.kill();
  }
}

const evaluate = (expression) => (send) => send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).then(({ result }) => result.result.value);

const inPage = (expression, url) => withPage(url, evaluate(expression));

const leftmostCardAt = (width, url) => withPage(url, evaluate(LEFTMOST_CARD), { width });

test("a tree wider than the window keeps its leftmost card on the page", async () => {
  const server = await serveRepo();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const left = await leftmostCardAt(ZOOMED_WIDTH, url).finally(() => server.close());

  assert.ok(left >= 0, `the leftmost card's left edge is ${left}, off the page`);
});

test("every now/next card's rank or part line is visible and directly follows its forecast group", async () => {
  const server = await serveRepo();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const cards = await inPage(ACTIVE_CARDS, url).finally(() => server.close());

  assert.ok(cards.length > 0, "no now/next card on the page");
  assert.deepEqual(cards.filter((card) => !card.hasLine || !card.visible || !card.followsGroup), []);
});

const OPEN_FEATURE_CARD = `new Promise((resolve) => {
  const giveUpAt = Date.now() + 5000;
  const measure = () => {
    const cards = [...document.querySelectorAll('section[aria-label="Roadmap"] li > div')];
    const card = cards.find((candidate) => ["now", "next"].includes(candidate.getAttribute("data-status")) && candidate.parentElement.querySelector(":scope > ul"));
    if (!card) return Date.now() < giveUpAt ? setTimeout(measure, 50) : resolve(null);
    const lines = [...card.querySelectorAll(":scope > p, :scope > div[role=group] > span")].filter((line) => line.getBoundingClientRect().height > 0).map((line) => line.textContent);
    resolve({ status: card.getAttribute("data-status"), lines });
  };
  measure();
})`;

test("an open rolled-up feature card, whichever it is, shows its total hours left, no Sequence line, and its rank line, Priority or Unranked, after", async () => {
  const server = await servePaced();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const card = await inPage(OPEN_FEATURE_CARD, url).finally(() => server.close());

  assert.ok(card, "no open rolled-up feature card found");
  assert.ok(["now", "next"].includes(card.status), `the probed card is ${card.status}, not open`);
  const doneAt = card.lines.findIndex((line) => line.includes("left in total"));
  const rankAt = card.lines.findIndex((line) => line.startsWith("Priority") || line.startsWith("Unranked"));
  assert.ok(doneAt >= 0, `no visible "left in total" line in ${JSON.stringify(card.lines)}`);
  assert.equal(card.lines.some((line) => line.includes("Sequence")), false, "a rolled-up feature must not show a Sequence line");
  assert.ok(rankAt > doneAt, `the rank line does not follow it in ${JSON.stringify(card.lines)}`);
});

// The sample roadmap's started feature: one of its two parts is solved, so it shows paused.
const STARTED_CARD = "Welcome new members to the garden";

const CARD_WORDS = `new Promise((resolve) => {
  const giveUpAt = Date.now() + 5000;
  const measure = () => {
    const cards = [...document.querySelectorAll('section[aria-label="Roadmap"] li > div')];
    if (cards.length === 0) return Date.now() < giveUpAt ? setTimeout(measure, 50) : resolve(null);
    const started = cards.find((card) => card.textContent.includes(${JSON.stringify(STARTED_CARD)}));
    resolve({
      startedStatus: started?.getAttribute("data-status") ?? null,
      startedHasLabel: started ? started.firstElementChild.firstChild.textContent === "Paused" && started.firstElementChild.textContent.includes(", 1 of 2 parts solved") && started.firstElementChild.querySelector("[data-visually-hidden]").getBoundingClientRect().width <= 1 && getComputedStyle(started.firstElementChild.querySelector("[data-visually-hidden]")).overflow === "hidden" : false,
      forecasts: cards.filter((card) => ["now", "next"].includes(card.getAttribute("data-status"))).map((card) => card.textContent.includes("working hour")),
      dated: cards.filter((card) => /\\d{4}-\\d{2}-\\d{2}/.test(card.textContent.replace(/Solved[^.]*/g, ""))).map((card) => card.textContent.slice(0, 60)),
    });
  };
  measure();
})`;

test("a started feature card shows paused, its label reads Paused with the part count as hidden text, and cards show working hours and no dates", async () => {
  const server = await servePaced();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const words = await inPage(CARD_WORDS, url).finally(() => server.close());

  assert.ok(words, "no card on the page");
  assert.equal(words.startedStatus, "paused");
  assert.ok(words.startedHasLabel, "the started card does not read Paused with its part count hidden");
  assert.deepEqual(words.forecasts.filter((hasHours) => !hasHours), []);
  assert.deepEqual(words.dated, []);
});

const BORDER_STYLES = `new Promise((resolve) => {
  const giveUpAt = Date.now() + 5000;
  const measure = () => {
    const cards = [...document.querySelectorAll('section[aria-label="Roadmap"] li > div')];
    if (cards.length === 0) return Date.now() < giveUpAt ? setTimeout(measure, 50) : resolve(null);
    const styleOf = (card) => (card ? getComputedStyle(card).borderTopStyle : null);
    resolve({
      started: styleOf(cards.find((card) => card.textContent.includes(${JSON.stringify(STARTED_CARD)}))),
      plain: styleOf(cards.find((card) => card.getAttribute("data-status") === "next")),
    });
  };
  measure();
})`;

test("a started feature card draws the paused dotted border and a plain next card a dashed one, as computed in the browser", async () => {
  const server = await servePaced();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const styles = await inPage(BORDER_STYLES, url).finally(() => server.close());

  assert.deepEqual(styles, { started: "dotted", plain: "dashed" });
});

const STARTED_LABEL = `new Promise((resolve) => {
  const giveUpAt = Date.now() + 5000;
  const find = () => {
    const cards = [...document.querySelectorAll('section[aria-label="Roadmap"] li > div')];
    const started = cards.find((card) => card.textContent.includes(${JSON.stringify(STARTED_CARD)}));
    if (!started) return Date.now() < giveUpAt ? setTimeout(find, 50) : resolve(null);
    resolve(started.firstElementChild);
  };
  find();
})`;

const chromeLabelText = (url) => withPage(url, async (send) => {
  const enabled = await send("Accessibility.enable");
  assert.equal(enabled.error, undefined, `Chrome's Accessibility domain is unavailable: ${JSON.stringify(enabled.error)}`);
  const label = (await send("Runtime.evaluate", { expression: STARTED_LABEL, awaitPromise: true })).result.result;
  assert.ok(label.objectId, "the started card's label is not on the page");
  const { result: { node } } = await send("DOM.describeNode", { objectId: label.objectId });
  const tree = await send("Accessibility.getFullAXTree");
  assert.ok(Array.isArray(tree.result?.nodes), `Chrome returned no accessibility tree: ${JSON.stringify(tree.error ?? tree)}`);
  const byId = new Map(tree.result.nodes.map((axNode) => [axNode.nodeId, axNode]));
  const labelNode = tree.result.nodes.find((axNode) => axNode.backendDOMNodeId === node.backendNodeId);
  assert.ok(labelNode, "the label is missing from Chrome's accessibility tree");
  const spoken = (axNode) => (axNode.role?.value === "StaticText" ? [axNode.name.value] : (axNode.childIds ?? []).flatMap((id) => spoken(byId.get(id))));
  return spoken(labelNode);
});

test("a started label's hidden part count reaches Chrome's accessibility tree as written, not upper-cased", async () => {
  const server = await servePaced();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const exposed = await chromeLabelText(url).finally(() => server.close());

  assert.deepEqual(exposed, ["PAUSED", ", 1 of 2 parts solved"]);
});

test("serveRepo serves an override body for its path instead of the repo file", async () => {
  const server = await serveRepo(new Map([["/strip/index.html", "overridden"]]));
  const base = `http://127.0.0.1:${server.address().port}`;

  const [overridden, plain] = await Promise.all([fetch(`${base}/strip/index.html`), fetch(`${base}/package.json`)]).finally(() => server.close());

  assert.equal(await overridden.text(), "overridden");
  assert.equal(plain.status, 200);
});

function fixtureRoadmap(today) {
  const card = (id, parent, status, order, extra = {}) => ({
    id, parent, problem: `Fixture ${id}`, status, statusSince: today, order, slices: ["fixture"],
    waitingOn: null, resumesAfter: null, doneOn: null, confirmedBy: null, ...extra,
  });
  return {
    version: 1, goal: "Fixture goal", wipLimit: 1, staleAfterDays: 3,
    problems: [
      card("fx-1", null, "now", 1),
      card("fx-1a", "fx-1", "now", 1, { value: 3, size: 2 }),
      card("fx-2", null, "next", 2, { value: 3, size: 2 }),
    ],
  };
}

function fixtureLog(roadmap, today) {
  const line = (minute, problem, action, after) => JSON.stringify({
    at: `${today}T00:${String(minute).padStart(2, "0")}:00Z`, problemId: problem.id, actor: "Amal", action, before: null, after, why: "Fixture",
  });
  const lines = roadmap.problems.flatMap((problem) => [
    ["coach-add", problem.status],
    ...(problem.value ? [["coach-estimate", { value: problem.value, size: problem.size }]] : []),
  ].map(([action, after]) => ({ problem, action, after })));
  lines.push({ problem: roadmap.problems[0], action: "coach-rerank", after: 1 });
  return lines.map(({ problem, action, after }, index) => line(index, problem, action, after)).join("\n") + "\n";
}

async function fixtureOverrides() {
  const today = new Date().toISOString().slice(0, 10);
  const roadmap = fixtureRoadmap(today);
  const emptyPace = JSON.parse(await readFile(join(ROOT, "roadmap/pace.json"), "utf8"));
  const overrides = new Map([
    ["/roadmap/roadmap.json", JSON.stringify(roadmap)],
    ["/roadmap/decisions.jsonl", fixtureLog(roadmap, today)],
    ["/roadmap/pace.json", JSON.stringify({ ...emptyPace, results: [] })],
  ]);
  return overrides;
}

async function serveFixture() {
  return serveRepo(await fixtureOverrides());
}

const pollUntilFound = (find, report) => `new Promise((resolve) => {
  const giveUpAt = Date.now() + 5000;
  const measure = () => {
    const found = ${find};
    if (found.length === 0) return Date.now() < giveUpAt ? setTimeout(measure, 50) : resolve(null);
    resolve((${report})(found));
  };
  measure();
})`;

const ROADMAP_CARDS = `[...document.querySelectorAll('section[aria-label="Roadmap"] li > div')]`;

const PULSE_NAMES = pollUntilFound(ROADMAP_CARDS, `(cards) => {
  const names = {};
  for (const card of cards) names[card.textContent.slice(0, 40)] = [card.getAttribute("data-status"), getComputedStyle(card).animationName];
  return { names, text: document.body.textContent.slice(0, 200) };
}`);

test("the innermost now card pulses while its now parent and a next card do not", async () => {
  const server = await serveFixture();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const seen = await inPage(PULSE_NAMES, url).finally(() => server.close());

  assert.ok(seen, `no cards on the page`);
  const nameOf = (text) => Object.entries(seen.names).find(([label]) => label.includes(text))?.[1];
  assert.deepEqual(nameOf("Fixture fx-1a"), ["now", "pulse-ring, border-spin, twinkle"]);
  assert.deepEqual(nameOf("Fixture fx-1Forecast"), ["now", "none"]);
  assert.deepEqual(nameOf("Fixture fx-2"), ["next", "none"]);
});

const SPIN_LIGHT = pollUntilFound(ROADMAP_CARDS, `(cards) => {
  const spin = {};
  for (const card of cards) {
    const style = getComputedStyle(card);
    spin[card.textContent.slice(0, 40)] = { names: style.animationName, conic: style.backgroundImage.includes("conic-gradient") };
  }
  return spin;
}`);

test("the innermost now card runs border-spin and paints a conic gradient while its now parent and a next card do not", async () => {
  const server = await serveFixture();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const seen = await inPage(SPIN_LIGHT, url).finally(() => server.close());

  assert.ok(seen, "no cards on the page");
  const lightOf = (text) => Object.entries(seen).find(([label]) => label.includes(text))?.[1];
  assert.deepEqual(lightOf("Fixture fx-1a"), { names: "pulse-ring, border-spin, twinkle", conic: true });
  assert.deepEqual(lightOf("Fixture fx-1Forecast"), { names: "none", conic: false });
  assert.deepEqual(lightOf("Fixture fx-2"), { names: "none", conic: false });
});

test("the innermost now card twinkles while its now parent and a next card do not", async () => {
  const server = await serveFixture();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const seen = await inPage(SPIN_LIGHT, url).finally(() => server.close());

  assert.ok(seen, "no cards on the page");
  const twinkles = (text) => Object.entries(seen).find(([label]) => label.includes(text))?.[1].names.split(", ").includes("twinkle");
  assert.equal(twinkles("Fixture fx-1a"), true);
  assert.equal(twinkles("Fixture fx-1Forecast"), false);
  assert.equal(twinkles("Fixture fx-2"), false);
});

const SPIN_ANGLES = pollUntilFound(`[...document.querySelectorAll("section[aria-label='Roadmap'] li > div[data-pulse]")]`, `async ([pulsing]) => {
  const angle = () => parseFloat(getComputedStyle(pulsing).getPropertyValue("--spin-angle"));
  await new Promise((later) => setTimeout(later, 100));
  const first = angle();
  await new Promise((later) => setTimeout(later, 500));
  return [first, angle()];
}`);

test("the innermost now card's light glides: --spin-angle is between 0deg and 360deg at two moments in one lap and differs", async () => {
  const server = await serveFixture();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const seen = await inPage(SPIN_ANGLES, url).finally(() => server.close());

  assert.ok(seen, "no pulsing card on the page");
  const [first, second] = seen;
  assert.ok(first > 0 && first < 360, `first angle ${first}`);
  assert.ok(second > 0 && second < 360, `second angle ${second}`);
  assert.notEqual(first, second);
});

const GLINT_LEVELS = pollUntilFound(`[...document.querySelectorAll("section[aria-label='Roadmap'] li > div[data-pulse]")]`, `async ([pulsing]) => {
  const levels = [];
  for (let sample = 0; sample < 6; sample++) {
    await new Promise((later) => setTimeout(later, 100));
    levels.push(parseFloat(getComputedStyle(pulsing).getPropertyValue("--glint")));
  }
  return levels;
}`);

test("the innermost now card's twinkle fades: --glint takes a value strictly between 0 and 1 during one twinkle", async () => {
  const server = await serveFixture();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const seen = await inPage(GLINT_LEVELS, url).finally(() => server.close());

  assert.ok(seen, "no pulsing card on the page");
  assert.ok(seen.some((level) => level > 0 && level < 1), `glint levels ${seen}`);
});

const RING_UNDER_MOTION_PREFERENCE = pollUntilFound(`[...document.querySelectorAll("section[aria-label='Roadmap'] li > div[data-pulse]")]`, `([pulsing]) => {
  const parent = pulsing.parentElement.closest("li").parentElement.closest("li").querySelector(":scope > div");
  return { animation: getComputedStyle(pulsing).animationName, ring: getComputedStyle(pulsing).boxShadow, parentRing: getComputedStyle(parent).boxShadow };
}`);

test("under reduced motion the innermost now card does not animate and keeps its static ring", async () => {
  const server = await serveFixture();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const seen = await withPage(url, evaluate(RING_UNDER_MOTION_PREFERENCE), { media: { name: "prefers-reduced-motion", value: "reduce" } }).finally(() => server.close());

  assert.ok(seen, "no card carries data-pulse");
  assert.equal(seen.animation, "none");
  assert.notEqual(seen.ring, "none");
  assert.equal(seen.ring, seen.parentRing);
});

const PAUSE_BUTTON_READY = pollUntilFound(`[...document.querySelectorAll("button")].filter((candidate) => candidate.textContent === "Pause motion")`, `() => true`);

const FOCUSED_IS_PAUSE_BUTTON = `document.activeElement?.textContent === "Pause motion"`;

const PULSING_CARD_STYLE = `(() => {
  const pulsing = document.querySelector("section[aria-label='Roadmap'] li > div[data-pulse]");
  const parent = pulsing.parentElement.closest("li").parentElement.closest("li").querySelector(":scope > div");
  return { animation: getComputedStyle(pulsing).animationName, ring: getComputedStyle(pulsing).boxShadow, parentRing: getComputedStyle(parent).boxShadow };
})()`;

async function press(send, key) {
  for (const type of ["keyDown", "keyUp"]) {
    await send("Input.dispatchKeyEvent", { type, ...key });
  }
}

const TAB = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 };
const SPACE = { key: " ", code: "Space", text: " ", windowsVirtualKeyCode: 32 };

async function pauseButtonInChromeTree(send) {
  const tree = await send("Accessibility.getFullAXTree");
  const node = tree.result.nodes.find((axNode) => axNode.role?.value === "button" && axNode.name?.value === "Pause motion");
  if (!node) return null;
  const pressed = node.properties?.find((property) => property.name === "pressed");
  return { name: node.name.value, pressed: pressed?.value.value };
}

test("the Pause motion button is pressed by keyboard, Chrome reports its name and pressed state, and the pulse stops with the ring kept", async () => {
  const server = await serveFixture();
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;

  const seen = await withPage(url, async (send) => {
    await send("Accessibility.enable");
    const ready = await evaluate(PAUSE_BUTTON_READY)(send) === true;
    for (let tabs = 0; ready && tabs < 10 && !(await evaluate(FOCUSED_IS_PAUSE_BUTTON)(send)); tabs++) await press(send, TAB);
    const focused = await evaluate(FOCUSED_IS_PAUSE_BUTTON)(send);
    const before = await pauseButtonInChromeTree(send);
    await press(send, SPACE);
    const after = await pauseButtonInChromeTree(send);
    const card = await evaluate(PULSING_CARD_STYLE)(send);
    return { ready, focused, before, after, card };
  }).finally(() => server.close());

  assert.ok(seen.ready, "no Pause motion button on the page");
  assert.ok(seen.focused, "Tab did not reach the Pause motion button");
  assert.deepEqual(seen.before, { name: "Pause motion", pressed: "false" });
  assert.deepEqual(seen.after, { name: "Pause motion", pressed: "true" });
  assert.equal(seen.card.animation, "none");
  assert.notEqual(seen.card.ring, "none");
  assert.equal(seen.card.ring, seen.card.parentRing);
});

const RENAMED_TITLE = "Fixture fx-2 renamed";

async function withLiveFixture(use, tweak = () => {}, ready = ROADMAP_CARDS) {
  const overrides = await fixtureOverrides();
  tweak(overrides);
  const server = await serveRepo(overrides);
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html`;
  return withPage(url, async (send) => {
    await evaluate(pollUntilFound(ready, "() => true"))(send);
    return use({ send, overrides });
  }).finally(() => server.close());
}

function retitledRoadmapText(overrides, title) {
  const retitled = JSON.parse(overrides.get("/roadmap/roadmap.json"));
  retitled.problems.find((problem) => problem.id === "fx-2").problem = title;
  return JSON.stringify(retitled);
}

function renamedRoadmapText(overrides) {
  return retitledRoadmapText(overrides, RENAMED_TITLE);
}

const WAIT_FOR_NEW_TITLE = `new Promise((resolve) => {
  const giveUpAt = Date.now() + 10000;
  const look = () => {
    const found = document.body.textContent.includes("${RENAMED_TITLE}");
    if (!found && Date.now() < giveUpAt) return setTimeout(look, 250);
    resolve({ found, views: document.querySelectorAll('section[aria-label="Roadmap"]').length });
  };
  look();
})`;

test("a changed card title in the served roadmap appears on the live page within 10 s, in one roadmap view, without navigation", async () => {
  const seen = await withLiveFixture(async ({ send, overrides }) => {
    overrides.set("/roadmap/roadmap.json", renamedRoadmapText(overrides));
    return evaluate(WAIT_FOR_NEW_TITLE)(send);
  });

  assert.equal(seen.found, true, "the page never showed the renamed card");
  assert.equal(seen.views, 1, "the page holds more than one roadmap view");
});

test("a roadmap change made 1 s after load appears on the live page within 10 s", async () => {
  const seen = await withLiveFixture(async ({ send, overrides }) => {
    await evaluate(`new Promise((later) => setTimeout(later, 1000))`)(send);
    overrides.set("/roadmap/roadmap.json", renamedRoadmapText(overrides));
    return evaluate(WAIT_FOR_NEW_TITLE)(send);
  });

  assert.equal(seen.found, true, "the page never showed the renamed card after a change 1 s after load");
});

const WAIT_FOR_PACE_WORDS = `new Promise((resolve) => {
  const giveUpAt = Date.now() + 10000;
  const look = () => {
    const found = document.body.textContent.includes("Forecast unavailable: the pace file could not be loaded.");
    if (!found && Date.now() < giveUpAt) return setTimeout(look, 250);
    resolve(found);
  };
  look();
})`;

test("a pace-less live page shows the forecast-unavailable words and a changed roadmap title without a refresh", async () => {
  const seen = await withLiveFixture(async ({ send, overrides }) => {
    const paceWords = await evaluate(WAIT_FOR_PACE_WORDS)(send);
    const titleBefore = await evaluate(`document.body.textContent.includes("${RENAMED_TITLE}")`)(send);
    overrides.set("/roadmap/roadmap.json", renamedRoadmapText(overrides));
    const after = await evaluate(WAIT_FOR_NEW_TITLE)(send);
    return { paceWords, titleBefore, after };
  }, (overrides) => overrides.set("/roadmap/pace.json", null));

  assert.equal(seen.paceWords, true, "the page never said the pace file could not be loaded");
  assert.equal(seen.titleBefore, false, "the renamed title was on the page before the change");
  assert.equal(seen.after.found, true, "the pace-less page never showed the renamed card");
  assert.equal(seen.after.views, 1, "the pace-less page holds more than one roadmap view");
});

const STATUS_TEXT = `document.querySelector('#read-at [role="status"]').textContent`;

const waitForStatus = (prefix, timeoutMs) => `new Promise((resolve) => {
  const giveUpAt = Date.now() + ${timeoutMs};
  const look = () => {
    const text = ${STATUS_TEXT};
    if (!text.startsWith(${JSON.stringify(prefix)}) && Date.now() < giveUpAt) return setTimeout(look, 250);
    resolve(text);
  };
  look();
})`;

async function breakThenRestoreRoadmap(send, overrides) {
  const goodText = overrides.get("/roadmap/roadmap.json");
  overrides.set("/roadmap/roadmap.json", "{ not json");
  const failed = await evaluate(waitForStatus("Could not refresh", 10000))(send);
  overrides.set("/roadmap/roadmap.json", goodText);
  const recovered = await evaluate(waitForStatus("Roadmap read at", 20000))(send);
  return { failed, recovered };
}

test("a broken then restored served roadmap moves the live status line from Could not refresh back to Roadmap read at, keeping the same roadmap view", async () => {
  const seen = await withLiveFixture(async ({ send, overrides }) => {
    await evaluate(`window.viewBefore = document.querySelector('section[aria-label="Roadmap"]')`)(send);
    const initial = await evaluate(STATUS_TEXT)(send);
    const { failed, recovered } = await breakThenRestoreRoadmap(send, overrides);
    const sameView = await evaluate(`window.viewBefore === document.querySelector('section[aria-label="Roadmap"]')`)(send);
    return { initial, failed, recovered, sameView };
  });

  const timeOf = (text) => /read at ([^·]+?)(?: ·|$)/.exec(text)?.[1];
  assert.match(seen.failed, /^Could not refresh; showing the roadmap read at /);
  assert.equal(timeOf(seen.failed), timeOf(seen.initial));
  assert.match(seen.recovered, /^Roadmap read at /);
  assert.notEqual(timeOf(seen.recovered), timeOf(seen.initial), "the recovered line still shows the first read time");
  assert.equal(seen.sameView, true, "a recovery with no change replaced the roadmap view");
});

test("a failed then recovered live status line keeps the same Last re-ranked words it showed before the failure", async () => {
  const seen = await withLiveFixture(async ({ send, overrides }) => {
    const before = await evaluate(STATUS_TEXT)(send);
    const { recovered: after } = await breakThenRestoreRoadmap(send, overrides);
    return { before, after };
  });

  const rerankOf = (text) => /Last re-ranked[^·]*/.exec(text)?.[0];
  assert.match(rerankOf(seen.before) ?? "", /^Last re-ranked by Amal on /, "the fixture log gave no re-rank words");
  assert.equal(rerankOf(seen.after), rerankOf(seen.before));
});

async function liveStatusInChromeTree(send) {
  const tree = await send("Accessibility.getFullAXTree");
  const node = tree.result.nodes.find((axNode) => axNode.role?.value === "status");
  if (!node) return null;
  const read = (name) => node.properties?.find((property) => property.name === name)?.value.value;
  return { live: read("live"), relevant: read("relevant"), atomic: read("atomic") };
}

test("the live status element is a polite live region in Chrome's accessibility tree", async () => {
  const seen = await withLiveFixture(async ({ send }) => {
    await send("Accessibility.enable");
    return liveStatusInChromeTree(send);
  });

  assert.ok(seen, "Chrome's accessibility tree has no status node");
  assert.equal(seen.live, "polite");
});

const SCROLL_TO_DISTINCT_POSITION = `(() => {
  window.viewBefore = document.querySelector('section[aria-label="Roadmap"]');
  window.scrollTo(0, 37);
  return window.scrollY;
})()`;

const ROADMAP_FETCHES = `performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith("/roadmap/roadmap.json")).length`;

const WAIT_FOR_TWO_POLLS = `new Promise((resolve) => {
  const startedAt = Date.now();
  const fetchesAtStart = ${ROADMAP_FETCHES};
  const look = () => {
    const polls = ${ROADMAP_FETCHES} - fetchesAtStart;
    if (polls < 2 || Date.now() - startedAt < 10500) return setTimeout(look, 250);
    resolve({ polls, waitedMs: Date.now() - startedAt });
  };
  look();
})`;

test("unchanged served files over two polls keep the same roadmap view element and the same window scroll position", async () => {
  const seen = await withLiveFixture(async ({ send }) => {
    const scrolledTo = await evaluate(SCROLL_TO_DISTINCT_POSITION)(send);
    const waited = await evaluate(WAIT_FOR_TWO_POLLS)(send);
    const sameView = await evaluate(`window.viewBefore === document.querySelector('section[aria-label="Roadmap"]')`)(send);
    const scrollAfter = await evaluate(`window.scrollY`)(send);
    return { scrolledTo, waited, sameView, scrollAfter };
  });

  assert.equal(seen.scrolledTo, 37, "the page could not be scrolled, so the scroll check would prove nothing");
  assert.ok(seen.waited.polls >= 2, "fewer than two polls happened");
  assert.equal(seen.sameView, true, "an unchanged poll replaced the roadmap view");
  assert.equal(seen.scrollAfter, 37);
});

const FOCUS_PAUSE_BUTTON_AND_SCROLL = `(() => {
  [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "Pause motion").focus();
  window.scrollTo(0, 37);
  return { focused: ${FOCUSED_IS_PAUSE_BUTTON}, scrollY: window.scrollY };
})()`;

test("a changed served roadmap replaces the view while the Pause motion button keeps focus and the window scroll stays within 1px", async () => {
  const seen = await withLiveFixture(async ({ send, overrides }) => {
    const before = await evaluate(FOCUS_PAUSE_BUTTON_AND_SCROLL)(send);
    overrides.set("/roadmap/roadmap.json", renamedRoadmapText(overrides));
    const waited = await evaluate(WAIT_FOR_NEW_TITLE)(send);
    const after = await evaluate(`({ focused: ${FOCUSED_IS_PAUSE_BUTTON}, scrollY: window.scrollY })`)(send);
    return { before, waited, after };
  });

  assert.equal(seen.before.focused, true, "the Pause motion button could not take focus");
  assert.ok(seen.before.scrollY > 0, "the page could not be scrolled, so the scroll check would prove nothing");
  assert.equal(seen.waited.found, true, "the new title never appeared");
  assert.equal(seen.after.focused, true, "focus left the Pause motion button when the view was replaced");
  assert.ok(Math.abs(seen.after.scrollY - seen.before.scrollY) <= 1, `scroll moved from ${seen.before.scrollY} to ${seen.after.scrollY}`);
});

const MOTION_STATE_IN_PAGE = `(() => {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "Pause motion");
  const pulsing = document.querySelector("section[aria-label='Roadmap'] li > div[data-pulse]");
  return { pressed: button.getAttribute("aria-pressed"), motion: document.documentElement.getAttribute("data-motion"), animation: getComputedStyle(pulsing).animationName };
})()`;

test("after Pause motion a changed served roadmap keeps the new view's now card still, the button pressed and the root data-motion off", async () => {
  const seen = await withLiveFixture(async ({ send, overrides }) => {
    await evaluate(`[...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "Pause motion").focus()`)(send);
    await press(send, SPACE);
    const paused = await evaluate(MOTION_STATE_IN_PAGE)(send);
    overrides.set("/roadmap/roadmap.json", renamedRoadmapText(overrides));
    const waited = await evaluate(WAIT_FOR_NEW_TITLE)(send);
    const after = await evaluate(MOTION_STATE_IN_PAGE)(send);
    return { paused, waited, after };
  });

  assert.deepEqual(seen.paused, { pressed: "true", motion: "off", animation: "none" }, "Pause motion did not pause before the change");
  assert.equal(seen.waited.found, true, "the new title never appeared");
  assert.equal(seen.after.animation, "none", "the new view's now card animates again");
  assert.equal(seen.after.pressed, "true");
  assert.equal(seen.after.motion, "off");
});

const MARKUP_LIKE_TITLE = '<img src=x data-probe="1"><b>bold</b>';

const MARKUP_LIKE_TITLE_IN_PAGE = (title) => `(() => {
  const card = [...document.querySelectorAll("section[aria-label='Roadmap'] li > div")].find((candidate) => candidate.textContent.includes(${JSON.stringify(title)}));
  if (!card) return null;
  return {
    titleText: [...card.querySelectorAll(":scope > span")].map((span) => span.textContent).find((text) => text === ${JSON.stringify(title)}) ?? null,
    probes: document.querySelectorAll("[data-probe]").length,
    bolds: card.querySelectorAll("b").length,
  };
})()`;

const WAIT_FOR_MARKUP_LIKE_TITLE = (title) => `new Promise((resolve) => {
  const giveUpAt = Date.now() + 10000;
  const look = () => {
    const found = document.body.textContent.includes(${JSON.stringify(title)});
    if (!found && Date.now() < giveUpAt) return setTimeout(look, 250);
    resolve(found);
  };
  look();
})`;

test("a card title holding markup-like text renders as plain text on first load and after a live roadmap change, with no element made from it", async () => {
  const changedTitle = `${MARKUP_LIKE_TITLE} renamed`;
  const seen = await withLiveFixture(async ({ send, overrides }) => {
    const first = await evaluate(MARKUP_LIKE_TITLE_IN_PAGE(MARKUP_LIKE_TITLE))(send);
    overrides.set("/roadmap/roadmap.json", retitledRoadmapText(overrides, changedTitle));
    const waited = await evaluate(WAIT_FOR_MARKUP_LIKE_TITLE(changedTitle))(send);
    const live = await evaluate(MARKUP_LIKE_TITLE_IN_PAGE(changedTitle))(send);
    return { first, waited, live };
  }, (overrides) => overrides.set("/roadmap/roadmap.json", retitledRoadmapText(overrides, MARKUP_LIKE_TITLE)));

  assert.equal(seen.first.titleText, MARKUP_LIKE_TITLE, "first load: the title text is not exactly the string");
  assert.equal(seen.first.probes, 0, "first load: an element with data-probe was made from the title");
  assert.equal(seen.first.bolds, 0, "first load: a b element was made inside the card");
  assert.equal(seen.waited, true, "the live title never appeared");
  assert.equal(seen.live.titleText, changedTitle, "after a live change: the title text is not exactly the string");
  assert.equal(seen.live.probes, 0, "after a live change: an element with data-probe was made from the title");
  assert.equal(seen.live.bolds, 0, "after a live change: a b element was made inside the card");
});

const FAILURE_BANNER = `[...document.querySelectorAll('[role="alert"]')]`;

const waitForRoadmapView = (timeoutMs) => `new Promise((resolve) => {
  const giveUpAt = Date.now() + ${timeoutMs};
  const look = () => {
    const cards = document.querySelectorAll('section[aria-label="Roadmap"] li > div').length;
    if (cards === 0 && Date.now() < giveUpAt) return setTimeout(look, 250);
    resolve({ cards, views: document.querySelectorAll('section[aria-label="Roadmap"]').length, status: ${STATUS_TEXT} });
  };
  look();
})`;

test("a page whose first load failed shows one roadmap view and Roadmap read at with the Last re-ranked words once the served roadmap is good, without a reload", async () => {
  let goodText;
  const seen = await withLiveFixture(async ({ send, overrides }) => {
    await evaluate(waitForStatus("Could not refresh", 10000))(send);
    overrides.set("/roadmap/roadmap.json", goodText);
    return evaluate(waitForRoadmapView(20000))(send);
  }, (overrides) => {
    goodText = overrides.get("/roadmap/roadmap.json");
    overrides.set("/roadmap/roadmap.json", "{ not json");
  }, FAILURE_BANNER);

  assert.ok(seen.cards > 0, "the page never showed the roadmap cards after the served roadmap became good");
  assert.equal(seen.views, 1, "the page does not hold exactly one roadmap view");
  assert.match(seen.status, /^Roadmap read at /);
  assert.match(seen.status, /Last re-ranked by Amal on /);
});

async function portfolioOverrides() {
  const today = new Date().toISOString().slice(0, 10);
  const product = (id, name, status) => ({ id, name, status, roadmapRoot: `products/${id}/roadmap` });
  const registry = { version: 1, products: [product("alpha", "Alpha Product", "active"), product("beta", "Beta Product", "active"), product("old", "Retired Product", "archived")] };
  const overrides = new Map([["/portfolio/portfolio.json", JSON.stringify(registry)]]);
  for (const { id, goal } of [{ id: "alpha", goal: "Alpha goal" }, { id: "beta", goal: "Beta goal" }]) {
    const roadmap = fixtureRoadmap(today);
    roadmap.goal = goal;
    roadmap.problems.forEach((problem) => { problem.problem = `${id} ${problem.id}`; });
    overrides.set(`/products/${id}/roadmap/roadmap.json`, JSON.stringify(roadmap));
    overrides.set(`/products/${id}/roadmap/decisions.jsonl`, fixtureLog(roadmap, today));
    overrides.set(`/products/${id}/roadmap/pace.json`, "{}");
  }
  return overrides;
}

const PORTFOLIO_ITEMS = pollUntilFound(`[...document.querySelectorAll("ul > li")]`, `(items) => ({
  title: document.title,
  items: items.map((item) => [...item.children].map((child) => child.tagName + " " + child.textContent)),
})`);

test("the portfolio page lists both fixture products with their names and Solving now lines", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = `http://127.0.0.1:${server.address().port}/strip/portfolio.html`;

  const page = await inPage(PORTFOLIO_ITEMS, url).finally(() => server.close());

  assert.deepEqual(page, {
    title: "Portfolio",
    items: [
      ["H2 Alpha Product", "P Alpha goal", "P Solving now: alpha fx-1a"],
      ["H2 Beta Product", "P Beta goal", "P Solving now: beta fx-1a"],
    ],
  });
});

test("the portfolio page shows the good product and says the broken product's roadmap could not be read", async () => {
  const overrides = await portfolioOverrides();
  overrides.set("/products/alpha/roadmap/roadmap.json", "{ not json");
  const server = await serveRepo(overrides);
  const url = `http://127.0.0.1:${server.address().port}/strip/portfolio.html`;

  const page = await inPage(PORTFOLIO_ITEMS, url).finally(() => server.close());

  assert.deepEqual(page.items, [
    ["H2 Alpha Product", "P This product's roadmap could not be read"],
    ["H2 Beta Product", "P Beta goal", "P Solving now: beta fx-1a"],
  ]);
});

async function portfolioStructureInChromeTree(send) {
  await send("Accessibility.enable");
  await evaluate(PORTFOLIO_ITEMS)(send);
  const tree = await send("Accessibility.getFullAXTree");
  const nodes = tree.result.nodes.filter((axNode) => !axNode.ignored);
  const headings = (level) => nodes
    .filter((axNode) => axNode.role?.value === "heading" && axNode.properties?.find((property) => property.name === "level")?.value.value === level)
    .map((axNode) => axNode.name.value);
  const lang = (await send("Runtime.evaluate", { expression: "document.documentElement.lang" })).result.result.value;
  return { lang, h1: headings(1), h2: headings(2), lists: nodes.filter((axNode) => axNode.role?.value === "list").length, items: nodes.filter((axNode) => axNode.role?.value === "listitem").length };
}

test("the portfolio page declares its language and has an h1 Portfolio, one h2 and one list item per product in Chrome's accessibility tree", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = `http://127.0.0.1:${server.address().port}/strip/portfolio.html`;

  const seen = await withPage(url, portfolioStructureInChromeTree).finally(() => server.close());

  assert.deepEqual(seen, { lang: "en", h1: ["Portfolio"], h2: ["Alpha Product", "Beta Product"], lists: 1, items: 2 });
});

const SCRIPT_LIKE_NAME = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>';

const NAME_MADE_NO_ELEMENT = pollUntilFound(`[...document.querySelectorAll("ul > li")]`, `(items) => ({
  heading: items[0].querySelector("h2").textContent,
  made: items[0].querySelectorAll("img, script").length + document.querySelectorAll("ul img, ul script").length,
  pwned: window.pwned === undefined,
})`);

test("the portfolio page renders a product name holding script-like markup as plain text, with no img or script element made from it", async () => {
  const overrides = await portfolioOverrides();
  const registry = JSON.parse(overrides.get("/portfolio/portfolio.json"));
  registry.products[0].name = SCRIPT_LIKE_NAME;
  overrides.set("/portfolio/portfolio.json", JSON.stringify(registry));
  const server = await serveRepo(overrides);
  const url = `http://127.0.0.1:${server.address().port}/strip/portfolio.html`;

  const seen = await inPage(NAME_MADE_NO_ELEMENT, url).finally(() => server.close());

  assert.deepEqual(seen, { heading: SCRIPT_LIKE_NAME, made: 0, pwned: true });
});

const OPENED_PRODUCT_TREE = pollUntilFound(ROADMAP_CARDS, `() => ({
  goal: document.querySelector('section[aria-label="Roadmap"] > h1')?.textContent,
  names: ["beta fx-1a", "beta fx-2"].filter((name) => document.body.textContent.includes(name)),
  alphaGoalShown: document.body.textContent.includes("Alpha goal"),
})`);

test("a tree page opened with ?product=beta shows beta's own goal and card names and not alpha's goal", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html?product=beta`;

  const seen = await inPage(OPENED_PRODUCT_TREE, url).finally(() => server.close());

  assert.equal(seen.goal, "Beta goal");
  assert.deepEqual(seen.names, ["beta fx-1a", "beta fx-2"]);
  assert.equal(seen.alphaGoalShown, false);
});

const alertPage = (words) => `new Promise((resolve) => {
  const giveUpAt = Date.now() + 5000;
  const look = () => {
    const alerts = [...document.querySelectorAll('[role="alert"]')];
    const found = alerts.some((alert) => alert.textContent.includes(${JSON.stringify(words)}));
    if (!found && Date.now() < giveUpAt) return setTimeout(look, 50);
    resolve({
      pageSays: document.body.textContent.includes(${JSON.stringify(words)}),
      alerts: alerts.map((alert) => alert.textContent),
      treeCards: document.querySelectorAll('section[aria-label="Roadmap"]').length,
    });
  };
  look();
})`;
const UNKNOWN_PRODUCT_PAGE = alertPage("This product is not in the portfolio");
const REGISTRY_UNREADABLE_PAGE = alertPage("The portfolio list could not be read");

test("a tree page opened with an unknown product id says the product is not in the portfolio in an alert, draws no tree and requests no product file", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const requested = [];
  server.on("request", (request) => requested.push(new URL(request.url, "http://x").pathname));
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html?product=nope`;

  const seen = await inPage(UNKNOWN_PRODUCT_PAGE, url).finally(() => server.close());

  assert.equal(seen.pageSays, true);
  assert.deepEqual(seen.alerts, ["This product is not in the portfolio"]);
  assert.equal(seen.treeCards, 0);
  assert.deepEqual(requested.filter((path) => /roadmap\.json|decisions\.jsonl|pace\.json/.test(path)), []);
  assert.ok(requested.includes("/portfolio/portfolio.json"));
});

test("a tree page opened with a product id while the registry cannot be read says the portfolio list could not be read in an alert, draws no tree and requests no product file", async () => {
  const overrides = await portfolioOverrides();
  overrides.set("/portfolio/portfolio.json", null);
  const server = await serveRepo(overrides);
  const requested = [];
  server.on("request", (request) => requested.push(new URL(request.url, "http://x").pathname));
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html?product=alpha`;

  const seen = await inPage(REGISTRY_UNREADABLE_PAGE, url).finally(() => server.close());

  assert.equal(seen.pageSays, true);
  assert.deepEqual(seen.alerts, ["The portfolio list could not be read"]);
  assert.equal(seen.treeCards, 0);
  assert.deepEqual(requested.filter((path) => /roadmap\.json|decisions\.jsonl|pace\.json/.test(path)), []);
});

const PRODUCT_LINK_HREFS = `[...document.querySelectorAll("h2 > a")].map((link) => link.getAttribute("href"))`;
const OPENED_GOAL = `document.querySelector('section[aria-label="Roadmap"] > h1')?.textContent`;

async function productLinksInChromeTree(send) {
  await send("Accessibility.enable");
  await evaluate(PORTFOLIO_ITEMS)(send);
  const nodes = (await send("Accessibility.getFullAXTree")).result.nodes.filter((axNode) => !axNode.ignored);
  const names = nodes.filter((axNode) => axNode.role?.value === "link").map((axNode) => axNode.name.value);
  const hrefs = await evaluate(PRODUCT_LINK_HREFS)(send);
  await evaluate(`document.querySelectorAll("h2 > a")[1].click()`)(send);
  const deadline = Date.now() + 5000;
  let openedGoal;
  while (!openedGoal && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    openedGoal = await evaluate(OPENED_GOAL)(send).catch(() => undefined);
  }
  return { names, hrefs, openedGoal };
}

test("the portfolio page makes each product name a link named by it, with href workspace.html?product=id, and the second link opens that product's tree", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = `http://127.0.0.1:${server.address().port}/strip/portfolio.html`;

  const seen = await withPage(url, productLinksInChromeTree).finally(() => server.close());

  assert.deepEqual(seen.names, ["Alpha Product", "Beta Product"]);
  assert.deepEqual(seen.hrefs, ["workspace.html?product=alpha", "workspace.html?product=beta"]);
  assert.equal(seen.openedGoal, "Beta goal");
});

const TREE_PAGE_DRAWN = pollUntilFound(`[...document.querySelectorAll("#app > *")]`, `() => true`);
const FOCUSED_IS_BACK_LINK = `document.activeElement?.getAttribute("href") === "portfolio.html"`;
const BACK_LINK_TAB_PRESSES = 3;

async function backLinkOnTreePage(send) {
  await send("Accessibility.enable");
  await evaluate(TREE_PAGE_DRAWN)(send);
  const nodes = (await send("Accessibility.getFullAXTree")).result.nodes.filter((axNode) => !axNode.ignored);
  const links = nodes.filter((axNode) => axNode.role?.value === "link").map((axNode) => axNode.name.value);
  const hrefs = await evaluate(`[...document.querySelectorAll("a")].map((link) => link.getAttribute("href"))`)(send);
  let presses = 0;
  while (presses < BACK_LINK_TAB_PRESSES && !(await evaluate(FOCUSED_IS_BACK_LINK)(send))) {
    await press(send, TAB);
    presses++;
  }
  return { links, hrefs, focused: await evaluate(FOCUSED_IS_BACK_LINK)(send) };
}

test("every tree page, the bare dashboard, an opened product and an unknown product, has a link named Back to the portfolio with href portfolio.html that Tab reaches within 3 presses", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const base = `http://127.0.0.1:${server.address().port}/strip/index.html`;
  const urls = [base, `${base}?product=beta`, `${base}?product=nope`];

  const seen = [];
  for (const url of urls) seen.push(await withPage(url, backLinkOnTreePage).catch((error) => error.message));
  server.close();

  const expected = { links: ["Back to the portfolio"], hrefs: ["portfolio.html"], focused: true };
  assert.deepEqual(seen, [expected, expected, expected]);
});

const OPENED_RENAMED_CARD = "beta fx-2 renamed";
const WAIT_FOR_OPENED_RENAMED_CARD = `new Promise((resolve) => {
  const giveUpAt = Date.now() + 10000;
  const look = () => {
    const found = document.body.textContent.includes("${OPENED_RENAMED_CARD}");
    if (!found && Date.now() < giveUpAt) return setTimeout(look, 250);
    resolve({ found, alphaGoalShown: document.body.textContent.includes("Alpha goal") });
  };
  look();
})`;

test("a pace-less product opened by ?product=beta shows its goal and the forecast-unavailable words and picks up a renamed card without a refresh, never showing the other product's goal", async () => {
  const overrides = await portfolioOverrides();
  overrides.set("/products/beta/roadmap/pace.json", null);
  const server = await serveRepo(overrides);
  const url = `http://127.0.0.1:${server.address().port}/strip/index.html?product=beta`;

  const seen = await withPage(url, async (send) => {
    const first = await evaluate(OPENED_PRODUCT_TREE)(send);
    const paceWords = await evaluate(WAIT_FOR_PACE_WORDS)(send);
    const renamed = JSON.parse(overrides.get("/products/beta/roadmap/roadmap.json"));
    renamed.problems.find((problem) => problem.id === "fx-2").problem = OPENED_RENAMED_CARD;
    overrides.set("/products/beta/roadmap/roadmap.json", JSON.stringify(renamed));
    return { first, paceWords, after: await evaluate(WAIT_FOR_OPENED_RENAMED_CARD)(send) };
  }).finally(() => server.close());

  assert.equal(seen.first.goal, "Beta goal");
  assert.equal(seen.paceWords, true, "the opened product never said the pace file could not be loaded");
  assert.equal(seen.after.found, true, "the opened product never showed the renamed card");
  assert.equal(seen.first.alphaGoalShown || seen.after.alphaGoalShown, false);
});

const TITLE_ONCE_DRAWN = pollUntilFound(`[...document.querySelectorAll("#app > *")]`, `() => document.title`);

test("the tree page's title is the product's name for an opened product, Not in the portfolio for an unknown one, Portfolio could not be read when the registry fails, and unchanged on the bare page", async () => {
  const overrides = await portfolioOverrides();
  const server = await serveRepo(overrides);
  const base = `http://127.0.0.1:${server.address().port}/strip/index.html`;
  const unreadable = await serveRepo(new Map([...overrides, ["/portfolio/portfolio.json", null]]));

  const titles = [];
  for (const url of [base, `${base}?product=beta`, `${base}?product=nope`, `http://127.0.0.1:${unreadable.address().port}/strip/index.html?product=beta`]) {
    titles.push(await inPage(TITLE_ONCE_DRAWN, url));
  }
  server.close();
  unreadable.close();

  assert.deepEqual(titles, [
    "Where we are — ClickChain roadmap",
    "Beta Product — ClickChain roadmap",
    "Not in the portfolio — ClickChain roadmap",
    "Portfolio could not be read — ClickChain roadmap",
  ]);
});

function workspaceUrl(server, product) {
  return `http://127.0.0.1:${server.address().port}/strip/workspace.html?product=${product}`;
}

const WORKSPACE_PAGE = pollUntilFound(`[...document.querySelectorAll("main section[aria-label='Roadmap']")]`, `() => {
  const nav = document.querySelector('nav[aria-label="Products"]');
  const main = document.querySelector("main");
  return {
    navLinks: nav ? [...nav.querySelectorAll("a")].map((link) => link.textContent) : null,
    mainGoal: main.querySelector('section[aria-label="Roadmap"] > h1')?.textContent,
    mainNames: ["beta fx-1a", "beta fx-2"].filter((name) => main.textContent.includes(name)),
    alphaGoalInMain: main.textContent.includes("Alpha goal"),
  };
}`);

test("a workspace page opened with ?product=beta lists both products as links in a Products navigation and shows beta's goal and a beta card, not alpha's goal, in the main area", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await inPage(WORKSPACE_PAGE, url).finally(() => server.close());

  assert.deepEqual(seen.navLinks, ["Alpha Product", "Beta Product"]);
  assert.equal(seen.mainGoal, "Beta goal");
  assert.deepEqual(seen.mainNames, ["beta fx-1a", "beta fx-2"]);
  assert.equal(seen.alphaGoalInMain, false);
});

const CLICK_ALPHA_LINK = `(() => {
  window.__noReload = 1;
  [...document.querySelectorAll('nav[aria-label="Products"] a')].find((link) => link.textContent === "Alpha Product").click();
})()`;

const WORKSPACE_AFTER_CLICK = `(() => {
  const nav = document.querySelector('nav[aria-label="Products"]');
  return {
    mainGoal: document.querySelector('main section[aria-label="Roadmap"] > h1')?.textContent,
    title: document.title,
    search: location.search,
    marker: window.__noReload,
    navLinks: nav ? [...nav.querySelectorAll("a")].map((link) => link.textContent) : null,
    pauseButtons: [...document.querySelectorAll("button")].filter((candidate) => candidate.textContent === "Pause motion").length,
  };
})()`;

async function workspaceAfterChoosingAlpha(send) {
  await evaluate(WORKSPACE_PAGE)(send);
  await evaluate(CLICK_ALPHA_LINK)(send);
  const deadline = Date.now() + 5000;
  let seen;
  while (seen?.mainGoal !== "Alpha goal" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    seen = await evaluate(WORKSPACE_AFTER_CLICK)(send).catch(() => undefined);
  }
  return seen;
}

test("a workspace page opened with ?product=beta swaps to alpha in place when alpha's sidebar link is clicked: alpha's goal and title, ?product=alpha, no reload, both products listed, one Pause motion button", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, workspaceAfterChoosingAlpha).finally(() => server.close());

  assert.equal(seen?.mainGoal, "Alpha goal");
  assert.equal(seen.title, "Alpha Product — ClickChain roadmap");
  assert.equal(seen.search, "?product=alpha");
  assert.equal(seen.marker, 1);
  assert.deepEqual(seen.navLinks, ["Alpha Product", "Beta Product"]);
  assert.equal(seen.pauseButtons, 1);
});

const CLICK_BETA_THEN_ALPHA = `(() => {
  const click = (name) => [...document.querySelectorAll('nav[aria-label="Products"] a')].find((link) => link.textContent === name).click();
  click("Beta Product");
  click("Alpha Product");
})()`;

const WORKSPACE_MAIN_NOW = `(() => ({
  goals: [...document.querySelectorAll('main section[aria-label="Roadmap"] > h1')].map((heading) => heading.textContent),
  search: location.search,
}))()`;

async function workspaceAfterBetaThenAlphaWithSlowBeta(send, delays, requested) {
  await evaluate(WORKSPACE_PAGE)(send);
  const betaRoadmap = "/products/beta/roadmap/roadmap.json";
  const slowMs = 1500;
  delays.set(betaRoadmap, slowMs);
  const clickedAt = requested.length;
  await evaluate(CLICK_BETA_THEN_ALPHA)(send);
  await new Promise((resolve) => setTimeout(resolve, slowMs + 6500));
  return { seen: await evaluate(WORKSPACE_MAIN_NOW)(send), afterClick: requested.slice(clickedAt).filter((path) => path === betaRoadmap) };
}

test("a workspace page opened with ?product=alpha ends on alpha's tree and address when beta then alpha are chosen back to back, and requests none of beta's roadmap files after those clicks", async () => {
  const delays = new Map();
  const server = await serveRepo(await portfolioOverrides(), delays);
  const requested = [];
  server.on("request", (request) => { if (request.headers["x-read"] !== "sidebar") requested.push(new URL(request.url, "http://x").pathname); });
  const url = workspaceUrl(server, "alpha");

  const { seen, afterClick } = await withPage(url, (send) => workspaceAfterBetaThenAlphaWithSlowBeta(send, delays, requested)).finally(() => server.close());

  assert.deepEqual(seen.goals, ["Alpha goal"]);
  assert.equal(seen.search, "?product=alpha");
  assert.equal(afterClick.length, 0);
});

const WORKSPACE_TREES_NOW = `(() => ({
  goals: [...document.querySelectorAll('main section[aria-label="Roadmap"] > h1')].map((heading) => heading.textContent),
  trees: document.querySelectorAll('main section[aria-label="Roadmap"]').length,
  search: location.search,
}))()`;

async function workspaceAfterAlphaChosenOnceBetaRequestSeen(send, delays, betaRequested) {
  await evaluate(WORKSPACE_PAGE)(send);
  const slowMs = 1500;
  const click = (name) => evaluate(`[...document.querySelectorAll('nav[aria-label="Products"] a')].find((link) => link.textContent === ${JSON.stringify(name)}).click()`)(send);
  delays.set("/products/beta/roadmap/roadmap.json", slowMs);
  await click("Beta Product");
  await betaRequested;
  await click("Alpha Product");
  await new Promise((resolve) => setTimeout(resolve, slowMs + 1500));
  return evaluate(WORKSPACE_TREES_NOW)(send);
}

test("a workspace page opened with ?product=alpha ends with exactly one tree, alpha's, and ?product=alpha when alpha is chosen after the server has seen beta's slow roadmap request", async () => {
  const delays = new Map();
  const server = await serveRepo(await portfolioOverrides(), delays);
  const betaRequested = new Promise((resolve) => server.on("request", (request) => {
    if (request.headers["x-read"] !== "sidebar" && new URL(request.url, "http://x").pathname === "/products/beta/roadmap/roadmap.json") resolve();
  }));
  const url = workspaceUrl(server, "alpha");

  const seen = await withPage(url, (send) => workspaceAfterAlphaChosenOnceBetaRequestSeen(send, delays, betaRequested)).finally(() => server.close());

  assert.deepEqual(seen, { goals: ["Alpha goal"], trees: 1, search: "?product=alpha" });
});

async function workspaceAfterBetaThenAlphaWithSlowRegistry(send, delays) {
  await evaluate(WORKSPACE_PAGE)(send);
  const registry = "/portfolio/portfolio.json";
  const slowMs = 1500;
  const click = (name) => evaluate(`[...document.querySelectorAll('nav[aria-label="Products"] a')].find((link) => link.textContent === ${JSON.stringify(name)}).click()`)(send);
  delays.set(registry, slowMs);
  await click("Beta Product");
  delays.delete(registry);
  await click("Alpha Product");
  await new Promise((resolve) => setTimeout(resolve, slowMs + 1500));
  return evaluate(WORKSPACE_MAIN_NOW)(send);
}

test("a workspace page opened with ?product=beta ends on alpha's tree and address when beta then alpha are chosen before beta's slow registry read returns", async () => {
  const delays = new Map();
  const server = await serveRepo(await portfolioOverrides(), delays);
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, (send) => workspaceAfterBetaThenAlphaWithSlowRegistry(send, delays)).finally(() => server.close());

  assert.deepEqual(seen.goals, ["Alpha goal"]);
  assert.equal(seen.search, "?product=alpha");
});

const WATCH_ALERT_INSERTIONS = `(() => {
  window.__alertInsertions = 0;
  new MutationObserver((records) => {
    for (const node of records.flatMap((record) => [...record.addedNodes])) {
      if (node.nodeType === 1 && (node.matches('[role="alert"]') || node.querySelector('[role="alert"]'))) window.__alertInsertions += 1;
    }
  }).observe(document.getElementById("main"), { childList: true, subtree: true });
})()`;

const TITLE_AND_ALERT_INSERTIONS = `({ title: document.title, alertInsertions: window.__alertInsertions })`;

async function workspaceAfterAlphaOpensBeforeBetaRegistryFails(send, overrides, delays) {
  const registry = "/portfolio/portfolio.json";
  const slowMs = 1500;
  const alphaOpensMs = 600;
  const click = (name) => evaluate(`[...document.querySelectorAll('nav[aria-label="Products"] a')].find((link) => link.textContent === ${JSON.stringify(name)}).click()`)(send);
  await evaluate(WORKSPACE_PAGE)(send);
  await evaluate(WATCH_ALERT_INSERTIONS)(send);
  delays.set(registry, slowMs);
  await click("Beta Product");
  delays.delete(registry);
  await click("Alpha Product");
  await new Promise((resolve) => setTimeout(resolve, alphaOpensMs));
  overrides.set(registry, null);
  await new Promise((resolve) => setTimeout(resolve, slowMs + 500));
  return evaluate(TITLE_AND_ALERT_INSERTIONS)(send);
}

test("a workspace page opened with ?product=alpha keeps alpha's title and adds no alert to main when beta's slow registry read fails after alpha is chosen and opened", async () => {
  const overrides = await portfolioOverrides();
  const delays = new Map();
  const server = await serveRepo(overrides, delays);
  const url = workspaceUrl(server, "alpha");

  const seen = await withPage(url, (send) => workspaceAfterAlphaOpensBeforeBetaRegistryFails(send, overrides, delays)).finally(() => server.close());

  assert.deepEqual(seen, { title: "Alpha Product — ClickChain roadmap", alertInsertions: 0 });
});

async function workspaceRequestsAcrossSwitch(send, requested) {
  const count = (path) => requested.filter((requestedPath) => requestedPath === path).length;
  const betaRoadmap = "/products/beta/roadmap/roadmap.json";
  const alphaRoadmap = "/products/alpha/roadmap/roadmap.json";
  const liveIntervalMs = 5000;
  await evaluate(WORKSPACE_PAGE)(send);
  const pollDeadline = Date.now() + 2 * liveIntervalMs;
  while (count(betaRoadmap) < 2 && Date.now() < pollDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
  const betaAtClick = count(betaRoadmap);
  const alphaAtClick = count(alphaRoadmap);
  await evaluate(CLICK_ALPHA_LINK)(send);
  await new Promise((resolve) => setTimeout(resolve, 1.5 * liveIntervalMs));
  return { betaAtClick, betaAfter: count(betaRoadmap), alphaPolls: count(alphaRoadmap) - alphaAtClick };
}

test("a workspace page opened with ?product=beta requests no more of beta's roadmap.json after alpha is chosen, while alpha's roadmap.json is requested more than once", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const requested = [];
  server.on("request", (request) => { if (request.headers["x-read"] !== "sidebar") requested.push(new URL(request.url, "http://x").pathname); });
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, (send) => workspaceRequestsAcrossSwitch(send, requested)).finally(() => server.close());

  assert.ok(seen.betaAtClick >= 2, "beta was never polled before the click");
  assert.equal(seen.betaAfter, seen.betaAtClick);
  assert.ok(seen.alphaPolls > 1, "alpha was not polled after the click");
});

const WORKSPACE_HISTORY_NOW = `(() => ({
  goals: [...document.querySelectorAll('main section[aria-label="Roadmap"] > h1')].map((heading) => heading.textContent),
  search: location.search,
  title: document.title,
  marker: window.__noReload,
  historyLength: history.length,
  pushes: window.__pushes,
  replaces: window.__replaces,
}))()`;

const COUNT_PUSHES = `(() => {
  window.__pushes = 0;
  const push = history.pushState.bind(history);
  history.pushState = (...args) => { window.__pushes += 1; return push(...args); };
})()`;

async function pollWorkspaceUntil(send, ready) {
  const deadline = Date.now() + 5000;
  let seen;
  while (!(seen && ready(seen)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    seen = await evaluate(WORKSPACE_HISTORY_NOW)(send).catch(() => undefined);
  }
  return seen;
}

async function workspaceAfterAlphaThenBack(send) {
  await evaluate(WORKSPACE_PAGE)(send);
  await evaluate(CLICK_ALPHA_LINK)(send);
  const onAlpha = await pollWorkspaceUntil(send, (state) => state.search === "?product=alpha");
  await evaluate(COUNT_PUSHES)(send);
  await evaluate("history.back()")(send);
  const afterBack = await pollWorkspaceUntil(send, (state) => state.search === "?product=beta" && state.goals.includes("Beta goal"));
  return { lengthOnAlpha: onAlpha?.historyLength, afterBack };
}

test("a workspace page opened with ?product=beta returns to beta's tree, address and title on Back after alpha is chosen, with no reload and no history entry added by Back", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const { lengthOnAlpha, afterBack } = await withPage(url, workspaceAfterAlphaThenBack).finally(() => server.close());

  assert.deepEqual(afterBack?.goals, ["Beta goal"]);
  assert.equal(afterBack.search, "?product=beta");
  assert.equal(afterBack.title, "Beta Product — ClickChain roadmap");
  assert.equal(afterBack.historyLength, lengthOnAlpha);
  assert.equal(afterBack.pushes, 0);
  assert.equal(afterBack.marker, 1);
});

const WORKSPACE_CHROME = `(() => ({
  status: document.querySelector('#read-at [role="status"]')?.textContent,
  pauseButtons: [...document.querySelectorAll("button")].filter((candidate) => candidate.textContent === "Pause motion").length,
}))()`;

test("a workspace page opened with ?product=beta shows the Roadmap read at status and exactly one Pause motion button", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    return evaluate(WORKSPACE_CHROME)(send);
  }).finally(() => server.close());

  assert.match(seen.status, /^Roadmap read at /);
  assert.equal(seen.pauseButtons, 1);
});

test("a workspace page opened with ?product=alpha shows alpha's goal and address and not beta's goal", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "alpha");

  const seen = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    return evaluate(WORKSPACE_HISTORY_NOW)(send);
  }).finally(() => server.close());

  assert.deepEqual(seen.goals, ["Alpha goal"]);
  assert.equal(seen.search, "?product=alpha");
});

const CLICK_BETA_LINK = `(() => {
  [...document.querySelectorAll('nav[aria-label="Products"] a')].find((link) => link.textContent === "Beta Product").click();
})()`;

async function workspaceTitlesAlphaThenBeta(send) {
  await evaluate(WORKSPACE_PAGE)(send);
  const first = await evaluate(WORKSPACE_HISTORY_NOW)(send);
  await evaluate(CLICK_BETA_LINK)(send);
  const deadline = Date.now() + 5000;
  let after;
  while (after?.goals?.[0] !== "Beta goal" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    after = await evaluate(WORKSPACE_HISTORY_NOW)(send).catch(() => undefined);
  }
  return { first: first.title, after: after?.title };
}

test("a workspace page opened with ?product=alpha titles itself Alpha Product on first load and Beta Product once beta is chosen, never the generic Workspace title", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "alpha");

  const seen = await withPage(url, workspaceTitlesAlphaThenBeta).finally(() => server.close());

  assert.equal(seen.first, "Alpha Product — ClickChain roadmap");
  assert.equal(seen.after, "Beta Product — ClickChain roadmap");
});

const SIDEBAR_MARKS = `(() => {
const rowEdge = (style) => [style.outlineColor, style.outlineStyle, style.outlineStyle === "none" ? "" : style.outlineWidth, style.borderTopWidth, style.backgroundColor].join(" ");
return [...document.querySelectorAll('nav[aria-label="Products"] a')].map((link) => ({
  name: link.textContent,
  current: link.getAttribute("aria-current"),
  row: rowEdge(getComputedStyle(link.closest("li"))),
}));
})()`;

async function sidebarMarksBeforeAndAfterChoosingAlpha(send) {
  await evaluate(WORKSPACE_PAGE)(send);
  const before = await evaluate(SIDEBAR_MARKS)(send);
  await evaluate(CLICK_ALPHA_LINK)(send);
  const deadline = Date.now() + 5000;
  let after;
  while (after?.find((mark) => mark.current === "page")?.name !== "Alpha Product" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    after = await evaluate(SIDEBAR_MARKS)(send).catch(() => undefined);
  }
  return { before, after };
}

test("a workspace page opened with ?product=beta marks only Beta Product's link aria-current page, and moves it to Alpha Product's link when alpha is chosen", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const { before, after } = await withPage(url, sidebarMarksBeforeAndAfterChoosingAlpha).finally(() => server.close());

  assert.deepEqual(before.map((mark) => mark.current), [null, "page"]);
  assert.deepEqual(after.map((mark) => mark.current), ["page", null]);
});

const OPEN_ROW = "rgb(25, 184, 163) solid 1px 0px rgb(7, 23, 25)";
const PLAIN_ROW = "rgb(232, 234, 237) none  0px rgba(0, 0, 0, 0)";

test("a workspace page opened with ?product=beta draws a solid accent outline and fill on only the open product's row, keeping aria-current page on its link, and moves both to Alpha Product's row when alpha is chosen", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const { before, after } = await withPage(url, sidebarMarksBeforeAndAfterChoosingAlpha).finally(() => server.close());

  assert.deepEqual(before.map((mark) => [mark.current, mark.row]), [[null, PLAIN_ROW], ["page", OPEN_ROW]]);
  assert.deepEqual(after.map((mark) => [mark.current, mark.row]), [["page", OPEN_ROW], [null, PLAIN_ROW]]);
});

const SIDEBAR_LOOK = `(() => {
  const nav = document.querySelector('nav[aria-label="Products"]');
  const list = nav.querySelector("ul");
  const navStyle = getComputedStyle(nav);
  return {
    navBackground: navStyle.backgroundColor,
    navEdge: [navStyle.borderRightColor, navStyle.borderRightStyle, navStyle.borderRightWidth].join(" "),
    listStyle: getComputedStyle(list).listStyleType,
    linkDecorations: [...nav.querySelectorAll("a")].map((link) => getComputedStyle(link).textDecorationLine),
    rowRadii: [...list.children].map((row) => getComputedStyle(row).borderRadius),
    treeListStyle: getComputedStyle(document.querySelector('main section[aria-label="Roadmap"] ul')).listStyleType,
  };
})()`;

test("a workspace page opened with ?product=beta at desktop width 1200px draws the Products sidebar on the chrome background with a hairline edge, no bullets, no link underlines and each product in a 10px rounded row", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    return evaluate(SIDEBAR_LOOK)(send);
  }, { width: 1200 }).finally(() => server.close());

  assert.deepEqual(seen, {
    navBackground: "rgb(5, 5, 10)",
    navEdge: "rgb(43, 43, 43) solid 1px",
    listStyle: "none",
    linkDecorations: ["none", "none"],
    rowRadii: ["10px", "10px"],
    treeListStyle: "none",
  });
});

const SIDEBAR_TYPE_LOOK = `(() => {
  const nav = document.querySelector('nav[aria-label="Products"]');
  const list = nav.querySelector("ul");
  const row = list.children[0];
  const name = row.querySelector("h2");
  const [goal, solving] = row.querySelectorAll("p");
  const box = (element) => {
    const style = getComputedStyle(element);
    return { size: style.fontSize, weight: style.fontWeight, color: style.color, marginTop: style.marginTop, marginBottom: style.marginBottom, marginLeft: style.marginLeft };
  };
  const listStyle = getComputedStyle(list);
  const rowStyle = getComputedStyle(row);
  return {
    name: box(name),
    list: { margin: listStyle.margin, paddingLeft: listStyle.paddingLeft, rowGap: listStyle.rowGap },
    rowPadding: rowStyle.padding,
    goal: box(goal),
    solving: box(solving),
    navFillsViewport: nav.getBoundingClientRect().height >= window.innerHeight,
    treeTitleSize: getComputedStyle(document.querySelector('main section[aria-label="Roadmap"] > h1')).fontSize,
  };
})()`;

test("a workspace page opened with ?product=beta at desktop width 1200px sets each sidebar product name at 14px semibold with no margin, the list flush with padded rows and a gap, smaller muted goal and Solving now lines indented past the dot, and the panel full height", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    return evaluate(SIDEBAR_TYPE_LOOK)(send);
  }, { width: 1200 }).finally(() => server.close());

  const muted = "rgb(140, 140, 140)";
  assert.deepEqual(seen, {
    name: { size: "14px", weight: "600", color: seen.name.color, marginTop: "0px", marginBottom: "0px", marginLeft: "0px" },
    list: { margin: "0px", paddingLeft: "0px", rowGap: "6px" },
    rowPadding: "9px 10px",
    goal: { size: "12.5px", weight: "400", color: muted, marginTop: "4px", marginBottom: "0px", marginLeft: "16px" },
    solving: { size: "12px", weight: "400", color: muted, marginTop: "4px", marginBottom: "0px", marginLeft: "16px" },
    navFillsViewport: true,
    treeTitleSize: "20px",
  });
});

const PRODUCTS_LABEL_LOOK = `(() => {
  const nav = document.querySelector('nav[aria-label="Products"]');
  const label = getComputedStyle(nav, "::before");
  return {
    content: label.content,
    display: label.display,
    textTransform: label.textTransform,
    color: label.color,
    listTop: nav.querySelector("ul").getBoundingClientRect().top,
    treeBefore: getComputedStyle(document.querySelector('main section[aria-label="Roadmap"]'), "::before").content,
  };
})()`;
const HIDE_PRODUCTS_LABEL = `(() => {
  const style = document.createElement("style");
  style.textContent = 'nav[aria-label="Products"]::before { content: none !important; }';
  document.head.append(style);
})()`;

async function productsNavInChromeTree(send) {
  const nodes = (await send("Accessibility.getFullAXTree")).result.nodes;
  const nav = nodes.find((axNode) => !axNode.ignored && axNode.role?.value === "navigation");
  const under = (axNode) => [axNode, ...(axNode.childIds ?? []).flatMap((id) => under(nodes.find((candidate) => candidate.nodeId === id)))];
  return { name: nav.name.value, subtree: under(nav).filter((axNode) => !axNode.ignored).map((axNode) => `${axNode.role?.value} ${axNode.name?.value ?? ""}`) };
}

async function productsLabelSeenAndHeard(send) {
  await send("Accessibility.enable");
  await evaluate(WORKSPACE_PAGE)(send);
  const withLabel = { look: await evaluate(PRODUCTS_LABEL_LOOK)(send), tree: await productsNavInChromeTree(send) };
  await evaluate(HIDE_PRODUCTS_LABEL)(send);
  const without = { look: await evaluate(PRODUCTS_LABEL_LOOK)(send), tree: await productsNavInChromeTree(send) };
  return { withLabel, without };
}

test("a workspace page opened with ?product=beta at desktop width 1200px shows a visible uppercase muted Products label above the sidebar list from generated content, keeping the navigation named Products and adding no text to Chrome accessibility tree", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const { withLabel, without } = await withPage(url, productsLabelSeenAndHeard, { width: 1200 }).finally(() => server.close());

  const { listTop, ...labelLook } = withLabel.look;
  assert.deepEqual(labelLook, { content: '"Products" / ""', display: "block", textTransform: "uppercase", color: "rgb(140, 140, 140)", treeBefore: "none" });
  assert.ok(listTop > without.look.listTop, `the list should sit lower under the label: ${listTop} vs ${without.look.listTop}`);
  assert.equal(withLabel.tree.name, "Products");
  assert.deepEqual(withLabel.tree.subtree, without.tree.subtree);
});

const SIDEBAR_DOTS = `(() => {
  const dots = [...document.querySelectorAll('nav[aria-label="Products"] a')].map((link) => {
    const dot = getComputedStyle(link, "::before");
    return { open: link.getAttribute("aria-current") === "page", content: dot.content, display: dot.display, width: dot.width, height: dot.height, radius: dot.borderTopLeftRadius, background: dot.backgroundColor, gap: dot.marginRight };
  });
  return { dots, pauseContent: getComputedStyle(document.querySelector("#read-at button"), "::before").content };
})()`;

async function sidebarLinkNames(send) {
  const nodes = (await send("Accessibility.getFullAXTree")).result.nodes;
  return nodes.filter((axNode) => !axNode.ignored && axNode.role?.value === "link").map((axNode) => axNode.name.value);
}

test("a workspace page opened with ?product=beta at desktop width 1200px draws a small round accent dot before each sidebar product link's name, the same on the open row, from generated content that leaves every link's accessible name as the product name", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const { look, names } = await withPage(url, async (send) => {
    await send("Accessibility.enable");
    await evaluate(WORKSPACE_PAGE)(send);
    return { look: await evaluate(SIDEBAR_DOTS)(send), names: await sidebarLinkNames(send) };
  }, { width: 1200 }).finally(() => server.close());

  const DOT = { content: '"" / ""', display: "inline-block", width: "8px", height: "8px", radius: "50%", background: "rgb(25, 184, 163)", gap: "8px" };
  assert.deepEqual(look.dots, [{ open: false, ...DOT }, { open: true, ...DOT }]);
  assert.deepEqual(names, ["Alpha Product", "Beta Product"]);
  assert.equal(look.pauseContent, "none");
});

const READ_AT_BAR_LOOK = `(() => {
  const bar = document.querySelector("#read-at");
  const status = bar.querySelector('[role="status"]');
  const button = bar.querySelector("button");
  const barStyle = getComputedStyle(bar);
  const buttonStyle = getComputedStyle(button);
  const statusBox = status.getBoundingClientRect();
  const buttonBox = button.getBoundingClientRect();
  return {
    barDisplay: barStyle.display,
    barDirection: barStyle.flexDirection,
    barHairline: [barStyle.borderBottomColor, barStyle.borderBottomStyle, barStyle.borderBottomWidth].join(" "),
    statusColor: getComputedStyle(status).color,
    statusFontSize: getComputedStyle(status).fontSize,
    statusText: status.textContent.startsWith("Roadmap read at"),
    sameRow: Math.abs(statusBox.top - buttonBox.top) < statusBox.height && buttonBox.left >= statusBox.right - 1,
    pillFill: buttonStyle.backgroundColor,
    pillEdge: [buttonStyle.borderTopColor, buttonStyle.borderTopStyle, buttonStyle.borderTopWidth].join(" "),
    pillRadius: buttonStyle.borderRadius,
    pillName: button.textContent,
    pillPressed: button.getAttribute("aria-pressed"),
    goalEdge: getComputedStyle(document.querySelector('main section[aria-label="Roadmap"] > h1')).borderTopWidth,
  };
})()`;

test("a workspace page opened with ?product=beta at desktop width 1200px draws the read at status as a one-row bar with a hairline under it and small muted text, and Pause motion as an accent pill, keeping the status role and the button's name and pressed state", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    await evaluate(PAUSE_BUTTON_READY)(send);
    return evaluate(READ_AT_BAR_LOOK)(send);
  }, { width: 1200 }).finally(() => server.close());

  assert.deepEqual(seen, {
    barDisplay: "flex",
    barDirection: "row",
    barHairline: "rgb(43, 43, 43) solid 1px",
    statusColor: "rgb(140, 140, 140)",
    statusFontSize: "12px",
    statusText: true,
    sameRow: true,
    pillFill: "rgb(7, 23, 25)",
    pillEdge: "rgb(25, 184, 163) solid 1px",
    pillRadius: "10px",
    pillName: "Pause motion",
    pillPressed: "false",
    goalEdge: "2px",
  });
});

async function overridesWithForecastAndParked() {
  const overrides = await portfolioOverrides();
  const today = new Date().toISOString().slice(0, 10);
  const roadmap = JSON.parse(overrides.get("/products/beta/roadmap/roadmap.json"));
  roadmap.problems.push({ ...roadmap.problems[2], id: "fx-3", problem: "beta parked idea", status: "parked", order: 3 });
  const emptyPace = JSON.parse(await readFile(join(ROOT, "roadmap/pace.json"), "utf8"));
  overrides.set("/products/beta/roadmap/roadmap.json", JSON.stringify(roadmap));
  overrides.set("/products/beta/roadmap/decisions.jsonl", fixtureLog(roadmap, today));
  overrides.set("/products/beta/roadmap/pace.json", JSON.stringify({ ...emptyPace, results: [] }));
  return overrides;
}

const SECTION_BOX_LOOK = `new Promise((resolve) => {
  const giveUpAt = Date.now() + 5000;
  const look = () => {
    const forecast = document.querySelector('section[aria-label="Forecast inputs"]');
    const parked = document.querySelector('section[aria-label="Parked for later"]');
    if (!(forecast && parked) && Date.now() < giveUpAt) return setTimeout(look, 250);
    if (!(forecast && parked)) return resolve({ missing: [!forecast && "Forecast inputs", !parked && "Parked for later"].filter(Boolean) });
    const main = document.querySelector("main").getBoundingClientRect();
    const box = (section) => {
      const style = getComputedStyle(section);
      const rect = section.getBoundingClientRect();
      return {
        edge: [style.borderTopColor, style.borderTopStyle, style.borderTopWidth].join(" "),
        radius: style.borderRadius,
        padded: parseFloat(style.paddingTop) > 0 && parseFloat(style.paddingLeft) > 0,
        centred: Math.abs((rect.left - main.left) - (main.right - rect.right)) < 2,
        narrowerThanMain: rect.width < main.width - 100,
        color: style.color,
        fontSize: style.fontSize,
      };
    };
    const heading = getComputedStyle(parked.querySelector("h2"));
    const tree = getComputedStyle(document.querySelector('main section[aria-label="Roadmap"]'));
    resolve({
      forecast: box(forecast),
      parked: box(parked),
      parkedHeading: [heading.textTransform, heading.fontSize, heading.color].join(" "),
      parkedHeadingText: parked.querySelector("h2").textContent,
      parkedItem: parked.querySelector("li").textContent,
      forecastHasText: forecast.textContent.length > 0,
      treeEdge: tree.borderTopWidth,
    });
  };
  look();
})`;

test("a workspace page opened with ?product=beta at desktop width 1200px draws the Forecast inputs and Parked for later sections each in a bordered 10px rounded box, centred under the tree in small muted text, with the Parked heading a small uppercase label, keeping their landmark names and text", async () => {
  const server = await serveRepo(await overridesWithForecastAndParked());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, evaluate(SECTION_BOX_LOOK), { width: 1200 }).finally(() => server.close());

  const smallMutedBox = {
    edge: "rgb(43, 43, 43) solid 1px",
    radius: "10px",
    padded: true,
    centred: true,
    narrowerThanMain: true,
    color: "rgb(140, 140, 140)",
    fontSize: "13px",
  };
  assert.deepEqual(seen, {
    forecast: smallMutedBox,
    parked: smallMutedBox,
    parkedHeading: "uppercase 11px rgb(140, 140, 140)",
    parkedHeadingText: "Parked for later",
    parkedItem: "beta parked idea",
    forecastHasText: true,
    treeEdge: "0px",
  });
});

const SPY_ON_HISTORY = `(() => {
  window.__pushes = 0;
  window.__replaces = 0;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (...args) => { window.__pushes += 1; return push(...args); };
  history.replaceState = (...args) => { window.__replaces += 1; return replace(...args); };
})()`;

test("a workspace page opened with no product opens the first product, alpha, and replaces the address with ?product=alpha without adding a history entry", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const bareUrl = `http://127.0.0.1:${server.address().port}/strip/workspace.html`;

  const seen = await withPage(bareUrl, async (send) => {
    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: SPY_ON_HISTORY });
    await send("Page.navigate", { url: bareUrl });
    return pollWorkspaceUntil(send, (state) => state.pushes !== undefined && state.goals.length > 0);
  }).finally(() => server.close());

  assert.deepEqual(seen.goals, ["Alpha goal"]);
  assert.equal(seen.search, "?product=alpha");
  assert.equal(seen.pushes, 0);
  assert.equal(seen.replaces, 1);
});

test("a workspace page opened with ?product=beta makes no replaceState and no pushState call and the address stays ?product=beta", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, async (send) => {
    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: SPY_ON_HISTORY });
    await send("Page.navigate", { url });
    return pollWorkspaceUntil(send, (state) => state.pushes !== undefined && state.goals.length > 0);
  }).finally(() => server.close());

  assert.equal(seen.search, "?product=beta");
  assert.equal(seen.pushes, 0);
  assert.equal(seen.replaces, 0);
});

const WORKSPACE_UNKNOWN_PRODUCT = pollUntilFound(`[...document.querySelectorAll('main [role="alert"]')]`, `() => ({
  alerts: [...document.querySelectorAll('main [role="alert"]')].map((alert) => alert.textContent),
  navLinks: [...document.querySelectorAll('nav[aria-label="Products"] a')].map((link) => link.textContent),
  treeCards: document.querySelectorAll('section[aria-label="Roadmap"]').length,
  title: document.title,
})`);

test("a workspace page opened with an unknown product id shows the not-in-portfolio alert in the main area and titles itself Not in the portfolio, with both products still listed and no tree", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "nope");

  const seen = await inPage(WORKSPACE_UNKNOWN_PRODUCT, url).finally(() => server.close());

  assert.deepEqual(seen.alerts, ["This product is not in the portfolio"]);
  assert.deepEqual(seen.navLinks, ["Alpha Product", "Beta Product"]);
  assert.equal(seen.treeCards, 0);
  assert.equal(seen.title, "Not in the portfolio — ClickChain roadmap");
});

const SIDEBAR_ALPHA_LINE = `(() => {
  const item = [...document.querySelectorAll('nav[aria-label="Products"] li')].find((entry) => entry.querySelector("h2 > a")?.textContent === "Alpha Product");
  return {
    line: item?.lastElementChild?.textContent,
    marks: [...document.querySelectorAll('nav[aria-label="Products"] a')].map((link) => link.getAttribute("aria-current")),
    marker: window.__marker,
  };
})()`;

async function sidebarAlphaLineAfterAlphaChanges(send, overrides) {
  await evaluate(WORKSPACE_PAGE)(send);
  await evaluate(`window.__marker = "kept"`)(send);
  const before = await evaluate(SIDEBAR_ALPHA_LINE)(send);
  overrides.set("/products/alpha/roadmap/roadmap.json", overrides.get("/products/alpha/roadmap/roadmap.json").replace("alpha fx-1a", "alpha fx-1a changed"));
  const deadline = Date.now() + 9000;
  let after;
  while (!after?.line?.includes("changed") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    after = await evaluate(SIDEBAR_ALPHA_LINE)(send).catch(() => undefined);
  }
  return { before, after };
}

test("a workspace page opened with ?product=beta updates Alpha Product's Solving now line in the sidebar when alpha's roadmap changes, without a reload, and keeps the open marker on Beta Product's link", async () => {
  const overrides = await portfolioOverrides();
  const server = await serveRepo(overrides);
  const url = workspaceUrl(server, "beta");

  const { before, after } = await withPage(url, (send) => sidebarAlphaLineAfterAlphaChanges(send, overrides)).finally(() => server.close());

  assert.equal(before.line, "Solving now: alpha fx-1a");
  assert.equal(after.line, "Solving now: alpha fx-1a changed");
  assert.deepEqual(after.marks, [null, "page"]);
  assert.equal(after.marker, "kept");
});

const MAIN_HAS_ALPHA_NAME = (name) => `document.querySelector("main").textContent.includes(${JSON.stringify(name)})`;

async function alphaTreeAfterSwitchingAndAlphaChanges(send, overrides) {
  await evaluate(WORKSPACE_PAGE)(send);
  await evaluate(CLICK_ALPHA_LINK)(send);
  const deadline = Date.now() + 5000;
  while (!(await evaluate(MAIN_HAS_ALPHA_NAME("alpha fx-1a"))(send).catch(() => false)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const before = await evaluate(MAIN_HAS_ALPHA_NAME("alpha fx-1a changed"))(send);
  overrides.set("/products/alpha/roadmap/roadmap.json", overrides.get("/products/alpha/roadmap/roadmap.json").replace("alpha fx-1a", "alpha fx-1a changed"));
  const changedBy = Date.now() + 12000;
  let after = false;
  while (!after && Date.now() < changedBy) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    after = await evaluate(MAIN_HAS_ALPHA_NAME("alpha fx-1a changed"))(send).catch(() => false);
  }
  return { before, after };
}

test("a workspace page opened with ?product=beta, switched to alpha, shows alpha's changed card name in the open tree without a reload", async () => {
  const overrides = await portfolioOverrides();
  const server = await serveRepo(overrides);
  const url = workspaceUrl(server, "beta");

  const { before, after } = await withPage(url, (send) => alphaTreeAfterSwitchingAndAlphaChanges(send, overrides)).finally(() => server.close());

  assert.equal(before, false);
  assert.equal(after, true);
});

const SIDEBAR_STATE = `(() => {
  const nav = document.querySelector('nav[aria-label="Products"]');
  return { links: [...nav.querySelectorAll("h2 > a")].map((link) => link.textContent), text: nav.textContent };
})()`;

async function sidebarOnceMatching(send, matches, waitMs = 12000) {
  const deadline = Date.now() + waitMs;
  let state = await evaluate(SIDEBAR_STATE)(send);
  while (!matches(state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    state = await evaluate(SIDEBAR_STATE)(send).catch(() => state);
  }
  return state;
}

async function sidebarThroughRegistryFailureAndRecovery(send, overrides) {
  const registryPath = "/portfolio/portfolio.json";
  const good = overrides.get(registryPath);
  await evaluate(WORKSPACE_PAGE)(send);
  const before = await evaluate(SIDEBAR_STATE)(send);
  overrides.set(registryPath, null);
  const failed = await sidebarOnceMatching(send, ({ text }) => /could not/i.test(text));
  overrides.set(registryPath, good.replace("Alpha Product", "Alpha Renamed"));
  const recovered = await sidebarOnceMatching(send, ({ links }) => links.includes("Alpha Renamed"));
  return { before, failed, recovered };
}

test("a workspace page opened with ?product=beta keeps the last good product list and shows Could not refresh the product list while the registry cannot be read, then shows the changed list and clears the status when it recovers", async () => {
  const overrides = await portfolioOverrides();
  const server = await serveRepo(overrides);
  const url = workspaceUrl(server, "beta");

  const { before, failed, recovered } = await withPage(url, (send) => sidebarThroughRegistryFailureAndRecovery(send, overrides)).finally(() => server.close());

  assert.equal(before.text.includes("Could not refresh the product list"), false);
  assert.deepEqual(failed.links, ["Alpha Product", "Beta Product"]);
  assert.equal(failed.text.includes("Could not refresh the product list"), true);
  assert.deepEqual(recovered.links, ["Alpha Renamed", "Beta Product"]);
  assert.equal(recovered.text.includes("Could not refresh the product list"), false);
});

const REFRESH_STATUS_COUNT = `document.querySelectorAll('nav[aria-label="Products"] [role="status"]').length`;

const BACKED_OFF_RETRY_MS = 30000;

async function untilServed(served, count) {
  const deadline = Date.now() + BACKED_OFF_RETRY_MS * count;
  while (served.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
}

async function statusCountsAfterTwoServedSidebarFailures(send, overrides, served) {
  const registryPath = "/portfolio/portfolio.json";
  const good = overrides.get(registryPath);
  await evaluate(WORKSPACE_PAGE)(send);
  overrides.set(registryPath, null);
  await untilServed(served, 2);
  await sidebarOnceMatching(send, ({ text }) => /could not/i.test(text));
  const afterTwoFailures = await evaluate(REFRESH_STATUS_COUNT)(send);
  overrides.set(registryPath, good.replace("Alpha Product", "Alpha Renamed"));
  await sidebarOnceMatching(send, ({ links }) => links.includes("Alpha Renamed"), BACKED_OFF_RETRY_MS);
  const afterRecovery = await evaluate(REFRESH_STATUS_COUNT)(send);
  return { afterTwoFailures, afterRecovery };
}

test("a workspace page shows exactly one Could not refresh the product list status across two backed-off failed sidebar reads the server sees, and none after the registry recovers", async () => {
  const overrides = await portfolioOverrides();
  const server = await serveRepo(overrides);
  const served = [];
  server.on("request", (request) => {
    const failing = overrides.get("/portfolio/portfolio.json") === null;
    if (failing && request.headers["x-read"] === "sidebar" && request.url.startsWith("/portfolio/portfolio.json")) served.push(request.url);
  });
  const url = workspaceUrl(server, "beta");

  const { afterTwoFailures, afterRecovery } = await withPage(url, (send) => statusCountsAfterTwoServedSidebarFailures(send, overrides, served)).finally(() => server.close());

  assert.equal(afterTwoFailures, 1);
  assert.equal(afterRecovery, 0);
});

const MENU_STATE = pollUntilFound(`[...document.querySelectorAll("main section[aria-label='Roadmap']")]`, `() => {
  const shown = (element) => {
    if (!element) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const nav = document.querySelector('nav[aria-label="Products"]');
  const button = [...document.querySelectorAll("button")].find((candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent).trim() === "Products");
  const tree = document.getElementById("workspace-tree").getBoundingClientRect();
  return {
    buttonShown: shown(button),
    controls: button?.getAttribute("aria-controls") ?? null,
    controlsTheList: Boolean(button) && button.getAttribute("aria-controls") === nav.id,
    expanded: button?.getAttribute("aria-expanded") ?? null,
    listShown: shown(nav),
    treeFillsScreen: tree.left === 0 && tree.width === window.innerWidth,
  };
}`);

test("a workspace page opened with ?product=beta at phone width 390px shows a Products button with aria-controls the product list and aria-expanded false and the list hidden, and at desktop width shows no button and the list", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const phone = await withPage(url, evaluate(MENU_STATE), { width: 390 }).finally(() => server.close());
  const desktopServer = await serveRepo(await portfolioOverrides());
  const desktop = await withPage(workspaceUrl(desktopServer, "beta"), evaluate(MENU_STATE), { width: 1200 }).finally(() => desktopServer.close());

  assert.deepEqual(phone, { buttonShown: true, controls: "products", controlsTheList: true, expanded: "false", listShown: false, treeFillsScreen: true });
  assert.equal(desktop.buttonShown, false);
  assert.equal(desktop.listShown, true);
});

const MENU_SNAPSHOT = `(() => {
  const nav = document.querySelector('nav[aria-label="Products"]');
  const button = document.getElementById("products-menu");
  const box = nav.getBoundingClientRect();
  return {
    expanded: button.getAttribute("aria-expanded"),
    listShown: box.width > 0 && box.height > 0 && getComputedStyle(nav).display !== "none",
    focusInList: nav.contains(document.activeElement),
    focusOnButton: document.activeElement === button,
  };
})()`;

const ESCAPE = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };

test("a workspace page opened with ?product=beta at phone width 390px opens the product list with the Products button and moves focus into it, then closes it on Escape and returns focus to the button", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const states = await withPage(url, async (send) => {
    await evaluate(MENU_STATE)(send);
    const closed = await evaluate(MENU_SNAPSHOT)(send);
    await evaluate(`document.getElementById("products-menu").click()`)(send);
    const open = await evaluate(MENU_SNAPSHOT)(send);
    await press(send, ESCAPE);
    const closedAgain = await evaluate(MENU_SNAPSHOT)(send);
    return { closed, open, closedAgain };
  }, { width: 390 }).finally(() => server.close());

  assert.deepEqual(states.closed, { expanded: "false", listShown: false, focusInList: false, focusOnButton: false });
  assert.deepEqual(states.open, { expanded: "true", listShown: true, focusInList: true, focusOnButton: false });
  assert.deepEqual(states.closedAgain, { expanded: "false", listShown: false, focusInList: false, focusOnButton: true });
});

test("a workspace page opened with ?product=beta at phone width 390px closes the open product list and keeps focus on the Products button when the Products button is pressed a second time", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const states = await withPage(url, async (send) => {
    await evaluate(MENU_STATE)(send);
    const closed = await evaluate(MENU_SNAPSHOT)(send);
    await evaluate(`document.getElementById("products-menu").click()`)(send);
    const open = await evaluate(MENU_SNAPSHOT)(send);
    await evaluate(`document.getElementById("products-menu").focus(); document.getElementById("products-menu").click()`)(send);
    const closedAgain = await evaluate(MENU_SNAPSHOT)(send);
    return { closed, open, closedAgain };
  }, { width: 390 }).finally(() => server.close());

  assert.deepEqual(states.closed, { expanded: "false", listShown: false, focusInList: false, focusOnButton: false });
  assert.deepEqual(states.open, { expanded: "true", listShown: true, focusInList: true, focusOnButton: false });
  assert.deepEqual(states.closedAgain, { expanded: "false", listShown: false, focusInList: false, focusOnButton: true });
});

test("a workspace page opened with ?product=beta at phone width 390px keeps focus on the Pause motion button and aria-expanded false when Escape is pressed with the Products list closed", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const state = await withPage(url, async (send) => {
    await evaluate(MENU_STATE)(send);
    await evaluate(PAUSE_BUTTON_READY)(send);
    await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Pause motion").focus()`)(send);
    const focusedBefore = await evaluate(FOCUSED_IS_PAUSE_BUTTON)(send);
    await press(send, ESCAPE);
    return evaluate(`(() => ({
      focusedBefore: ${focusedBefore},
      expanded: document.getElementById("products-menu").getAttribute("aria-expanded"),
      focusOnPause: document.activeElement.textContent === "Pause motion",
      focusOnProducts: document.activeElement === document.getElementById("products-menu"),
    }))()`)(send);
  }, { width: 390 }).finally(() => server.close());

  assert.deepEqual(state, { focusedBefore: true, expanded: "false", focusOnPause: true, focusOnProducts: false });
});

const CLICK_ALPHA_IN_OPEN_LIST = `(() => {
  document.getElementById("products-menu").click();
  [...document.querySelectorAll('nav[aria-label="Products"] a')].find((link) => link.textContent === "Alpha Product").click();
})()`;

const AFTER_CHOOSING_IN_OPEN_LIST = `(() => {
  const heading = document.querySelector('main section[aria-label="Roadmap"] > h1');
  return {
    goal: heading?.textContent,
    expanded: document.getElementById("products-menu").getAttribute("aria-expanded"),
    listShown: getComputedStyle(document.querySelector('nav[aria-label="Products"]')).display !== "none",
    focusOnHeading: Boolean(heading) && document.activeElement === heading,
  };
})()`;

test("a workspace page opened with ?product=beta at phone width 390px closes the open product list, shows alpha's goal and moves focus to alpha's heading when Alpha Product is chosen", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, async (send) => {
    await evaluate(MENU_STATE)(send);
    await evaluate(CLICK_ALPHA_IN_OPEN_LIST)(send);
    const deadline = Date.now() + 5000;
    let state;
    while (state?.goal !== "Alpha goal" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = await evaluate(AFTER_CHOOSING_IN_OPEN_LIST)(send).catch(() => undefined);
    }
    return state;
  }, { width: 390 }).finally(() => server.close());

  assert.deepEqual(seen, { goal: "Alpha goal", expanded: "false", listShown: false, focusOnHeading: true });
});

const LISTEN_FOR_PAGE_ERRORS = `(() => {
  window.__pageErrors = [];
  window.addEventListener("error", (event) => window.__pageErrors.push(event.message));
  window.addEventListener("unhandledrejection", (event) => window.__pageErrors.push(String(event.reason)));
})()`;

const AFTER_CHOOSING_UNAVAILABLE = `(() => {
  const alert = document.querySelector('main [role="alert"]');
  return {
    alertText: alert?.textContent,
    expanded: document.getElementById("products-menu").getAttribute("aria-expanded"),
    listShown: getComputedStyle(document.querySelector('nav[aria-label="Products"]')).display !== "none",
    focusOnAlert: Boolean(alert) && document.activeElement === alert,
    pageErrors: window.__pageErrors,
  };
})()`;

test("a workspace page opened with ?product=beta at phone width 390px closes the open product list and moves focus to the not-available alert, raising no page error, when Alpha Product is chosen while the registry cannot be read", async () => {
  const overrides = await portfolioOverrides();
  const server = await serveRepo(overrides);
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, async (send) => {
    await evaluate(MENU_STATE)(send);
    await evaluate(LISTEN_FOR_PAGE_ERRORS)(send);
    overrides.set("/portfolio/portfolio.json", null);
    await evaluate(CLICK_ALPHA_IN_OPEN_LIST)(send);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return evaluate(AFTER_CHOOSING_UNAVAILABLE)(send);
  }, { width: 390 }).finally(() => server.close());

  assert.deepEqual(seen, { alertText: "The portfolio list could not be read", expanded: "false", listShown: false, focusOnAlert: true, pageErrors: [] });
});

const FOCUS_BETA_LINK = `[...document.querySelectorAll('nav[aria-label="Products"] a')].find((link) => link.textContent === "Beta Product").focus()`;

const FOCUS_REPORT = `(() => ({
  focusedProduct: document.activeElement?.getAttribute("data-product-id") ?? null,
  focusOnPause: document.activeElement?.textContent === "Pause motion",
}))()`;

async function focusAfterRedraws(send, overrides) {
  const registryPath = "/portfolio/portfolio.json";
  const good = overrides.get(registryPath);
  await evaluate(WORKSPACE_PAGE)(send);
  await evaluate(PAUSE_BUTTON_READY)(send);
  await evaluate(FOCUS_BETA_LINK)(send);
  overrides.set(registryPath, good.replace("Beta Product", "Beta Renamed"));
  await sidebarOnceMatching(send, ({ links }) => links.includes("Beta Renamed"));
  const onLink = await evaluate(FOCUS_REPORT)(send);
  await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Pause motion").focus()`)(send);
  overrides.set(registryPath, good.replace("Beta Product", "Beta Again"));
  await sidebarOnceMatching(send, ({ links }) => links.includes("Beta Again"));
  const onPause = await evaluate(FOCUS_REPORT)(send);
  return { onLink, onPause };
}

test("a workspace page opened with ?product=beta at desktop width 1200px keeps focus on Beta Product's new sidebar link after a refresh redraws the list, and leaves focus on the Pause motion button after a later redraw", async () => {
  const overrides = await portfolioOverrides();
  const server = await serveRepo(overrides);
  const url = workspaceUrl(server, "beta");

  const { onLink, onPause } = await withPage(url, (send) => focusAfterRedraws(send, overrides), { width: 1200 }).finally(() => server.close());

  assert.deepEqual(onLink, { focusedProduct: "beta", focusOnPause: false });
  assert.deepEqual(onPause, { focusedProduct: null, focusOnPause: true });
});

const ENTER = { key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 };

const FOCUS_ALPHA_LINK = `[...document.querySelectorAll('nav[aria-label="Products"] a')].find((link) => link.textContent === "Alpha Product").focus()`;

const AFTER_ENTER_ON_ALPHA_LINK = `(() => {
  const heading = document.querySelector('main section[aria-label="Roadmap"] > h1');
  return {
    goal: heading?.textContent,
    focusedProduct: document.activeElement?.getAttribute("data-product-id") ?? null,
    focusOnHeading: Boolean(heading) && document.activeElement === heading,
  };
})()`;

test("a workspace page opened with ?product=beta at desktop width 1200px shows alpha's goal and keeps focus on Alpha Product's sidebar link, not the tree heading, when Enter is pressed on that link", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    await evaluate(PAUSE_BUTTON_READY)(send);
    await evaluate(FOCUS_ALPHA_LINK)(send);
    await press(send, ENTER);
    const deadline = Date.now() + 5000;
    let state;
    while (state?.goal !== "Alpha goal" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = await evaluate(AFTER_ENTER_ON_ALPHA_LINK)(send).catch(() => undefined);
    }
    return state;
  }, { width: 1200 }).finally(() => server.close());

  assert.deepEqual(seen, { goal: "Alpha goal", focusedProduct: "alpha", focusOnHeading: false });
});

const SIDEWAYS_FIT = `(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)()`;

test("a workspace page opened with ?product=beta at phone width 390px never scrolls sideways, with the Products list closed or open", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const fits = await withPage(url, async (send) => {
    await evaluate(MENU_STATE)(send);
    const closedFits = await evaluate(SIDEWAYS_FIT)(send);
    await evaluate(`document.getElementById("products-menu").click()`)(send);
    const openFits = await evaluate(SIDEWAYS_FIT)(send);
    return { closedFits, openFits };
  }, { width: 390 }).finally(() => server.close());

  assert.deepEqual(fits, { closedFits: true, openFits: true });
});

const FOCUSED_NAME = `(() => document.activeElement?.textContent ?? null)()`;

test("a workspace page opened with ?product=beta at desktop width 1200px sends Tab through Alpha Product's link, Beta Product's link, then the Pause motion button, never the hidden Products button", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const stops = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    await evaluate(PAUSE_BUTTON_READY)(send);
    const seen = [];
    for (let presses = 0; presses < 3; presses++) {
      await press(send, TAB);
      seen.push(await evaluate(FOCUSED_NAME)(send));
    }
    return seen;
  }, { width: 1200 }).finally(() => server.close());

  assert.deepEqual(stops, ["Alpha Product", "Beta Product", "Pause motion"]);
});

async function workspaceLandmarksInChromeTree(send) {
  await send("Accessibility.enable");
  await evaluate(WORKSPACE_PAGE)(send);
  const nodes = (await send("Accessibility.getFullAXTree")).result.nodes.filter((axNode) => !axNode.ignored);
  const roleNamed = (role) => nodes.filter((axNode) => axNode.role?.value === role).map((axNode) => axNode.name?.value ?? "");
  const h1s = nodes.filter((axNode) => axNode.role?.value === "heading" && axNode.properties?.some((prop) => prop.name === "level" && prop.value.value === 1));
  return { h1Count: h1s.length, navigations: roleNamed("navigation"), mains: roleNamed("main"), buttons: roleNamed("button"), links: roleNamed("link") };
}

test("a workspace page opened with ?product=beta at desktop width 1200px has one h1, a navigation named Products, a main landmark, and a name on every visible button and link in Chrome's accessibility tree", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, workspaceLandmarksInChromeTree, { width: 1200 }).finally(() => server.close());

  assert.equal(seen.h1Count, 1);
  assert.deepEqual(seen.navigations, ["Products"]);
  assert.equal(seen.mains.length, 1);
  assert.deepEqual(seen.buttons, ["Pause motion"]);
  assert.deepEqual(seen.links, ["Alpha Product", "Beta Product"]);
});

const SPY_ON_ADDRESS_AND_ERRORS = `(() => {
  window.__replacedWith = [];
  window.__pageErrors = [];
  const replace = history.replaceState.bind(history);
  history.replaceState = (state, title, url) => { window.__replacedWith.push(String(url)); return replace(state, title, url); };
  window.addEventListener("error", (event) => window.__pageErrors.push(event.message));
})()`;

const BARE_WORKSPACE_NOW = `({
  search: location.search,
  replacedWith: window.__replacedWith,
  pageErrors: window.__pageErrors,
})`;

async function bareWorkspaceThenProductsButtonPressed(send, url) {
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SPY_ON_ADDRESS_AND_ERRORS });
  await send("Page.navigate", { url });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await evaluate(`document.getElementById("products-menu").click()`)(send);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return evaluate(BARE_WORKSPACE_NOW)(send);
}

test("a workspace page opened bare while the registry cannot be read keeps the address bare, makes no replaceState call with undefined, and raises no page error when the Products button is pressed at phone width 390px", async () => {
  const overrides = await portfolioOverrides();
  overrides.set("/portfolio/portfolio.json", null);
  const server = await serveRepo(overrides);
  const bareUrl = `http://127.0.0.1:${server.address().port}/strip/workspace.html`;

  const seen = await withPage(bareUrl, (send) => bareWorkspaceThenProductsButtonPressed(send, bareUrl), { width: 390 }).finally(() => server.close());

  assert.equal(seen.search, "");
  assert.deepEqual(seen.replacedWith, []);
  assert.deepEqual(seen.pageErrors, []);
});

function everyStatusRoadmap(today) {
  const card = (id, parent, status, order, extra = {}) => ({
    id, parent, problem: `Look ${id}`, status, statusSince: today, order, slices: ["look"],
    waitingOn: null, resumesAfter: null, doneOn: null, confirmedBy: null, ...extra,
  });
  return {
    version: 1, goal: "Look goal", wipLimit: 1, staleAfterDays: 3,
    problems: [
      card("lk-now", null, "now", 1),
      card("lk-now-part", "lk-now", "now", 1, { value: 3, size: 2 }),
      card("lk-next", null, "next", 2, { value: 3, size: 2 }),
      card("lk-blocked", null, "blocked", 3, { waitingOn: "a supplier" }),
      card("lk-paused", null, "paused", 4, { resumesAfter: "lk-next" }),
      card("lk-merged", null, "merged", 5),
      card("lk-done", null, "done", 6, { doneOn: today, confirmedBy: "Willem" }),
    ],
  };
}

const TREE_LOOK = pollUntilFound(`[...document.querySelectorAll('section[aria-label="Roadmap"] li > div')]`, `() => {
  document.documentElement.setAttribute("data-motion", "off");
  const tree = 'section[aria-label="Roadmap"]';
  const sides = ["top", "right", "bottom", "left"];
  const look = (element, pseudo) => {
    const style = getComputedStyle(element, pseudo);
    const border = sides.map((side) => [style.getPropertyValue("border-" + side + "-color"), style.getPropertyValue("border-" + side + "-style"), style.getPropertyValue("border-" + side + "-width")].join(" ")).join(" | ");
    return [style.fontFamily, style.fontSize, style.fontWeight, style.color, style.backgroundColor, border, style.borderRadius, style.padding, pseudo || window.innerWidth > 800 ? style.width : "text-sized"].join(" ; ");
  };
  const first = (selector) => document.querySelector(selector);
  const result = { goal: look(first(tree + " > h1")) };
  for (const status of ["done", "now", "next", "blocked", "paused", "merged"]) {
    const card = first(tree + ' li > div[data-status="' + status + '"]');
    result["card " + status] = look(card);
    result["status span " + status] = look(card.querySelector(":scope > span:first-child"));
  }
  result["rank p"] = look(first(tree + " li > div > p"));
  result["forecast group"] = look(first(tree + ' li > div > div[role="group"]'));
  result["li::before"] = look(first(tree + " li:nth-child(3)"), "::before");
  result["ul ul::before"] = look(first(tree + " ul ul"), "::before");
  return result;
}`);

const TREE_LOOK_BASELINE = {
  "1200": {
    "goal": "-apple-system, \"Segoe UI\", sans-serif ; 20px ; 700 ; rgb(232, 234, 237) ; rgb(43, 35, 71) ; rgb(138, 123, 192) solid 2px | rgb(138, 123, 192) solid 2px | rgb(138, 123, 192) solid 2px | rgb(138, 123, 192) solid 2px ; 8px ; 10px 14px ; 320px",
    "card done": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(126, 224, 160) solid 2px | rgb(126, 224, 160) solid 2px | rgb(126, 224, 160) solid 2px | rgb(126, 224, 160) solid 2px ; 8px ; 7px 9px ; 170px",
    "status span done": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(126, 224, 160) ; rgba(0, 0, 0, 0) ; rgb(126, 224, 160) none 0px | rgb(126, 224, 160) none 0px | rgb(126, 224, 160) none 0px | rgb(126, 224, 160) none 0px ; 0px ; 0px ; 148px",
    "card now": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(255, 209, 102) solid 2px | rgb(255, 209, 102) solid 2px | rgb(255, 209, 102) solid 2px | rgb(255, 209, 102) solid 2px ; 8px ; 7px 9px ; 170px",
    "status span now": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(255, 209, 102) ; rgba(0, 0, 0, 0) ; rgb(255, 209, 102) none 0px | rgb(255, 209, 102) none 0px | rgb(255, 209, 102) none 0px | rgb(255, 209, 102) none 0px ; 0px ; 0px ; 148px",
    "card next": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(138, 180, 255) dashed 2px | rgb(138, 180, 255) dashed 2px | rgb(138, 180, 255) dashed 2px | rgb(138, 180, 255) dashed 2px ; 8px ; 7px 9px ; 170px",
    "status span next": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(138, 180, 255) ; rgba(0, 0, 0, 0) ; rgb(138, 180, 255) none 0px | rgb(138, 180, 255) none 0px | rgb(138, 180, 255) none 0px | rgb(138, 180, 255) none 0px ; 0px ; 0px ; 148px",
    "card blocked": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(255, 143, 128) solid 2px | rgb(255, 143, 128) solid 2px | rgb(255, 143, 128) solid 2px | rgb(255, 143, 128) solid 2px ; 8px ; 7px 9px ; 170px",
    "status span blocked": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(255, 143, 128) ; rgba(0, 0, 0, 0) ; rgb(255, 143, 128) none 0px | rgb(255, 143, 128) none 0px | rgb(255, 143, 128) none 0px | rgb(255, 143, 128) none 0px ; 0px ; 0px ; 148px",
    "card paused": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(201, 167, 255) dotted 2px | rgb(201, 167, 255) dotted 2px | rgb(201, 167, 255) dotted 2px | rgb(201, 167, 255) dotted 2px ; 8px ; 7px 9px ; 170px",
    "status span paused": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(201, 167, 255) ; rgba(0, 0, 0, 0) ; rgb(201, 167, 255) none 0px | rgb(201, 167, 255) none 0px | rgb(201, 167, 255) none 0px | rgb(201, 167, 255) none 0px ; 0px ; 0px ; 148px",
    "card merged": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(95, 215, 230) double 4px | rgb(95, 215, 230) double 4px | rgb(95, 215, 230) double 4px | rgb(95, 215, 230) double 4px ; 8px ; 7px 9px ; 170px",
    "status span merged": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(95, 215, 230) ; rgba(0, 0, 0, 0) ; rgb(95, 215, 230) none 0px | rgb(95, 215, 230) none 0px | rgb(95, 215, 230) none 0px | rgb(95, 215, 230) none 0px ; 0px ; 0px ; 144px",
    "rank p": "-apple-system, \"Segoe UI\", sans-serif ; 12px ; 600 ; rgb(232, 234, 237) ; rgba(0, 0, 0, 0) ; rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px ; 0px ; 0px ; 148px",
    "forecast group": "-apple-system, \"Segoe UI\", sans-serif ; 12px ; 400 ; rgb(169, 176, 187) ; rgba(0, 0, 0, 0) ; rgb(107, 114, 128) dashed 1px | rgb(169, 176, 187) none 0px | rgb(169, 176, 187) none 0px | rgb(169, 176, 187) none 0px ; 0px ; 6px 0px 0px ; 148px",
    "li::before": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgba(0, 0, 0, 0) ; rgb(107, 114, 128) solid 2px | rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px ; 0px ; 0px ; 91px",
    "ul ul::before": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgba(0, 0, 0, 0) ; rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px | rgb(107, 114, 128) solid 2px ; 0px ; 0px ; 0px"
  },
  "390": {
    "goal": "-apple-system, \"Segoe UI\", sans-serif ; 20px ; 700 ; rgb(232, 234, 237) ; rgb(43, 35, 71) ; rgb(138, 123, 192) solid 2px | rgb(138, 123, 192) solid 2px | rgb(138, 123, 192) solid 2px | rgb(138, 123, 192) solid 2px ; 8px ; 10px 14px ; text-sized",
    "card done": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(126, 224, 160) solid 2px | rgb(126, 224, 160) solid 2px | rgb(126, 224, 160) solid 2px | rgb(126, 224, 160) solid 2px ; 8px ; 7px 9px ; text-sized",
    "status span done": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(126, 224, 160) ; rgba(0, 0, 0, 0) ; rgb(126, 224, 160) none 0px | rgb(126, 224, 160) none 0px | rgb(126, 224, 160) none 0px | rgb(126, 224, 160) none 0px ; 0px ; 0px ; text-sized",
    "card now": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(255, 209, 102) solid 2px | rgb(255, 209, 102) solid 2px | rgb(255, 209, 102) solid 2px | rgb(255, 209, 102) solid 2px ; 8px ; 7px 9px ; text-sized",
    "status span now": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(255, 209, 102) ; rgba(0, 0, 0, 0) ; rgb(255, 209, 102) none 0px | rgb(255, 209, 102) none 0px | rgb(255, 209, 102) none 0px | rgb(255, 209, 102) none 0px ; 0px ; 0px ; text-sized",
    "card next": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(138, 180, 255) dashed 2px | rgb(138, 180, 255) dashed 2px | rgb(138, 180, 255) dashed 2px | rgb(138, 180, 255) dashed 2px ; 8px ; 7px 9px ; text-sized",
    "status span next": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(138, 180, 255) ; rgba(0, 0, 0, 0) ; rgb(138, 180, 255) none 0px | rgb(138, 180, 255) none 0px | rgb(138, 180, 255) none 0px | rgb(138, 180, 255) none 0px ; 0px ; 0px ; text-sized",
    "card blocked": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(255, 143, 128) solid 2px | rgb(255, 143, 128) solid 2px | rgb(255, 143, 128) solid 2px | rgb(255, 143, 128) solid 2px ; 8px ; 7px 9px ; text-sized",
    "status span blocked": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(255, 143, 128) ; rgba(0, 0, 0, 0) ; rgb(255, 143, 128) none 0px | rgb(255, 143, 128) none 0px | rgb(255, 143, 128) none 0px | rgb(255, 143, 128) none 0px ; 0px ; 0px ; text-sized",
    "card paused": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(201, 167, 255) dotted 2px | rgb(201, 167, 255) dotted 2px | rgb(201, 167, 255) dotted 2px | rgb(201, 167, 255) dotted 2px ; 8px ; 7px 9px ; text-sized",
    "status span paused": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(201, 167, 255) ; rgba(0, 0, 0, 0) ; rgb(201, 167, 255) none 0px | rgb(201, 167, 255) none 0px | rgb(201, 167, 255) none 0px | rgb(201, 167, 255) none 0px ; 0px ; 0px ; text-sized",
    "card merged": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgb(31, 35, 42) ; rgb(95, 215, 230) double 4px | rgb(95, 215, 230) double 4px | rgb(95, 215, 230) double 4px | rgb(95, 215, 230) double 4px ; 8px ; 7px 9px ; text-sized",
    "status span merged": "-apple-system, \"Segoe UI\", sans-serif ; 11px ; 700 ; rgb(95, 215, 230) ; rgba(0, 0, 0, 0) ; rgb(95, 215, 230) none 0px | rgb(95, 215, 230) none 0px | rgb(95, 215, 230) none 0px | rgb(95, 215, 230) none 0px ; 0px ; 0px ; text-sized",
    "rank p": "-apple-system, \"Segoe UI\", sans-serif ; 12px ; 600 ; rgb(232, 234, 237) ; rgba(0, 0, 0, 0) ; rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px ; 0px ; 0px ; text-sized",
    "forecast group": "-apple-system, \"Segoe UI\", sans-serif ; 12px ; 400 ; rgb(169, 176, 187) ; rgba(0, 0, 0, 0) ; rgb(107, 114, 128) dashed 1px | rgb(169, 176, 187) none 0px | rgb(169, 176, 187) none 0px | rgb(169, 176, 187) none 0px ; 0px ; 6px 0px 0px ; text-sized",
    "li::before": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgba(0, 0, 0, 0) ; rgb(107, 114, 128) solid 2px | rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px ; 0px ; 0px ; 50%",
    "ul ul::before": "-apple-system, \"Segoe UI\", sans-serif ; 15px ; 400 ; rgb(232, 234, 237) ; rgba(0, 0, 0, 0) ; rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px | rgb(232, 234, 237) none 0px | rgb(107, 114, 128) solid 2px ; 0px ; 0px ; auto"
  }
};

test("the discovery tree's computed look on a workspace page opened with ?product=beta matches the recorded baseline at 1200px, 390px", async () => {
  const overrides = await portfolioOverrides();
  const today = new Date().toISOString().slice(0, 10);
  const roadmap = everyStatusRoadmap(today);
  overrides.set("/products/beta/roadmap/roadmap.json", JSON.stringify(roadmap));
  overrides.set("/products/beta/roadmap/decisions.jsonl", fixtureLog(roadmap, today));
  const server = await serveRepo(overrides);
  const url = workspaceUrl(server, "beta");

  const looks = {};
  for (const width of [1200, 390]) looks[width] = await withPage(url, evaluate(TREE_LOOK), { width });
  server.close();

  assert.deepEqual(looks, TREE_LOOK_BASELINE);
});

const OPEN_ROW_EDGE = `(() => {
  const probe = document.body.appendChild(document.createElement("i"));
  probe.style.color = "Highlight";
  const highlight = getComputedStyle(probe).color;
  probe.remove();
  const rows = [...document.querySelectorAll('nav[aria-label="Products"] li')].map((row) => {
    const style = getComputedStyle(row);
    return {
      open: row.querySelector('a[aria-current="page"]') !== null,
      outline: [style.outlineStyle, style.outlineColor, style.outlineWidth].join(" "),
      border: style.borderTopWidth,
      height: row.getBoundingClientRect().height,
    };
  });
  return { highlight, rows };
})()`;

const FOCUS_RING = `(() => {
  const focused = document.activeElement;
  const ring = getComputedStyle(focused);
  const row = focused.closest("li");
  return {
    name: focused.textContent,
    style: ring.outlineStyle,
    color: ring.outlineColor,
    width: parseFloat(ring.outlineWidth),
    offset: parseFloat(ring.outlineOffset),
    rowEdge: row && focused.closest("nav") ? parseFloat(getComputedStyle(row).outlineWidth) : null,
  };
})()`;

const RING = { style: "solid", color: "rgb(20, 184, 165)" };

async function focusRingsAfterTabbing(send, presses) {
  const seen = [];
  for (let count = 0; count < presses; count++) {
    await press(send, TAB);
    seen.push(await evaluate(FOCUS_RING)(send));
  }
  return seen;
}

async function focusRingAfterMouseClickOnPause(send) {
  const centre = await evaluate(`(() => {
    const box = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "Pause motion").getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`)(send);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, ...centre, button: "left", clickCount: 1 });
  }
  return evaluate(FOCUS_RING)(send);
}

test("a workspace page opened with ?product=beta draws a var(--focus-ring) ring of at least 2px with a positive offset on every Tab-focused sidebar link, Pause motion and Products button at 1200px and 390px, beside the open row's 1px edge, and none after a mouse click", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const desktop = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    await evaluate(PAUSE_BUTTON_READY)(send);
    const tabbed = await focusRingsAfterTabbing(send, 3);
    await send("Runtime.evaluate", { expression: "document.activeElement.blur()" });
    return { tabbed, clicked: await focusRingAfterMouseClickOnPause(send) };
  }, { width: 1200 }).finally(() => server.close());
  const phoneServer = await serveRepo(await portfolioOverrides());
  const phone = await withPage(workspaceUrl(phoneServer, "beta"), async (send) => {
    await evaluate(MENU_STATE)(send);
    const button = await focusRingsAfterTabbing(send, 1);
    await press(send, ENTER);
    const opened = await evaluate(FOCUS_RING)(send);
    return [...button, opened, ...(await focusRingsAfterTabbing(send, 1))];
  }, { width: 390 }).finally(() => phoneServer.close());

  const ringed = [...desktop.tabbed, ...phone];
  assert.deepEqual(ringed.map((stop) => stop.name), ["Alpha Product", "Beta Product", "Pause motion", "Products", "Alpha Product", "Beta Product"]);
  assert.deepEqual(ringed.map((stop) => [stop.style, stop.color]), ringed.map(() => [RING.style, RING.color]));
  assert.ok(ringed.every((stop) => stop.width >= 2 && stop.offset > 0), JSON.stringify(ringed));
  const openRow = desktop.tabbed[1];
  assert.ok(openRow.rowEdge === 1 && openRow.width > openRow.rowEdge && openRow.offset > 0, JSON.stringify(openRow));
  assert.equal(desktop.clicked.name, "Pause motion");
  assert.equal(desktop.clicked.style, "none");
});

test("a workspace page opened with ?product=beta at desktop width 1200px in forced-colors mode draws the open product's row edge as a Highlight outline with no border, and every row is as tall as the others", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const { highlight, rows } = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    return evaluate(OPEN_ROW_EDGE)(send);
  }, { width: 1200, media: { name: "forced-colors", value: "active" } }).finally(() => server.close());

  assert.deepEqual(rows.map((row) => [row.open, row.outline]), [[false, rows[0].outline], [true, `solid ${highlight} 1px`]]);
  assert.match(rows[0].outline, /^none /);
  assert.deepEqual(rows.map((row) => row.border), ["0px", "0px"]);
  assert.equal(rows[0].height, rows[1].height);
});

const ROW_FILL = `(() => [...document.querySelectorAll('nav[aria-label="Products"] li')].map((row) => getComputedStyle(row).backgroundColor))()`;

async function rowFillsWhileHovering(send, index) {
  const centre = await evaluate(`(() => {
    const box = document.querySelectorAll('nav[aria-label="Products"] li')[${index}].getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`)(send);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...centre });
  return evaluate(ROW_FILL)(send);
}

test("a workspace page opened with ?product=beta at desktop width 1200px fills only a hovered sidebar row that is not open with the row-hover colour, and the open row keeps its accent fill when hovered", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    const none = await evaluate(ROW_FILL)(send);
    const alphaHovered = await rowFillsWhileHovering(send, 0);
    const betaHovered = await rowFillsWhileHovering(send, 1);
    return { none, alphaHovered, betaHovered };
  }, { width: 1200 }).finally(() => server.close());

  const clear = "rgba(0, 0, 0, 0)";
  const hover = "rgb(16, 16, 21)";
  const open = "rgb(7, 23, 25)";
  assert.deepEqual(seen, { none: [clear, open], alphaHovered: [hover, open], betaHovered: [clear, open] });
});

async function clickAt(send, point) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  }
}

const ROW_BOX = (index, inner) => `document.querySelectorAll('nav[aria-label="Products"] li')[${index}]${inner}.getBoundingClientRect()`;

const ROW_SPOTS = {
  goal: (index) => `(() => { const box = ${ROW_BOX(index, '.querySelector("p")')}; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`,
  padding: (index) => `(() => { const box = ${ROW_BOX(index, "")}; return { x: box.x + box.width / 2, y: box.y + 2 }; })()`,
};

const OPEN_PRODUCT = `(() => ({
  search: location.search,
  goal: document.querySelector('main section[aria-label="Roadmap"] > h1')?.textContent,
  current: [...document.querySelectorAll('nav[aria-label="Products"] a[aria-current="page"]')].map((link) => link.textContent),
}))()`;

async function openedByClick(send, index, where, expectedSearch) {
  await clickAt(send, await evaluate(ROW_SPOTS[where](index))(send));
  const deadline = Date.now() + 5000;
  let seen = await evaluate(OPEN_PRODUCT)(send);
  while (seen.search !== expectedSearch && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    seen = await evaluate(OPEN_PRODUCT)(send);
  }
  return seen;
}

const ROW_TAB_STOPS = `(() => [...document.querySelectorAll('nav[aria-label="Products"] li')].map((row) => row.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').length))()`;

test("a workspace page opened with ?product=beta at desktop width 1200px opens a product when a real mouse click lands on its row's goal text or its padding near the row edge, while each row keeps the link as its only Tab stop and the link's accessible name", async () => {
  const server = await serveRepo(await portfolioOverrides());
  const url = workspaceUrl(server, "beta");

  const seen = await withPage(url, async (send) => {
    await evaluate(WORKSPACE_PAGE)(send);
    const byGoal = await openedByClick(send, 0, "goal", "?product=alpha");
    const byPadding = await openedByClick(send, 1, "padding", "?product=beta");
    const tabStops = await evaluate(ROW_TAB_STOPS)(send);
    const { links } = await workspaceLandmarksInChromeTree(send);
    return { byGoal, byPadding, tabStops, links };
  }, { width: 1200 }).finally(() => server.close());

  assert.deepEqual(seen.byGoal, { search: "?product=alpha", goal: "Alpha goal", current: ["Alpha Product"] });
  assert.deepEqual(seen.byPadding, { search: "?product=beta", goal: "Beta goal", current: ["Beta Product"] });
  assert.deepEqual(seen.tabStops, [1, 1]);
  assert.deepEqual(seen.links, ["Alpha Product", "Beta Product"]);
});

async function manyProductsOverrides(count) {
  const overrides = await portfolioOverrides();
  const today = new Date().toISOString().slice(0, 10);
  const ids = Array.from({ length: count }, (_, index) => `p${index}`);
  const product = (id) => ({ id, name: `Product ${id}`, status: "active", roadmapRoot: `products/${id}/roadmap` });
  overrides.set("/portfolio/portfolio.json", JSON.stringify({ version: 1, products: ids.map(product) }));
  const roadmap = fixtureRoadmap(today);
  const tall = Array.from({ length: 40 }, (_, index) => ({ ...roadmap.problems[2], id: `tall-${index}`, problem: `Tall card ${index}`, parent: index ? `tall-${index - 1}` : null, order: index ? 1 : 3, ...(index < 39 && { value: undefined, size: undefined }) }));
  roadmap.problems.push(...tall);
  for (const id of ids) {
    overrides.set(`/products/${id}/roadmap/roadmap.json`, JSON.stringify(roadmap));
    overrides.set(`/products/${id}/roadmap/decisions.jsonl`, fixtureLog(roadmap, today));
    overrides.set(`/products/${id}/roadmap/pace.json`, "{}");
  }
  return overrides;
}

const PRODUCTS_LISTED = (count) => pollUntilFound(`document.querySelectorAll('nav[aria-label="Products"] a').length >= ${count} && document.querySelector("main section[aria-label='Roadmap']") ? [1] : []`, `() => true`);

const PINNED_SIDEBAR = `(async () => {
  const nav = document.querySelector('nav[aria-label="Products"]');
  window.scrollTo(0, 600);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const box = nav.getBoundingClientRect();
  const windowScroll = window.scrollY;
  nav.scrollTop = 200;
  return {
    windowScroll, top: box.top, fillsViewport: box.height === innerHeight,
    overflows: nav.scrollHeight > nav.clientHeight, navScrolled: nav.scrollTop > 0, windowMoved: window.scrollY !== windowScroll,
    contained: getComputedStyle(nav).overscrollBehaviorY === "contain",
  };
})()`;

test("a workspace page with 40 products at desktop width 1280px keeps the Products sidebar pinned at the viewport top at full height after the window scrolls 600px, and scrolling the sidebar moves only the sidebar", async () => {
  const server = await serveRepo(await manyProductsOverrides(40));
  const url = workspaceUrl(server, "p0");

  const seen = await withPage(url, async (send) => {
    await evaluate(PRODUCTS_LISTED(40))(send);
    return evaluate(PINNED_SIDEBAR)(send);
  }, { width: 1280 }).finally(() => server.close());

  assert.equal(seen.windowScroll, 600, "the page is too short to scroll 600px");
  assert.deepEqual(
    [seen.top, seen.fillsViewport, seen.overflows, seen.navScrolled, seen.windowMoved, seen.contained],
    [0, true, true, true, false, true],
  );
});

const FOCUS_IN_SIDEBAR = `(() => {
  const nav = document.querySelector('nav[aria-label="Products"]');
  const focused = document.activeElement;
  const box = focused.getBoundingClientRect();
  const navBox = nav.getBoundingClientRect();
  return { inNav: nav.contains(focused), href: focused.getAttribute("href"), inside: box.top >= navBox.top && box.bottom <= navBox.bottom };
})()`;

test("a workspace page with 40 products at desktop width 1280px sends Tab through every product link in order, scrolls a focused link near the bottom into view inside the Products sidebar, and the next Tab leaves the sidebar for main", async () => {
  const server = await serveRepo(await manyProductsOverrides(40));
  const url = workspaceUrl(server, "p0");

  const seen = await withPage(url, async (send) => {
    await evaluate(PRODUCTS_LISTED(40))(send);
    const focusedLinks = [];
    for (let presses = 0; presses < 40; presses++) {
      await press(send, TAB);
      focusedLinks.push(await evaluate(FOCUS_IN_SIDEBAR)(send));
    }
    await press(send, TAB);
    return { focusedLinks, afterLast: await evaluate(FOCUS_IN_SIDEBAR)(send) };
  }, { width: 1280 }).finally(() => server.close());

  const expectedHrefs = Array.from({ length: 40 }, (_, index) => `workspace.html?product=p${index}`);
  assert.deepEqual(seen.focusedLinks.map((link) => link.href), expectedHrefs);
  assert.equal(seen.focusedLinks.filter((link) => !link.inside).length, 0, "a focused link sat outside the sidebar's box");
  assert.equal(seen.afterLast.inNav, false, "Tab stayed trapped in the sidebar");
});

const NARROW_PAGE_AT_BOTTOM = `(async () => {
  const nav = document.querySelector('nav[aria-label="Products"]');
  const root = document.scrollingElement;
  window.scrollTo(0, root.scrollHeight);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const style = getComputedStyle(nav);
  return {
    scrollsSideways: root.scrollWidth > innerWidth,
    sticky: style.position === "sticky",
    overscroll: style.overscrollBehaviorY,
    taller: root.scrollHeight > innerHeight,
    atBottom: Math.ceil(window.scrollY + innerHeight) >= root.scrollHeight,
    contentEndShown: document.querySelector("main").getBoundingClientRect().bottom <= innerHeight + 1,
  };
})()`;

test("a workspace page with 40 products at widths 800px and 360px never scrolls sideways, leaves the Products sidebar neither sticky nor scroll-contained, and lets the window scroll to the bottom of the page content", async () => {
  const server = await serveRepo(await manyProductsOverrides(40));
  const url = workspaceUrl(server, "p0");

  const seen = [];
  for (const size of [{ width: 800, height: 900 }, { width: 360, height: 800 }]) {
    seen.push(await withPage(url, async (send) => {
      await evaluate(PRODUCTS_LISTED(40))(send);
      return evaluate(NARROW_PAGE_AT_BOTTOM)(send);
    }, size));
  }
  server.close();

  const expected = { scrollsSideways: false, sticky: false, overscroll: "auto", taller: true, atBottom: true, contentEndShown: true };
  assert.deepEqual(seen, [expected, expected]);
});
