export interface GpuPowerReading {
  /** Monotonic sampler timestamp in milliseconds. */
  t: number;
  /** Selected GPU board power in watts. */
  power: number | null;
}

export interface GpuEnergyGap {
  fromMs: number;
  toMs: number;
  durationMs: number;
  reason: 'missing endpoint reading' | 'power reading unavailable' | 'sampling gap too large';
}

export interface GpuEnergyEstimate {
  status: 'available' | 'partial' | 'unavailable';
  /** Whole-window joules, present only when every millisecond is covered. */
  joules: number | null;
  /** Joules integrated only over covered segments; never extrapolated over gaps. */
  measuredJoules: number | null;
  requestedMs: number;
  coveredMs: number;
  coverage: number;
  gaps: GpuEnergyGap[];
  device: string | null;
  source: 'selected GPU board power sensor';
  method: string;
  note: string;
}

const makeUnavailable = (fromMs: number, toMs: number, device: string | null, note: string): GpuEnergyEstimate => ({
  status: 'unavailable', joules: null, measuredJoules: null,
  requestedMs: Number.isFinite(fromMs) && Number.isFinite(toMs) ? Math.max(0, toMs - fromMs) : 0,
  coveredMs: 0, coverage: 0, gaps: [], device,
  source: 'selected GPU board power sensor',
  method: 'Trapezoidal integration of raw GPU power readings over the requested wall-clock interval.',
  note,
});

/** Integrate the selected GPU's raw power readings over a requested wall interval.
 * Boundaries are linearly interpolated only between bracketing readings. Large gaps
 * and missing endpoints remain uncovered; whole-window joules are withheld unless
 * coverage is complete. This does not estimate CPU, memory, display, or system energy.
 */
export function integrateGpuEnergy(
  readings: readonly GpuPowerReading[],
  fromMs: number,
  toMs: number,
  device: string | null,
  expectedIntervalMs: number,
): GpuEnergyEstimate {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return makeUnavailable(fromMs, toMs, device, 'Energy is unavailable for a zero-duration or invalid interval.');
  }
  if (!device) return makeUnavailable(fromMs, toMs, null, 'No selected GPU device is available for power measurement.');
  if (!Number.isFinite(expectedIntervalMs) || expectedIntervalMs <= 0) {
    return makeUnavailable(fromMs, toMs, device, 'Expected GPU sampling interval is unavailable.');
  }

  const sorted = readings
    .filter(r => Number.isFinite(r.t) && r.t >= 0)
    .filter(r => r.t >= fromMs - expectedIntervalMs * 2 && r.t <= toMs + expectedIntervalMs * 2)
    .map(r => ({ t: r.t, power: typeof r.power === 'number' && Number.isFinite(r.power) && r.power >= 0 ? r.power : null }))
    .sort((a, b) => a.t - b.t);
  const points: GpuPowerReading[] = [];
  for (const reading of sorted) {
    const last = points.at(-1);
    if (last?.t === reading.t) {
      // If duplicate timestamps occur, use the last raw reading for that device.
      last.power = reading.power;
    } else points.push({ t: reading.t, power: reading.power });
  }
  const windowMs = toMs - fromMs;
  const maxGapMs = Math.max(expectedIntervalMs * 2.5, expectedIntervalMs + 1);
  const gaps: GpuEnergyGap[] = [];
  let coveredMs = 0;
  let measuredJoules = 0;
  const addGap = (a: number, b: number, reason: GpuEnergyGap['reason']) => {
    if (b <= a) return;
    gaps.push({ fromMs: a, toMs: b, durationMs: b - a, reason });
  };

  if (!points.length) {
    addGap(fromMs, toMs, 'power reading unavailable');
  } else {
    if (points[0].t > fromMs) addGap(fromMs, Math.min(toMs, points[0].t), 'missing endpoint reading');
    for (let i = 0; i < points.length - 1; i++) {
      const left = points[i], right = points[i + 1];
      const a = Math.max(fromMs, left.t), b = Math.min(toMs, right.t);
      if (b <= a) continue;
      const span = right.t - left.t;
      if (span > maxGapMs) {
        addGap(a, b, 'sampling gap too large');
        continue;
      }
      if (left.power === null || right.power === null) {
        addGap(a, b, 'power reading unavailable');
        continue;
      }
      const fractionA = (a - left.t) / span, fractionB = (b - left.t) / span;
      const powerA = left.power! + (right.power! - left.power!) * fractionA;
      const powerB = left.power! + (right.power! - left.power!) * fractionB;
      const duration = b - a;
      measuredJoules += ((powerA + powerB) / 2) * (duration / 1000);
      coveredMs += duration;
    }
    if (points.at(-1)!.t < toMs) addGap(Math.max(fromMs, points.at(-1)!.t), toMs, 'missing endpoint reading');
  }

  const complete = gaps.length === 0 && Math.abs(coveredMs - windowMs) < 1e-6;
  const status = complete ? 'available' : coveredMs > 0 ? 'partial' : 'unavailable';
  return {
    status,
    joules: complete ? measuredJoules : null,
    measuredJoules: coveredMs > 0 ? measuredJoules : null,
    requestedMs: windowMs,
    coveredMs,
    coverage: coveredMs / windowMs,
    gaps,
    device,
    source: 'selected GPU board power sensor',
    method: `Trapezoidal integration of raw GPU power readings; boundary interpolation requires bracketing samples and gaps over ${maxGapMs} ms are excluded.`,
    note: complete
      ? 'GPU board energy only; no whole-system energy is inferred.'
      : 'Partial GPU board energy covers only measured intervals; missing endpoints or large gaps are not extrapolated, and whole-window energy is unavailable.',
  };
}
