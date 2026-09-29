import type { SizeLabel } from '@mirrorfit/types';

import { isSizeLabel, type ExperienceItem } from './catalog';

export interface ChartSize {
  readonly label: string;
  readonly chestCm: number | null;
  readonly waistCm: number | null;
  readonly hipCm: number | null;
  readonly lengthCm: number | null;
  readonly sleeveCm: number | null;
  readonly inseamCm: number | null;
}

export interface BodyInput {
  readonly chestCm: number | null;
  readonly waistCm: number | null;
  readonly hipCm: number | null;
  readonly heightCm: number | null;
}

export type FitFeel = 'snug' | 'close' | 'relaxed';

export interface SizeAdvice {
  readonly size: string;
  readonly confidence: number;
  readonly fit: FitFeel;
  readonly alternatives: readonly string[];
  /** height-prior is not this garment. chart is the shop's own measurements. */
  readonly source: 'chart' | 'height-prior';
  readonly rationale: string;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function meanDiff(
  size: ChartSize,
  body: BodyInput,
): { readonly diff: number; readonly signed: number } | null {
  const pairs: Array<[number | null, number | null]> = [
    [size.chestCm, body.chestCm],
    [size.waistCm, body.waistCm],
    [size.hipCm, body.hipCm],
  ];
  const diffs: number[] = [];
  const signed: number[] = [];
  for (const [garment, person] of pairs) {
    if (!finite(garment) || !finite(person)) continue;
    diffs.push(Math.abs(person - garment));
    signed.push(person - garment);
  }
  if (diffs.length === 0) return null;
  const diff = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  const bias = signed.reduce((sum, value) => sum + value, 0) / signed.length;
  return { diff, signed: bias };
}

function feel(signed: number): FitFeel {
  if (signed > 2) return 'snug';
  if (signed < -2) return 'relaxed';
  return 'close';
}

/**
 * Scores the shop's size chart. Returns null reasons instead of a guessed label
 * when the chart or the typed measurements cannot be compared.
 */
export function recommendFromChart(
  chart: readonly ChartSize[],
  body: BodyInput,
): SizeAdvice | { readonly ok: false; readonly reason: 'NO_CHART' | 'NO_OVERLAP' } {
  if (chart.length === 0) return { ok: false, reason: 'NO_CHART' };
  const scored = chart
    .map((size) => ({ size, score: meanDiff(size, body) }))
    .filter(
      (row): row is { size: ChartSize; score: { diff: number; signed: number } } =>
        row.score !== null,
    )
    .sort((a, b) => a.score.diff - b.score.diff || a.size.label.localeCompare(b.size.label));
  const best = scored[0];
  if (!best) return { ok: false, reason: 'NO_OVERLAP' };
  const confidence = Math.min(0.95, Math.max(0.2, 1 - best.score.diff / 8));
  return {
    size: best.size.label,
    confidence: Math.round(confidence * 100) / 100,
    fit: feel(best.score.signed),
    alternatives: scored.slice(1, 3).map((row) => row.size.label),
    source: 'chart',
    rationale: 'Compared with this garment’s size chart. Not a body scan.',
  };
}

/** Generic adult height bands. Used only when the shop has not published a chart. */
const HEIGHT_BANDS: readonly {
  readonly label: SizeLabel;
  readonly min: number;
  readonly max: number;
}[] = [
  { label: 'XS', min: 145, max: 155 },
  { label: 'S', min: 155, max: 162 },
  { label: 'M', min: 162, max: 170 },
  { label: 'L', min: 170, max: 178 },
  { label: 'XL', min: 178, max: 185 },
  { label: 'XXL', min: 185, max: 192 },
  { label: 'XXXL', min: 192, max: 210 },
];

export function recommendFromHeight(
  heightCm: number | null,
  available: readonly string[],
): SizeAdvice | { readonly ok: false; readonly reason: 'NO_HEIGHT' | 'SIZE_NOT_IN_CATALOG' } {
  if (!finite(heightCm) || heightCm < 120 || heightCm > 230) {
    return { ok: false, reason: 'NO_HEIGHT' };
  }
  const band =
    HEIGHT_BANDS.find((row) => heightCm >= row.min && heightCm < row.max) ??
    HEIGHT_BANDS[HEIGHT_BANDS.length - 1]!;
  if (!available.includes(band.label)) return { ok: false, reason: 'SIZE_NOT_IN_CATALOG' };
  return {
    size: band.label,
    confidence: 0.35,
    fit: 'close',
    alternatives: [],
    source: 'height-prior',
    rationale:
      'Generic height guide. This shop has no chart for this garment, so this is not a fit measurement.',
  };
}

/**
 * Relative pose widths are not centimetres. Absolute values are produced only
 * from a height the customer typed, and they are a prior — not a scan.
 */
export function estimateFromStatedHeight(
  heightCm: number | null,
  pose: { readonly shoulderWidth: number | null; readonly hipWidth: number | null } | null,
):
  | { readonly ok: false; readonly reason: 'NEED_HEIGHT' }
  | {
      readonly ok: true;
      readonly source: 'stated-height-prior';
      readonly chestCm: number;
      readonly waistCm: number;
      readonly hipCm: number;
    } {
  if (!finite(heightCm) || heightCm < 120 || heightCm > 230) {
    return { ok: false, reason: 'NEED_HEIGHT' };
  }
  const shoulder = pose?.shoulderWidth;
  const hip = pose?.hipWidth;
  const shoulderFactor =
    shoulder !== null && shoulder !== undefined && shoulder > 0.05 && shoulder < 0.8
      ? Math.min(1.15, Math.max(0.85, shoulder / 0.22))
      : 1;
  const hipFactor =
    hip !== null && hip !== undefined && hip > 0.05 && hip < 0.8
      ? Math.min(1.15, Math.max(0.85, hip / 0.2))
      : 1;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    ok: true,
    source: 'stated-height-prior',
    chestCm: round(heightCm * 0.52 * shoulderFactor),
    waistCm: round(heightCm * 0.44 * ((shoulderFactor + hipFactor) / 2)),
    hipCm: round(heightCm * 0.54 * hipFactor),
  };
}

export function adviceForItem(
  item: ExperienceItem,
  chart: readonly ChartSize[],
  body: BodyInput,
): SizeAdvice | { readonly ok: false; readonly reason: string } {
  const fromChart = recommendFromChart(chart, body);
  if (!('ok' in fromChart)) {
    if (item.sizes.includes(fromChart.size) || item.sizes.length === 0) return fromChart;
  }
  return recommendFromHeight(body.heightCm, item.sizes);
}

export function sizeScale(label: string | null): number {
  const scales: Readonly<Record<string, number>> = {
    XS: 0.92,
    S: 0.96,
    M: 1,
    L: 1.04,
    XL: 1.08,
    XXL: 1.12,
    XXXL: 1.16,
  };
  if (!label) return 1;
  return scales[label] ?? (isSizeLabel(label) ? 1 : 1);
}
