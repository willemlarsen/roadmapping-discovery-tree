import { readFileSync } from "node:fs";

const STYLESHEET_LINK = /<link rel="stylesheet" href="([^"]+)">/g;

// A strip page as the browser styles it: each linked stylesheet in the strip folder is put in
// place of its link, so a check reads the page's own rules and the shared ones together.
export function styledPage(name) {
  const read = (path) => readFileSync(new URL(`../../strip/${path}`, import.meta.url), "utf8");
  return read(name).replace(STYLESHEET_LINK, (_link, href) => `<style>\n${read(href)}</style>`);
}
