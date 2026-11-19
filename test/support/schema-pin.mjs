import { createHash } from "node:crypto";

const SITE_SCHEMA_SHA256 = "907bd9ec69c44d08bd85eb1bc6780441e12df0328a4b9474012cc8933b09f65c";

export function assertSchemaPin(bytes) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual === SITE_SCHEMA_SHA256) return;
  throw new Error(
    "contracts/share-snapshot-v1.schema.json differs from the site's schema (sha256 " + actual + ", pinned " + SITE_SCHEMA_SHA256 + "). " +
      "Refresh it by copying clickchain-ai/contracts/share-snapshot-v1.schema.json over it, byte for byte."
  );
}
