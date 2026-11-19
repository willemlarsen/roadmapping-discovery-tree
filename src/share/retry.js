export const MAX_ATTEMPTS = 4;
export const BASE_MS = 500;
export const CAP_MS = 8000;

export function shouldRetry(result, attempt) {
  return result.retryable && attempt < MAX_ATTEMPTS;
}

export function backoffDelay(attempt, retryAfterSeconds, random) {
  if (retryAfterSeconds !== undefined) return Math.min(CAP_MS, retryAfterSeconds * 1000 + random() * BASE_MS * 2 ** (attempt - 1));
  return random() * Math.min(CAP_MS, BASE_MS * 2 ** (attempt - 1));
}
