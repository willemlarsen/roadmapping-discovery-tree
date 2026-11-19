import { interpretPublishResponse } from "./publish-contract.js";
import { shouldRetry, backoffDelay } from "./retry.js";

const NETWORK_ERROR = { exitCode: 1, line: "publish failed (network); run again, it is safe to repeat", retryable: true };

function retryAfterSeconds(response) {
  const header = response.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  return seconds >= 0 ? seconds : undefined;
}

function snapshotUrl(base, productId) {
  const target = new URL(base);
  target.pathname = `${target.pathname.replace(/\/+$/, "")}/api/share/snapshots/${productId}`;
  return target.href;
}

async function sendOnce(snapshot, { fetch, key, url }, idempotencyKey) {
  try {
    const response = await fetch(snapshotUrl(url, snapshot.productId), {
      method: "PUT",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(snapshot),
    });
    const body = await response.json().catch(() => undefined);
    return { status: response.status, result: interpretPublishResponse({ status: response.status, body }), retryAfter: retryAfterSeconds(response) };
  } catch {
    return { status: undefined, result: NETWORK_ERROR, retryAfter: undefined };
  }
}

export async function publish(snapshot, { fetch, key, url, uuid, log, sleep, random }) {
  const idempotencyKey = uuid();
  const attemptOnce = async (attempt) => {
    const sent = await sendOnce(snapshot, { fetch, key, url }, idempotencyKey);
    log("share.publish.attempt", { productId: snapshot.productId, status: sent.status, attempt, outcome: sent.result.line });
    return sent;
  };
  let attempt = 1;
  let sent = await attemptOnce(attempt);
  while (shouldRetry(sent.result, attempt)) {
    await sleep(backoffDelay(attempt, sent.retryAfter, random));
    attempt += 1;
    sent = await attemptOnce(attempt);
  }
  return sent.result;
}
