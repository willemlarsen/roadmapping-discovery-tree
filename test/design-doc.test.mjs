import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("design section 6 names the load event's forecast codes and where the handler lives", async () => {
  const design = await readFile(new URL("../docs/design.md", import.meta.url), "utf8");

  const observability = design.slice(design.indexOf("## 6. Observability"), design.indexOf("## 7."));

  assert.match(observability, /`forecast`: `ok`, `missing`, `invalid`, `stale`, `insufficient` or `outdated`/);
  assert.match(observability, /handler lives in the page layer and calls into the domain layer/);
});
