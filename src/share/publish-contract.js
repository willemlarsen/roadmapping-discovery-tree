const SAFE_PATH = /^[A-Za-z0-9_.$[\]-]{1,120}$/;
const MAX_FIELDS = 50;

const fixed = (exitCode, line, retryable = false) => () => ({ exitCode, line, retryable });

const invalidSnapshot = (exitCode, retryable) => (body) => {
  const { fields } = body;
  const usable = Array.isArray(fields) && fields.length >= 1 && fields.length <= MAX_FIELDS && fields.every((f) => typeof f === "string" && SAFE_PATH.test(f));
  return usable ? { exitCode, line: `invalid snapshot: ${fields.join(", ")}`, retryable } : null;
};

const RULES = {
  "200:stored": fixed(0, "published"),
  "400:bad_request": fixed(1, "bad request (product id, idempotency key or body); this is a bug in the publisher, report it"),
  "401:unauthorized": fixed(1, "publish key revoked or wrong; mint a new one"),
  "403:forbidden": fixed(1, "publish key is for another product; use the key minted for this product"),
  "409:conflict": fixed(1, "idempotency key was reused with a different snapshot; run again"),
  "409:stale": fixed(0, "site already has a newer snapshot; nothing was changed"),
  "413:payload_too_large": fixed(1, "snapshot is too large (limit 256 KB); trim the roadmap"),
  "422:invalid_snapshot": invalidSnapshot(1, false),
  "429:rate_limited": fixed(1, "rate limited; wait a minute and run again", true),
  "503:unavailable": fixed(1, "publish failed (server unavailable); run again, it is safe to repeat", true),
};

export function interpretPublishResponse({ status, body }) {
  const code = status === 200 ? body?.status : body?.error;
  const result = RULES[`${status}:${code}`]?.(body);
  return result ?? { exitCode: 1, line: `unexpected response (status ${status})`, retryable: status >= 500 };
}
