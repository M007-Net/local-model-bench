/** Pure helpers for describing open-loop (fixed arrival schedule) load runs.
 * These helpers do not dispatch requests; callers record what their runner did.
 */

export interface ArrivalRequestPlan {
  index: number;
  /** Scheduled arrival time relative to the start of the run. */
  offsetMs: number;
}

export interface ArrivalSchedule {
  targetRatePerSecond: number;
  concurrencyCap: number;
  requests: ArrivalRequestPlan[];
}

/** Schedule arrivals independently of response times. The runner should attempt
 * each request at its offset, subject to concurrencyCap, and record cap drops.
 */
export function scheduleArrivals(
  requestCount: number,
  targetRatePerSecond: number,
  concurrencyCap: number,
): ArrivalSchedule {
  if (!Number.isInteger(requestCount) || requestCount < 0) {
    throw new RangeError('requestCount must be a non-negative integer');
  }
  if (!Number.isFinite(targetRatePerSecond) || targetRatePerSecond <= 0) {
    throw new RangeError('targetRatePerSecond must be a positive finite number');
  }
  if (!Number.isInteger(concurrencyCap) || concurrencyCap < 1) {
    throw new RangeError('concurrencyCap must be a positive integer');
  }
  return {
    targetRatePerSecond,
    concurrencyCap,
    requests: Array.from({ length: requestCount }, (_, index) => ({
      index,
      offsetMs: index * 1000 / targetRatePerSecond,
    })),
  };
}

export interface ArrivalRequestObservation {
  /** Scheduled offset from run start. */
  plannedAtMs: number;
  /** Actual start offset, or null when rejected/dropped before dispatch. */
  startedAtMs: number | null;
  /** Actual completion offset; null while in flight or if no completion was observed. */
  completedAtMs: number | null;
  failed: boolean;
  dropReason?: 'capacity' | 'cancelled';
  /** Measured request latencies in milliseconds, keyed by caller-defined metric. */
  latencyMs: Record<string, number | null>;
}

export interface ArrivalRateSummaryInput {
  requests: ArrivalRequestObservation[];
  /** Full measurement interval, including any in-flight drain after arrivals stop. */
  wallIntervalMs: number;
  /** Interval during which arrivals were offered. Starts/sec uses this denominator. */
  offeredIntervalMs: number;
  /** Every listed metric must be present and within its threshold to count as good. */
  latencyTargetsMs: Record<string, number>;
}

export interface ArrivalRateSummary {
  planned: number;
  started: number;
  dropped: number;
  capacityDrops: number;
  cancelledBeforeStart: number;
  completed: number;
  failed: number;
  wallIntervalMs: number;
  offeredIntervalMs: number;
  /** Started requests divided by offeredIntervalMs; drain time is excluded. */
  achievedArrivalRatePerSecond: number;
  meanQueueWaitMs: number | null;
  p95QueueWaitMs: number | null;
  latencyTargetGoodputRequests: number;
  latencyTargetGoodputPerSecond: number;
  latencyTargetGoodputDenominator: 'full wall interval';
  latencyTargetsMs: Record<string, number>;
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

/** Summarize caller-recorded events. Goodput counts successful completions meeting
 * every supplied target; the rate denominator is always the explicit full interval.
 */
export function summarizeArrivalRate(input: ArrivalRateSummaryInput): ArrivalRateSummary {
  const { requests, wallIntervalMs, offeredIntervalMs, latencyTargetsMs } = input;
  if (!Number.isFinite(wallIntervalMs) || wallIntervalMs <= 0) {
    throw new RangeError('wallIntervalMs must be a positive finite number');
  }
  if (!Number.isFinite(offeredIntervalMs) || offeredIntervalMs <= 0 || offeredIntervalMs > wallIntervalMs) {
    throw new RangeError('offeredIntervalMs must be positive and no greater than wallIntervalMs');
  }
  for (const request of requests) {
    if (!Number.isFinite(request.plannedAtMs) || request.plannedAtMs < 0 || request.plannedAtMs > offeredIntervalMs) {
      throw new RangeError('plannedAtMs must be within the offered interval');
    }
    if (request.startedAtMs !== null && (!Number.isFinite(request.startedAtMs) || request.startedAtMs < request.plannedAtMs || request.startedAtMs > wallIntervalMs)) {
      throw new RangeError('startedAtMs must be within the wall interval and no earlier than plannedAtMs');
    }
    if (request.completedAtMs !== null && (!Number.isFinite(request.completedAtMs) || request.startedAtMs === null || request.completedAtMs < request.startedAtMs || request.completedAtMs > wallIntervalMs)) {
      throw new RangeError('completedAtMs must be within the wall interval and no earlier than startedAtMs');
    }
    for (const observed of Object.values(request.latencyMs)) {
      if (observed !== null && (!Number.isFinite(observed) || observed < 0)) {
        throw new RangeError('observed latencies must be null or non-negative finite numbers');
      }
    }
  }
  for (const [metric, target] of Object.entries(latencyTargetsMs)) {
    if (!Number.isFinite(target) || target < 0) throw new RangeError(`latency target for ${metric} must be non-negative and finite`);
  }

  const started = requests.filter(request => request.startedAtMs !== null);
  const startedDuringOffer = started.filter(request => request.startedAtMs! <= offeredIntervalMs);
  const completed = requests.filter(request => request.completedAtMs !== null);
  const waits = started.map(request => request.startedAtMs! - request.plannedAtMs);
  const goodput = completed.filter(request => !request.failed &&
    Object.entries(latencyTargetsMs).every(([metric, target]) => {
      const observed = request.latencyMs[metric];
      return observed !== null && observed !== undefined && Number.isFinite(observed) && observed <= target;
    })).length;
  const seconds = wallIntervalMs / 1000;
  const offeredSeconds = offeredIntervalMs / 1000;

  return {
    planned: requests.length,
    started: started.length,
    dropped: requests.length - started.length,
    capacityDrops: requests.filter(request => request.startedAtMs === null && request.dropReason === 'capacity').length,
    cancelledBeforeStart: requests.filter(request => request.startedAtMs === null && request.dropReason === 'cancelled').length,
    completed: completed.length,
    failed: requests.filter(request => request.failed).length,
    wallIntervalMs,
    offeredIntervalMs,
    achievedArrivalRatePerSecond: startedDuringOffer.length / offeredSeconds,
    meanQueueWaitMs: waits.length ? waits.reduce((sum, wait) => sum + wait, 0) / waits.length : null,
    p95QueueWaitMs: percentile(waits, 0.95),
    latencyTargetGoodputRequests: goodput,
    latencyTargetGoodputPerSecond: goodput / seconds,
    latencyTargetGoodputDenominator: 'full wall interval',
    latencyTargetsMs: { ...latencyTargetsMs },
  };
}
