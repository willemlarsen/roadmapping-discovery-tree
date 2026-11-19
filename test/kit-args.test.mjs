import { test } from "node:test";
import assert from "node:assert/strict";
import { splitArgs } from "../src/kit/args.js";

test("every --flag takes the next argument as its value; there are no valueless flags", () => {
  const args = ["--git", "--dry-run", "roadmaps/demo", "--url", "https://example.test"];

  const split = splitArgs(args);

  assert.deepEqual(split, {
    flags: ["--git", "--dry-run", "--url", "https://example.test"],
    positionals: ["roadmaps/demo"],
  });
});
