import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertSchemaPin } from "./support/schema-pin.mjs";

test("the schema pin names the file to refresh and where from when the copy's bytes differ: identical passes, one changed byte and a trailing newline fail", () => {
  const copy = readFileSync(new URL("../contracts/share-snapshot-v1.schema.json", import.meta.url));
  const oneByteChanged = Buffer.from(copy);
  oneByteChanged[0] ^= 1;
  const withNewline = Buffer.concat([copy, Buffer.from("\n")]);
  const refresh = /contracts\/share-snapshot-v1\.schema\.json.*clickchain-ai.*contracts\/share-snapshot-v1\.schema\.json/s;

  assert.doesNotThrow(() => assertSchemaPin(copy));
  assert.throws(() => assertSchemaPin(oneByteChanged), refresh);
  assert.throws(() => assertSchemaPin(withNewline), refresh);
});
