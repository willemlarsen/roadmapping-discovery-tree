import test from 'node:test';
import assert from 'node:assert/strict';
import { sameSnapshot, watchRoadmap } from '../src/live.js';
import { isValidSnapshot } from '../src/load.js';

const snapshot = { roadmapText: 'r', logText: 'l', paceText: 'p' };

test('sameSnapshot_oneTextDiffers_returnsFalse', () => {
  const changed = { ...snapshot, logText: 'l2' };

  const result = sameSnapshot(snapshot, changed);

  assert.equal(result, false);
});

test('sameSnapshot_identicalTexts_returnsTrue', () => {
  const copy = { ...snapshot };

  const result = sameSnapshot(snapshot, copy);

  assert.equal(result, true);
});

test('sameSnapshot_eachTextDiffers_returnsFalse', () => {
  const roadmapChanged = { ...snapshot, roadmapText: 'r2' };
  const logChanged = { ...snapshot, logText: 'l2' };
  const paceChanged = { ...snapshot, paceText: 'p2' };

  const results = {
    roadmap: sameSnapshot(snapshot, roadmapChanged),
    log: sameSnapshot(snapshot, logChanged),
    pace: sameSnapshot(snapshot, paceChanged),
  };

  assert.equal(results.roadmap, false);
  assert.equal(results.log, false);
  assert.equal(results.pace, false);
});

function startWatch(reads, validate = () => true, baseline = null) {
  const source = { read: async () => reads.shift() };
  const changes = [];
  const failures = [];
  const recoveries = [];
  let tick;
  watchRoadmap({
    source,
    onChange: (s) => changes.push(s),
    onFailure: (s) => failures.push(s),
    onRecover: (s) => recoveries.push(s),
    validate,
    baseline,
    schedule: (fn) => { tick = fn; },
  });
  return { tick: () => tick(), changes, failures, recoveries };
}

test('watchRoadmap_firstReadThenEqualThenDifferent_callsOnChangeOnceWithTheDifferentSnapshot', async () => {
  const changed = Object.freeze({ ...snapshot, logText: 'l2' });
  const watch = startWatch([Object.freeze({ ...snapshot }), Object.freeze({ ...snapshot }), changed]);

  await watch.tick();
  const afterBaseline = watch.changes.length;
  await watch.tick();
  const afterEqual = watch.changes.length;
  await watch.tick();

  assert.equal(afterBaseline, 0);
  assert.equal(afterEqual, 0);
  assert.deepEqual(watch.changes, [changed]);

  const early = Object.freeze({ ...snapshot, paceText: 'p3' });
  const seeded = startWatch([early, Object.freeze({ ...early })], () => true, snapshot);
  await seeded.tick();
  const afterFirstRead = [...seeded.changes];
  await seeded.tick();
  assert.deepEqual(afterFirstRead, [early]);
  assert.deepEqual(seeded.changes, [early]);
});

test('watchRoadmap_differentThenRepeated_callsOnChangeOnceNotOnTheRepeat', async () => {
  const changed = Object.freeze({ ...snapshot, logText: 'l2' });
  const watch = startWatch([Object.freeze({ ...snapshot }), changed, Object.freeze({ ...changed })]);

  await watch.tick();
  await watch.tick();
  const afterChange = watch.changes.length;
  await watch.tick();

  assert.equal(afterChange, 1);
  assert.deepEqual(watch.changes, [changed]);
});

test('watchRoadmap_failedReadBetweenGoodReads_callsOnFailureNotOnChangeAndKeepsWatching', async () => {
  const changed = Object.freeze({ ...snapshot, logText: 'l2' });
  const failed = Object.freeze({ ...snapshot, logText: null });
  const watch = startWatch([Object.freeze({ ...snapshot }), failed, changed]);

  await watch.tick();
  const failuresAfterBaseline = watch.failures.length;
  await watch.tick();
  const changesAfterFailure = watch.changes.length;
  const failuresAfterFailure = watch.failures.length;
  await watch.tick();

  assert.equal(failuresAfterBaseline, 0);
  assert.equal(failuresAfterFailure, 1);
  assert.equal(changesAfterFailure, 0);
  assert.deepEqual(watch.changes, [changed]);
});

test('watchRoadmap_nullRoadmapText_callsOnFailureAndKeepsTheBaseline', async () => {
  const changed = Object.freeze({ ...snapshot, logText: 'l2' });
  const noRoadmap = Object.freeze({ ...snapshot, roadmapText: null });
  const watch = startWatch([Object.freeze({ ...snapshot }), noRoadmap, changed]);

  await watch.tick();
  await watch.tick();
  const afterNoRoadmap = { failures: watch.failures.length, changes: watch.changes.length };
  await watch.tick();

  assert.deepEqual(afterNoRoadmap, { failures: 1, changes: 0 });
  assert.deepEqual(watch.changes, [changed]);
});

test('watchRoadmap_onlyPaceTextNull_isAGoodReadAndCallsOnChangeWithoutOnFailure', async () => {
  const paceless = Object.freeze({ roadmapText: 'r-new', logText: 'l', paceText: null });
  const watch = startWatch([Object.freeze({ ...snapshot }), paceless]);

  await watch.tick();
  await watch.tick();

  assert.deepEqual(watch.failures, []);
  assert.deepEqual(watch.changes, [paceless]);
});

test('watchRoadmap_failuresInRunsThenGoodReads_callsOnFailureOncePerRunAndOnRecoverOnceAfterEachRun', async () => {
  const failed = Object.freeze({ ...snapshot, logText: null });
  const changed = Object.freeze({ ...snapshot, logText: 'l2' });
  const watch = startWatch([Object.freeze({ ...snapshot }), failed, failed, Object.freeze({ ...snapshot }), Object.freeze({ ...snapshot }), failed, changed]);
  const counts = [];

  for (let i = 0; i < 7; i++) {
    await watch.tick();
    counts.push([watch.failures.length, watch.recoveries.length, watch.changes.length]);
  }

  assert.deepEqual(counts, [[0, 0, 0], [1, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 0], [2, 1, 0], [2, 2, 1]]);
  assert.deepEqual(watch.changes, [changed]);
});

const goodProblem = (id, status, order, problem) => ({ id, parent: null, problem, status, statusSince: '2026-10-28', order, slices: ['skin-roadmap-bar'], waitingOn: null, resumesAfter: null, doneOn: null, confirmedBy: null });
const goodRoadmap = (problem) => ({ version: 1, goal: 'Willem always knows where we are', wipLimit: 1, staleAfterDays: 3, problems: [goodProblem('up-001', 'now', 1, problem), goodProblem('up-002', 'next', 2, 'Peek under the hood')] });
const logLine = (problemId, action, after) => ({ at: '2026-11-01T12:00:00Z', problemId, actor: 'Amal', action, before: null, after, why: 'Seeded from the approved design' });
const goodLogText = [logLine('up-001', 'coach-add', 'now'), logLine('up-002', 'coach-add', 'next')].map((line) => JSON.stringify(line)).join('\n');
const goodSnapshot = (problem) => Object.freeze({ roadmapText: JSON.stringify(goodRoadmap(problem)), logText: goodLogText, paceText: '{}' });

test('watchRoadmap_invalidSnapshotNotJsonOrSchemaOrLogMismatch_eachCallsOnFailureAndKeepsTheBaseline', async () => {
  const baseline = goodSnapshot('See where we are');
  const notJson = Object.freeze({ ...baseline, roadmapText: '{ not json' });
  const badSchema = Object.freeze({ ...baseline, roadmapText: JSON.stringify({ ...goodRoadmap('See where we are'), problems: [goodProblem('up-001', 'maybe', 1, 'x')] }) });
  const mismatch = Object.freeze({ ...baseline, logText: `${goodLogText}\n${JSON.stringify(logLine('up-001', 'coach-status', 'done'))}` });
  const valid = goodSnapshot('See where we are now');
  const watch = startWatch([baseline, notJson, baseline, badSchema, baseline, mismatch, valid], isValidSnapshot);

  await watch.tick();
  await watch.tick();
  const afterNotJson = { failures: watch.failures.length, changes: watch.changes.length };
  await watch.tick();
  await watch.tick();
  const afterSchema = { failures: watch.failures.length, changes: watch.changes.length };
  await watch.tick();
  await watch.tick();
  const afterMismatch = { failures: watch.failures.length, changes: watch.changes.length };
  await watch.tick();

  assert.deepEqual(afterNotJson, { failures: 1, changes: 0 });
  assert.deepEqual(afterSchema, { failures: 2, changes: 0 });
  assert.deepEqual(afterMismatch, { failures: 3, changes: 0 });
  assert.deepEqual(watch.changes, [valid]);
});

test('watchRoadmap_goodReadAfterFailureThatAlsoDiffers_callsOnRecoverBeforeOnChange', async () => {
  const changed = Object.freeze({ ...snapshot, logText: 'l2' });
  const reads = [Object.freeze({ ...snapshot }), Object.freeze({ ...snapshot, logText: null }), changed];
  const calls = [];
  let tick;
  watchRoadmap({
    source: { read: async () => reads.shift() },
    onChange: (s) => calls.push(`change:${s.logText}`),
    onFailure: () => calls.push('failure'),
    onRecover: () => calls.push('recover'),
    validate: () => true,
    schedule: (fn) => { tick = fn; },
  });

  await tick();
  await tick();
  await tick();

  assert.deepEqual(calls, ['failure', 'recover', 'change:l2']);
});

test('watchRoadmap_visibleThenHiddenThenVisible_readsOnlyOnVisibleTicks', async () => {
  const changed = Object.freeze({ ...snapshot, logText: 'l2' });
  const reads = [Object.freeze({ ...snapshot }), changed];
  let readCount = 0;
  let hidden = false;
  const changes = [];
  let tick;
  watchRoadmap({
    source: { read: async () => { readCount += 1; return reads.length > 1 ? reads.shift() : reads[0]; } },
    onChange: (s) => changes.push(s),
    onFailure: () => {},
    onRecover: () => {},
    validate: () => true,
    isHidden: () => hidden,
    schedule: (fn) => { tick = fn; },
  });

  await tick();
  const afterVisible = readCount;
  hidden = true;
  await tick();
  const afterHidden = readCount;
  hidden = false;
  await tick();

  assert.deepEqual([afterVisible, afterHidden, readCount], [1, 1, 2]);
  assert.deepEqual(changes, [changed]);
});

async function delaysFor(random) {
  const good = Object.freeze({ ...snapshot });
  const failed = Object.freeze({ ...snapshot, logText: null });
  const reads = [good, failed, failed, failed, failed, failed, good];
  const delays = [];
  let tick;
  watchRoadmap({
    source: { read: async () => reads.shift() },
    onChange: () => {},
    onFailure: () => {},
    onRecover: () => {},
    validate: () => true,
    random: () => random,
    schedule: (fn, delayMs) => { tick = fn; delays.push(delayMs); },
  });

  for (let i = 0; i < 7; i++) await tick();
  return delays;
}

test('watchRoadmap_failuresThenSuccess_schedulesBackoffDelaysCappedAtSixtySecondsAndResetsToFiveSeconds', async () => {
  const lowest = await delaysFor(0);
  const highest = await delaysFor(0.999999);

  assert.deepEqual(lowest, [5000, 5000, 8000, 16000, 32000, 48000, 48000, 5000]);
  assert.deepEqual(highest, [5000, 5000, 12000, 24000, 48000, 60000, 60000, 5000]);
});

test('watchRoadmap_everyPoll_emitsOneRoadmapRefreshEventWithOutcomeAndDelay', async () => {
  const frozen = (texts) => Object.freeze({ ...snapshot, ...texts });
  const reads = [
    frozen({}),
    frozen({ logText: 'l2' }),
    frozen({ logText: null }),
    frozen({ roadmapText: 'bad' }),
    frozen({ roadmapText: null }),
    frozen({ paceText: 'p3' }),
    frozen({ paceText: 'p3' }),
  ];
  const events = [];
  let polls = 0;
  let tick;
  watchRoadmap({
    source: { read: async () => reads.shift() },
    onChange: () => {},
    onFailure: () => {},
    onRecover: () => {},
    validate: (s) => s.roadmapText !== 'bad',
    isHidden: () => polls === 3,
    random: () => 0,
    emit: (event) => events.push(event),
    schedule: (fn) => { tick = fn; },
  });

  for (; polls < 8; polls++) await tick();

  assert.deepEqual(events, [
    { event: 'roadmap.refresh', outcome: 'unchanged', delayMs: 5000 },
    { event: 'roadmap.refresh', outcome: 'changed', delayMs: 5000 },
    { event: 'roadmap.refresh', outcome: 'failed', delayMs: 8000 },
    { event: 'roadmap.refresh', outcome: 'skipped-hidden', delayMs: 8000 },
    { event: 'roadmap.refresh', outcome: 'invalid', delayMs: 16000 },
    { event: 'roadmap.refresh', outcome: 'failed', delayMs: 32000 },
    { event: 'roadmap.refresh', outcome: 'recovered', delayMs: 5000 },
    { event: 'roadmap.refresh', outcome: 'unchanged', delayMs: 5000 },
  ]);
});

test('watchRoadmap_onChangeThrowsOnce_schedulesNextTickEmitsErrorAndRetriesTheSameChange', async () => {
  const A = { ...snapshot, logText: 'lA' };
  const B = { ...snapshot, logText: 'lB' };
  const reads = [A, B, B];
  const seen = [];
  const events = [];
  let scheduled = 0;
  let tick;
  watchRoadmap({
    source: { read: async () => reads.shift() },
    onChange: (s) => {
      seen.push(s);
      if (seen.length === 1) throw new Error('onChange boom');
    },
    onFailure: () => {},
    onRecover: () => {},
    validate: () => true,
    random: () => 0,
    emit: (event) => events.push(event.outcome),
    schedule: (fn) => { tick = fn; scheduled += 1; },
  });

  const scheduledAfter = [];
  for (let i = 0; i < 3; i++) {
    await tick();
    scheduledAfter.push(scheduled);
  }

  assert.deepEqual(scheduledAfter, [2, 3, 4]);
  assert.deepEqual(events, ['unchanged', 'error', 'changed']);
  assert.deepEqual(seen, [B, B]);
});

test('watchRoadmap_whenStopCalled_schedulesNoFurtherTick', async () => {
  const scheduled = [];
  const watcher = watchRoadmap({
    source: { read: async () => ({ ...snapshot }) },
    onChange: () => {},
    onFailure: () => {},
    onRecover: () => {},
    validate: () => true,
    schedule: (fn, delayMs) => scheduled.push({ fn, delayMs }),
  });
  await scheduled[0].fn();
  const beforeStop = scheduled.length;

  watcher.stop();
  await scheduled[1].fn();

  assert.equal(beforeStop, 2);
  assert.equal(scheduled.length, 2);
});

test('watchRoadmap_whenTickQueuedBeforeStop_runsNoReadEmitsNothingAndSchedulesNothing', async () => {
  const scheduled = [];
  const events = [];
  let reads = 0;
  const watcher = watchRoadmap({
    source: { read: async () => { reads += 1; return { ...snapshot }; } },
    onChange: () => {},
    onFailure: () => {},
    onRecover: () => {},
    validate: () => true,
    emit: (event) => events.push(event),
    schedule: (fn, delayMs) => scheduled.push({ fn, delayMs }),
  });
  await scheduled[0].fn();
  const queued = scheduled[1].fn;
  watcher.stop();

  await queued();

  assert.equal(reads, 1);
  assert.equal(events.length, 1);
  assert.equal(scheduled.length, 2);
});

test('watchRoadmap_whenStopCalledTwice_schedulesNothingAndReadsNothingMore', async () => {
  const scheduled = [];
  let reads = 0;
  const watcher = watchRoadmap({
    source: { read: async () => { reads += 1; return { ...snapshot }; } },
    onChange: () => {},
    onFailure: () => {},
    onRecover: () => {},
    validate: () => true,
    schedule: (fn, delayMs) => scheduled.push({ fn, delayMs }),
  });
  await scheduled[0].fn();
  const readsBeforeStops = reads;
  const scheduledBeforeStops = scheduled.length;

  watcher.stop();
  watcher.stop();
  for (const { fn } of [...scheduled]) await fn();

  assert.equal(reads, readsBeforeStops);
  assert.equal(scheduled.length, scheduledBeforeStops);
});

test('watchRoadmap_whenStopCalledWhileReadInFlight_callsNoHandlerAndSchedulesNothing', async () => {
  function inFlightWatcher(baseline) {
    const scheduled = [];
    const calls = [];
    let resolveRead;
    const watcher = watchRoadmap({
      source: { read: () => new Promise((resolve) => { resolveRead = resolve; }) },
      onChange: () => calls.push('change'),
      onFailure: () => calls.push('failure'),
      onRecover: () => calls.push('recover'),
      validate: () => true,
      baseline,
      schedule: (fn, delayMs) => scheduled.push({ fn, delayMs }),
    });
    return { scheduled, calls, watcher, resolveRead: (value) => resolveRead(value) };
  }
  const changing = inFlightWatcher({ ...snapshot });
  const failing = inFlightWatcher({ ...snapshot });
  const changingTick = changing.scheduled[0].fn();
  const failingTick = failing.scheduled[0].fn();

  changing.watcher.stop();
  failing.watcher.stop();
  changing.resolveRead({ ...snapshot, roadmapText: 'changed while stopping' });
  failing.resolveRead({ ...snapshot, roadmapText: null });
  await changingTick;
  await failingTick;

  assert.deepEqual(changing.calls, []);
  assert.deepEqual(failing.calls, []);
  assert.equal(changing.scheduled.length, 1);
  assert.equal(failing.scheduled.length, 1);
});
