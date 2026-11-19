import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const CHROME_SELECTORS = ['nav[aria-label="Products"]', "#read-at", "#products-menu", 'aria-label="Forecast inputs"', 'aria-label="Parked for later"'];
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b\d*\.?\d+px\b/;

function chromeLiteralsOutsideRoot(html) {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/:root\s*\{[^}]*\}/, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), body]);
  return rules
    .filter(([selector]) => CHROME_SELECTORS.some((chrome) => selector.includes(chrome)))
    .flatMap(([selector, body]) => body.split(";").map((declaration) => declaration.trim()).filter((declaration) => LITERAL.test(declaration)).map((declaration) => `${selector} { ${declaration} }`));
}

test("the chrome rules outside :root hold no colour or px literal", async () => {
  const page = await readFile(new URL("../strip/workspace.html", import.meta.url), "utf8");

  const offenders = chromeLiteralsOutsideRoot(page);

  assert.deepEqual(offenders, []);
});
