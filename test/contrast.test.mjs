import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { contrastRatio, colourLiteralsOutsideRoot, failingPairs, resolvePairs } from "./support/contrast.mjs";
import { styledPage } from "./support/styled-page.mjs";

test("contrastRatio of white on black is 21", () => {
  const ratio = contrastRatio("#ffffff", "#000000");

  assert.equal(ratio, 21);
});

test("failingPairs reports a pair below 4.5:1 and not one just above it", () => {
  const pairs = [["#767676", "#ffffff"], ["#777777", "#ffffff"]];

  const failing = failingPairs(pairs);

  assert.deepEqual(failing.map(({ fg, bg }) => [fg, bg]), [["#777777", "#ffffff"]]);
});

test("resolvePairs turns token names from :root into hex pairs", () => {
  const html = "<style>body { color: #123456; } :root { --ink: #eeeeee; --bg: #101010; --edge: #445566; }</style>";

  const pairs = resolvePairs(html, [["--ink", "--bg"], ["--edge", "--bg"]]);

  assert.deepEqual(pairs, [["#eeeeee", "#101010"], ["#445566", "#101010"]]);
});

test("resolvePairs throws naming a token that :root does not define", () => {
  const html = "<style>:root { --ink: #eeeeee; --bg: #101010; }</style>";

  const resolve = () => resolvePairs(html, [["--ink", "--bg"], ["--ghost", "--bg"]]);

  assert.throws(resolve, /--ghost/);
});

test("resolvePairs throws naming a token whose value is not six-digit hex", () => {
  const html = "<style>:root { --ink: #eeeeeee; --bg: #101010; }</style>";

  const resolve = () => resolvePairs(html, [["--ink", "--bg"]]);

  assert.throws(resolve, /--ink.*six-digit hex/);
});

async function readPage() {
  return styledPage("index.html");
}

test("the page background is dark by default", async () => {
  const page = await readPage();

  const [[, background]] = resolvePairs(page, [["--ink", "--bg"]]);

  assert.ok(contrastRatio(background, "#000000") < contrastRatio(background, "#ffffff"));
});

const PAGE_TEXT_PAIRS = [
  ["--ink", "--bg"],
  ["--muted", "--bg"],
  ["--ink", "--card"],
  ["--muted", "--card"],
  ["--ink", "--title-bg"],
  ["--ink", "--alert-bg"],
];

test("every text and background pair on the page meets 4.5:1", async () => {
  const page = await readPage();

  const failing = failingPairs(resolvePairs(page, PAGE_TEXT_PAIRS));

  assert.deepEqual(failing, []);
});

test("colourLiteralsOutsideRoot lists literals in rules and skips :root and var()", () => {
  const html = `<style>
    :root { --ink: #eeeeee; }
    a { color: #123456; border: 1px solid rgb(0, 0, 0); background: hsl(10, 20%, 30%); outline: var(--ink); fill: #abc; }
  </style>`;

  const literals = colourLiteralsOutsideRoot(html);

  assert.deepEqual(literals, ["#123456", "rgb(0, 0, 0)", "hsl(10, 20%, 30%)", "#abc"]);
});

test("the page has no colour literals outside :root", async () => {
  const page = await readPage();

  const literals = colourLiteralsOutsideRoot(page);

  assert.deepEqual(literals, []);
});

test("the solved, solving-now and next status colours are three different colours that each meet 4.5:1 on the card", async () => {
  const page = await readPage();

  const pairs = resolvePairs(page, [["--status-solved", "--card"], ["--status-now", "--card"], ["--status-next", "--card"]]);

  assert.deepEqual({ failing: failingPairs(pairs), distinctColours: new Set(pairs.map(([colour]) => colour)).size }, { failing: [], distinctColours: 3 });
});

test("each of the done, now and next cards gets its status colour from a rule that selects it by data-status", async () => {
  const page = await readPage();
  const rule = ({ status, selectorTail, property, token }) =>
    new RegExp(`\\[data-status="${status}"\\]${selectorTail} \\{[^}]*${property}: var\\(${token}\\)`).test(page);
  const statusTokens = [["done", "--status-solved"], ["now", "--status-now"], ["next", "--status-next"]];

  const missing = statusTokens.flatMap(([status, token]) => [
    ...(rule({ status, selectorTail: "", property: "border-color", token }) ? [] : [`${status} border`]),
    ...(rule({ status, selectorTail: " > span:first-child", property: "color", token }) ? [] : [`${status} words`]),
  ]);

  assert.deepEqual(missing, []);
});

test("the blocked status colour meets 4.5:1 on the card and differs from the solved, now and next colours", async () => {
  const page = await readPage();
  const tokens = ["--status-blocked", "--status-solved", "--status-now", "--status-next"];

  const pairs = resolvePairs(page, tokens.map((token) => [token, "--card"]));

  const [blocked, ...others] = pairs.map(([colour]) => colour);
  assert.deepEqual({ failing: failingPairs([pairs[0]]), clashes: others.filter((colour) => colour === blocked) }, { failing: [], clashes: [] });
});

function statusDeclarations(page, status, selectorTail) {
  return new RegExp(`\\[data-status="${status}"\\]${selectorTail} \\{([^}]*)\\}`).exec(page)?.[1] ?? "";
}

test("a blocked card gets its colour, its words colour and a highlight ring from rules that select it by data-status", async () => {
  const page = await readPage();
  const card = statusDeclarations(page, "blocked", "");
  const words = statusDeclarations(page, "blocked", " > span:first-child");

  const present = {
    border: card.includes("border-color: var(--status-blocked)"),
    ring: /box-shadow: 0 0 0 2px var\(--status-blocked\)/.test(card),
    words: words.includes("color: var(--status-blocked)"),
  };

  assert.deepEqual(present, { border: true, ring: true, words: true });
});

test("the paused and merged status colours meet 4.5:1 on the card and differ from the other four status colours", async () => {
  const page = await readPage();
  const tokens = ["--status-paused", "--status-merged", "--status-solved", "--status-now", "--status-next", "--status-blocked"];

  const pairs = resolvePairs(page, tokens.map((token) => [token, "--card"]));

  const colours = pairs.map(([colour]) => colour);
  assert.deepEqual({ failing: failingPairs(pairs.slice(0, 2)), distinctColours: new Set(colours).size }, { failing: [], distinctColours: 6 });
});

test("a paused card gets a dotted border and a merged card a double border, each with its colour and words colour, from rules that select them by data-status", async () => {
  const page = await readPage();

  const present = [["paused", "dotted"], ["merged", "double"]].map(([status, shape]) => ({
    status,
    border: statusDeclarations(page, status, "").includes(`border-color: var(--status-${status})`),
    shape: statusDeclarations(page, status, "").includes(`border-style: ${shape}`),
    words: statusDeclarations(page, status, " > span:first-child").includes(`color: var(--status-${status})`),
  }));

  assert.deepEqual(present, [
    { status: "paused", border: true, shape: true, words: true },
    { status: "merged", border: true, shape: true, words: true },
  ]);
});

test("a paused card's pause mark takes the paused words colour, which meets 4.5:1 on the card, because no rule recolours the mark", async () => {
  const page = await readPage();

  const words = statusDeclarations(page, "paused", " > span:first-child");
  const recolouredMark = /\[data-status="paused"\][^{]*(role|aria-label|span span)[^{]*\{/.test(page);

  assert.deepEqual(
    { inherited: words.includes("color: var(--status-paused)"), recolouredMark, failing: failingPairs(resolvePairs(page, [["--status-paused", "--card"]])) },
    { inherited: true, recolouredMark: false, failing: [] },
  );
});

test("a now card has a highlight ring in the now colour and a next card has a dashed border", async () => {
  const page = await readPage();

  const shapes = {
    nowRing: /box-shadow: 0 0 0 2px var\(--status-now\)/.test(statusDeclarations(page, "now", "")),
    nextDashed: statusDeclarations(page, "next", "").includes("border-style: dashed"),
  };

  assert.deepEqual(shapes, { nowRing: true, nextDashed: true });
});

test("a card marked data-pulse runs a 2s animation from a rule that selects it", async () => {
  const page = await readPage();

  const pulseRule = /\[data-pulse\][^{]*\{([^}]*)\}/.exec(page)?.[1] ?? "";
  const nowRule = /div\[data-status="now"\] \{([^}]*)\}/.exec(page)?.[1] ?? "";

  assert.deepEqual({ pulse: /animation:[^;]*\b2s\b/.test(pulseRule), nowRingStatic: !nowRule.includes("animation") }, { pulse: true, nowRingStatic: true });
});

test("the data-pulse rule's border-spin animation lasts 3.5s", async () => {
  const page = await readPage();

  const pulseRule = /\[data-pulse\][^{]*\{([^}]*)\}/.exec(page)?.[1] ?? "";
  const borderSpinDuration = /border-spin\s+([\d.]+s)/.exec(pulseRule)?.[1];

  assert.equal(borderSpinDuration, "3.5s");
});

test("motion preferences turn the pulse animation off", async () => {
  const page = await readPage();

  const reducedBlock = /@media \(prefers-reduced-motion: reduce\)\s*\{(.*?\})\s*\}/s.exec(page)?.[1] ?? "";
  const reducedRule = /\[data-pulse\][^{]*\{([^}]*)\}/.exec(reducedBlock)?.[1] ?? "";
  const motionOffRule = /:root\[data-motion="off"\][^{,]*\[data-pulse\][^{]*\{([^}]*)\}/.exec(page)?.[1] ?? "";

  assert.deepEqual({ reducedMedia: /animation:\s*none\b/.test(reducedRule), motionOff: /animation:\s*none\b/.test(motionOffRule) }, { reducedMedia: true, motionOff: true });
});

test("the animation a data-pulse card names is defined by a @keyframes rule in the page", async () => {
  const page = await readPage();

  const pulseRule = /\[data-pulse\][^{]*\{([^}]*)\}/.exec(page)?.[1] ?? "";
  const named = /animation:\s*([\w-]+)/.exec(pulseRule)?.[1] ?? "";
  const keyframeNames = [...page.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);

  assert.deepEqual({ named: named !== "", defined: keyframeNames.includes(named) }, { named: true, defined: true });
});

test("the pulse-ring keyframes have a 50% stop whose halo is at least 6px wide and at least 50% opaque", async () => {
  const page = await readPage();

  const body = /@keyframes pulse-ring\s*\{(.*?\})\s*\}/s.exec(page)?.[1] ?? "";
  const midStop = /50%\s*\{([^}]*)\}/.exec(body)?.[1] ?? "";
  const halo = /0 0 0 (\d+)px color-mix\(in srgb, var\(--status-now\) (\d+)%/.exec(midStop);

  assert.deepEqual({ has50: midStop !== "", wide: Number(halo?.[1]) >= 6, opaque: Number(halo?.[2]) >= 50 }, { has50: true, wide: true, opaque: true });
});

function colourRule(page, selector, background) {
  const escaped = selector.replace(/[[\]>]/g, "\\$&");
  const rule = new RegExp(`${escaped} \\{([^}]*)\\}`).exec(page)?.[1] ?? "";
  const token = /(?:^|[\s;])color: var\((--[a-z-]+)\)/.exec(rule)?.[1];
  const failing = token ? failingPairs(resolvePairs(page, [[token, background]])) : ["no colour rule"];
  return { rule, token, failing };
}

test("an alert paragraph under the page gets the ink colour, which meets 4.5:1 on the alert background", async () => {
  const page = await readPage();

  const { token, failing } = colourRule(page, '#app > div > p[role="alert"]', "--alert-bg");

  assert.deepEqual({ token, failing }, { token: "--ink", failing: [] });
});

test("the Parked for later heading gets the ink colour, which meets 4.5:1 on the page background, and a 15px size", async () => {
  const page = await readPage();

  const { rule, token, failing } = colourRule(page, 'section[aria-label="Parked for later"] > h2', "--bg");

  assert.deepEqual({ token, failing, sized: rule.includes("font-size: 15px") }, { token: "--ink", failing: [], sized: true });
});

test("the card's rank line gets the ink colour, which meets 4.5:1 on the card, and a font size no larger than the card's text", async () => {
  const page = await readPage();

  const { rule, token, failing } = colourRule(page, 'section[aria-label="Roadmap"] li > div > p', "--card");

  const size = Number(/font-size: (\d+)px/.exec(rule)?.[1] ?? Infinity);
  assert.deepEqual({ token, failing, fitsCardText: size <= 15 }, { token: "--ink", failing: [], fitsCardText: true });
});

test("the visually hidden rule clips with clip-path inset(50%) and declares no deprecated clip", async () => {
  const page = await readPage();

  const rule = page.match(/\[data-visually-hidden\]\s*\{([^}]*)\}/)[1];

  assert.deepEqual({ clipPath: rule.includes("clip-path: inset(50%)"), noClip: !/(^|[\s;])clip\s*:/.test(rule) }, { clipPath: true, noClip: true });
});

test("the sidebar product links on the workspace page get the chrome ink colour, which meets 4.5:1 on the accent fill of the open-product row", async () => {
  const page = await readFile(new URL("../strip/workspace.html", import.meta.url), "utf8");

  const onFill = colourRule(page, 'nav[aria-label="Products"] a', "--accent-fill");

  assert.deepEqual({ token: onFill.token, failing: onFill.failing }, { token: "--chrome-ink", failing: [] });
});

test("the workspace chrome tokens meet 4.5:1 for ink and muted text on the chrome background and the accent fill, and 3:1 for the open-row outline and the focus ring on the chrome background", async () => {
  const page = await readFile(new URL("../strip/workspace.html", import.meta.url), "utf8");
  const textPairs = [["--chrome-ink", "--chrome-bg"], ["--chrome-ink", "--accent-fill"], ["--chrome-muted", "--chrome-bg"], ["--chrome-muted", "--accent-fill"]];
  const nonTextPairs = [["--accent-outline", "--chrome-bg"], ["--focus-ring", "--chrome-bg"]];

  const failing = {
    text: failingPairs(resolvePairs(page, textPairs)),
    nonText: resolvePairs(page, nonTextPairs).filter(([fg, bg]) => contrastRatio(fg, bg) < 3),
  };

  assert.deepEqual(failing, { text: [], nonText: [] });
});

test("the chrome muted text colour meets 4.5:1 on the page background, where the read-at bar and the Forecast and Parked boxes sit", async () => {
  const page = await readFile(new URL("../strip/workspace.html", import.meta.url), "utf8");
  const textPairs = [["--chrome-muted", "--bg"]];

  const failing = failingPairs(resolvePairs(page, textPairs));

  assert.deepEqual(failing, []);
});
