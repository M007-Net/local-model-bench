import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleArrivals, summarizeArrivalRate } from '../src/arrival-rate';

test('open-loop schedule is deterministic and independent of the concurrency cap', () => {
  assert.deepEqual(scheduleArrivals(4, 2, 3), {
    targetRatePerSecond: 2,
    concurrencyCap: 3,
    requests: [
      { index: 0, offsetMs: 0 },
      { index: 1, offsetMs: 500 },
      { index: 2, offsetMs: 1000 },
      { index: 3, offsetMs: 1500 },
    ],
  });
  assert.deepEqual(scheduleArrivals(4, 2, 1).requests, scheduleArrivals(4, 2, 8).requests);
  assert.deepEqual(scheduleArrivals(0, 5, 1).requests, []);
});

test('arrival schedule rejects invalid rates, counts, and caps', () => {
  assert.throws(() => scheduleArrivals(-1, 2, 1), RangeError);
  assert.throws(() => scheduleArrivals(1.5, 2, 1), RangeError);
  assert.throws(() => scheduleArrivals(1, 0, 1), RangeError);
  assert.throws(() => scheduleArrivals(1, 2, 0), RangeError);
});

test('summary reports dispatch, drops, wait, failures, and target goodput over full interval', () => {
  const summary = summarizeArrivalRate({
    wallIntervalMs: 2000,
    offeredIntervalMs: 2000,
    latencyTargetsMs: { ttft: 300, total: 1000 },
    requests: [
      { plannedAtMs: 0, startedAtMs: 50, completedAtMs: 500, failed: false, latencyMs: { ttft: 250, total: 450 } },
      { plannedAtMs: 250, startedAtMs: 350, completedAtMs: 900, failed: false, latencyMs: { ttft: 300, total: 550 } },
      { plannedAtMs: 500, startedAtMs: null, completedAtMs: null, failed: false, latencyMs: {} },
      { plannedAtMs: 750, startedAtMs: 800, completedAtMs: null, failed: true, latencyMs: { ttft: 100, total: null } },
      { plannedAtMs: 1000, startedAtMs: 1000, completedAtMs: 1900, failed: false, latencyMs: { ttft: 100, total: 1200 } },
    ],
  });

  assert.equal(summary.planned, 5);
  assert.equal(summary.started, 4);
  assert.equal(summary.dropped, 1);
  assert.equal(summary.completed, 3);
  assert.equal(summary.failed, 1);
  assert.equal(summary.achievedArrivalRatePerSecond, 2);
  assert.equal(summary.meanQueueWaitMs, 50);
  assert.equal(summary.p95QueueWaitMs, 100);
  assert.equal(summary.latencyTargetGoodputRequests, 2);
  assert.equal(summary.latencyTargetGoodputPerSecond, 1);
  assert.equal(summary.latencyTargetGoodputDenominator, 'full wall interval');
});

test('missing measurements cannot satisfy a target and an empty target set counts successful completions', () => {
  const summary = summarizeArrivalRate({
    wallIntervalMs: 1000,
    offeredIntervalMs: 1000,
    latencyTargetsMs: { ttft: 100 },
    requests: [
      { plannedAtMs: 0, startedAtMs: 0, completedAtMs: 10, failed: false, latencyMs: {} },
    ],
  });
  assert.equal(summary.latencyTargetGoodputRequests, 0);
  assert.equal(summary.meanQueueWaitMs, 0);
  assert.equal(summary.p95QueueWaitMs, 0);

  const noTargets = summarizeArrivalRate({
    wallIntervalMs: 1000,
    offeredIntervalMs: 1000,
    latencyTargetsMs: {},
    requests: [{ plannedAtMs: 0, startedAtMs: 0, completedAtMs: 10, failed: false, latencyMs: {} }],
  });
  assert.equal(noTargets.latencyTargetGoodputRequests, 1);
});

test('summary rejects invalid intervals, inconsistent event times, and out-of-window completions', () => {
  assert.throws(() => summarizeArrivalRate({ wallIntervalMs: 0, offeredIntervalMs: 0, latencyTargetsMs: {}, requests: [] }), RangeError);
  assert.throws(() => summarizeArrivalRate({
    wallIntervalMs: 1000,
    offeredIntervalMs: 1000,
    latencyTargetsMs: {},
    requests: [{ plannedAtMs: 5, startedAtMs: 4, completedAtMs: null, failed: false, latencyMs: {} }],
  }), RangeError);
  assert.throws(() => summarizeArrivalRate({
    wallIntervalMs: 1000,
    offeredIntervalMs: 500,
    latencyTargetsMs: {},
    requests: [{ plannedAtMs: 0, startedAtMs: 0, completedAtMs: 1001, failed: false, latencyMs: {} }],
  }), RangeError);
  assert.throws(() => summarizeArrivalRate({
    wallIntervalMs: 1000,
    offeredIntervalMs: 1000,
    latencyTargetsMs: { ttft: 100 },
    requests: [{ plannedAtMs: 0, startedAtMs: 0, completedAtMs: 10, failed: false, latencyMs: { ttft: -1 } }],
  }), RangeError);
});
