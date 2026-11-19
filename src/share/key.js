const PUBLISH_KEY = /^ccps_[A-Za-z0-9_-]{43}$/;
const NO_KEY_LINE = "no publish key; set SHARE_PUBLISH_KEY and run again\n";

export function readPublishKey({ env }) {
  const text = String(env.SHARE_PUBLISH_KEY ?? "").trim();
  return PUBLISH_KEY.test(text) ? text : null;
}

export function keyOrExit({ env, err }) {
  const key = readPublishKey({ env });
  if (key === null) {
    err.write(NO_KEY_LINE);
    return { exitCode: 1 };
  }
  return { exitCode: 0, key };
}
