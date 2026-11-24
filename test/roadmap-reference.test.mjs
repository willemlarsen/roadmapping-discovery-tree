import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveRoadmapReference } from "./support/roadmap-reference.mjs";
import { styledPage } from "./support/styled-page.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const REFRESH =
  "The page look changed. Refresh the clickchain.ai share page reference " +
  "(__tests__/share/fixtures/roadmap-reference.json) to match, then update " +
  "test/fixtures/share-site/roadmap-reference.json here.";

test("the roadmap reference derived from src/render.js and strip/index.html matches the pinned copy the share page was built from", () => {
  const renderJs = read("../src/render.js");
  const indexHtml = styledPage("index.html");
  const { words, pausedMark, parkedHeading, borders } = JSON.parse(read("./fixtures/share-site/roadmap-reference.json"));
  const pinned = { words, pausedMark, parkedHeading, borders };

  const derived = deriveRoadmapReference(renderJs, indexHtml);
  const reworded = deriveRoadmapReference(renderJs.replace("Solving now", "Working now"), indexHtml);
  const redashed = deriveRoadmapReference(renderJs, indexHtml.replace("border-style: dotted", "border-style: dashed"));

  assert.deepStrictEqual(derived, pinned, REFRESH);
  assert.equal(reworded.words.now, "Working now");
  assert.equal(redashed.borders.paused.borderStyle, "dashed");
  assert.notDeepStrictEqual(reworded, pinned);
});
