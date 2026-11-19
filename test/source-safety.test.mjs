import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOTS = ["src", "scripts", "strip"];
const HTML_SINK = /\b(innerHTML|outerHTML)\s*(\+|-|\*|\/|\|\||\?\?)?=(?!=)|insertAdjacentHTML\s*\(/;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(js|mjs|html)$/.test(path) ? [path] : [];
  });
}

test("no source file writes HTML through innerHTML, outerHTML or insertAdjacentHTML", () => {
  const files = ROOTS.flatMap(sourceFiles);
  assert.ok(files.length > 0, "found source files to scan");
  const offenders = files.filter((file) => HTML_SINK.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

const inlinePage = (statement) =>
  `<!doctype html>\n<script type="module">\n${statement}\n</script>\n`;

test("inline module scripts in html pages are scanned for HTML sinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "source-safety-"));
  const pages = {
    "inner.html": inlinePage("el.innerHTML = text;"),
    "outer.html": inlinePage("el.outerHTML = text;"),
    "adjacent.html": inlinePage('el.insertAdjacentHTML("beforeend", text);'),
    "clean.html": inlinePage("el.textContent = text;"),
  };
  Object.entries(pages).forEach(([name, html]) => writeFileSync(join(dir, name), html));

  const flagged = sourceFiles(dir).filter((file) => HTML_SINK.test(readFileSync(file, "utf8")));
  const realPages = sourceFiles("strip");
  const realFlagged = realPages.filter((file) => HTML_SINK.test(readFileSync(file, "utf8")));

  assert.deepEqual(flagged.map((file) => file.slice(dir.length + 1)).sort(), ["adjacent.html", "inner.html", "outer.html"]);
  assert.ok(realPages.includes(join("strip", "index.html")), "the real page is scanned");
  assert.deepEqual(realFlagged, []);
});

test("the real scan's file list covers the strip page, a src file and a scripts file", () => {
  const files = ROOTS.flatMap(sourceFiles);

  assert.ok(files.includes(join("strip", "index.html")), "strip page scanned");
  assert.ok(files.some((file) => file.startsWith(join("src", ""))), "a src file scanned");
  assert.ok(files.some((file) => file.startsWith(join("scripts", ""))), "a scripts file scanned");
});

const HREF_CALL = /\.href\s*=(?!=)|setAttribute\(\s*["'`]href["'`]/;
const HREF_ATTRIBUTE = /\bhref\s*=\s*\\?["'`]/;
const hrefOffenders = (text, isHtml) =>
  text.split("\n").filter((line) => {
    const sets = HREF_CALL.test(line) || (!isHtml && HREF_ATTRIBUTE.test(line));
    return sets && !/\bproductHref\(/.test(line);
  });

test("no src or strip file sets an href except through the productHref helper", () => {
  const files = ["src", "strip"].flatMap(sourceFiles);
  const real = files.flatMap((file) => hrefOffenders(readFileSync(file, "utf8"), file.endsWith(".html")).map((line) => `${file}: ${line.trim()}`));
  const sample = [
    'a.href = "index.html?product=" + id;',
    'a.setAttribute("href", "index.html?product=" + id);',
    "const html = `<a href=\"index.html?product=${id}\">x</a>`;",
    'a.setAttribute("href", productHref(id));',
    "if (location.href == base) go();",
  ].join("\n");

  const flagged = hrefOffenders(sample, false);

  assert.deepEqual(real, []);
  assert.equal(flagged.length, 3);
  assert.ok(flagged.every((line) => !line.includes("productHref")));
});
