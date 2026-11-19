export function sameSnapshot(a, b) {
  return a.roadmapText === b.roadmapText
    && a.logText === b.logText
    && a.paceText === b.paceText;
}

function fetchSnapshot(source) {
  return source.read();
}

function isChange(baseline, snapshot) {
  return baseline !== null && !sameSnapshot(baseline, snapshot);
}

function replaceBaseline(snapshot) {
  return snapshot;
}

function isFailedRead(snapshot) {
  return snapshot.roadmapText === null || snapshot.logText === null;
}

function failureOutcome(snapshot, validate) {
  if (isFailedRead(snapshot)) return 'failed';
  return validate(snapshot) ? null : 'invalid';
}

function goodOutcome(wasFailing, changed) {
  if (wasFailing) return 'recovered';
  return changed ? 'changed' : 'unchanged';
}

function failureStep(failing, onFailure, snapshot) {
  if (!failing) onFailure(snapshot);
  return true;
}

function recoverStep(failing, onRecover, snapshot) {
  if (failing) onRecover(snapshot);
  return false;
}

const BASE_DELAY_MS = 5000;
const MAX_DELAY_MS = 60000;
const JITTER = 0.2;

export function computeBackoff(failures, random) {
  if (failures === 0) return BASE_DELAY_MS;
  const doubled = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** failures);
  const jittered = doubled * (1 + (2 * random - 1) * JITTER);
  return Math.round(Math.min(MAX_DELAY_MS, jittered));
}

export function watchRoadmap({ source, onChange, onFailure, onRecover, validate, isHidden = () => false, random = Math.random, emit = () => {}, baseline: initial = null, schedule }) {
  let baseline = initial;
  let failing = false;
  let failures = 0;
  let stopped = false;
  async function step() {
    if (isHidden()) return 'skipped-hidden';
    const snapshot = await fetchSnapshot(source);
    if (stopped) return 'stopped';
    const failure = failureOutcome(snapshot, validate);
    if (failure) {
      failing = failureStep(failing, onFailure, snapshot);
      failures += 1;
      return failure;
    }
    failures = 0;
    const wasFailing = failing;
    failing = recoverStep(failing, onRecover, snapshot);
    const changed = isChange(baseline, snapshot);
    if (changed) onChange(snapshot);
    baseline = replaceBaseline(snapshot);
    return goodOutcome(wasFailing, changed);
  }
  async function tick() {
    if (stopped) return;
    let outcome;
    try {
      outcome = await step();
    } catch {
      outcome = 'error';
    }
    const delayMs = computeBackoff(failures, random());
    emit({ event: 'roadmap.refresh', outcome, delayMs });
    if (!stopped) schedule(tick, delayMs);
  }
  schedule(tick, computeBackoff(failures, random()));
  return { stop() { stopped = true; } };
}
