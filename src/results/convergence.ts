export interface ConvergenceSample {
  label?: string;
  /** Representative mesh spacing h. Samples must be supplied coarse-to-fine. */
  meshSize: number;
  qoi: number;
  elementCount?: number;
}

export interface ConvergenceOptions {
  /** ASME-style three-grid safety factor. */
  safetyFactor?: number;
  /** Relative tolerance used when comparing refinement ratios. */
  ratioTolerance?: number;
}

export type ConvergenceInputErrorCode =
  | 'SAMPLE_COUNT'
  | 'NON_FINITE_VALUE'
  | 'INVALID_MESH_SIZE'
  | 'MESH_NOT_REFINED'
  | 'ELEMENT_COUNT_INVALID'
  | 'ELEMENT_COUNT_NOT_REFINED'
  | 'QOI_NOT_MONOTONIC'
  | 'QOI_DIFFERENCE_ZERO'
  | 'NON_POSITIVE_ORDER'
  | 'ORDER_SOLVE_FAILED'
  | 'INVALID_SAFETY_FACTOR';

export class ConvergenceInputError extends Error {
  readonly code: ConvergenceInputErrorCode;

  constructor(code: ConvergenceInputErrorCode, message: string) {
    super(message);
    this.name = 'ConvergenceInputError';
    this.code = code;
  }
}

export interface GridConvergenceIndex {
  safetyFactor: number;
  fineAbsolute: number;
  finePercent: number | null;
  mediumAbsolute: number;
  mediumPercent: number | null;
  /** A value near 1 is consistent with the fitted asymptotic error model. */
  asymptoticRatio: number;
}

export interface ConvergenceResult {
  samples: readonly [ConvergenceSample, ConvergenceSample, ConvergenceSample];
  refinementRatioCoarseToMedium: number;
  refinementRatioMediumToFine: number;
  qoiDifferenceRatio: number;
  observedOrder: number;
  richardsonExtrapolatedQoi: number;
  fineDiscretizationErrorEstimate: number;
  fineDiscretizationErrorPercent: number | null;
  gci: GridConvergenceIndex;
  regime: 'asymptotic_likely' | 'asymptotic_check_failed';
}

/**
 * Fit q(h) = q_exact + C h^p to three monotonically refined solutions.
 *
 * The input order is intentionally strict (coarse, medium, fine) so a caller
 * cannot accidentally obtain a plausible-looking GCI from mislabeled grids.
 */
export function analyzeThreeMeshConvergence(
  samples: readonly ConvergenceSample[],
  options: ConvergenceOptions = {},
): ConvergenceResult {
  if (samples.length !== 3) {
    throw new ConvergenceInputError('SAMPLE_COUNT', 'Exactly three coarse-to-fine samples are required.');
  }
  const tuple = samples.map((sample) => ({ ...sample })) as [
    ConvergenceSample,
    ConvergenceSample,
    ConvergenceSample,
  ];
  validateSamples(tuple);

  const safetyFactor = options.safetyFactor ?? 1.25;
  if (!Number.isFinite(safetyFactor) || safetyFactor <= 0) {
    throw new ConvergenceInputError('INVALID_SAFETY_FACTOR', 'Safety factor must be finite and positive.');
  }
  const tolerance = options.ratioTolerance ?? 1e-10;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new ConvergenceInputError('NON_FINITE_VALUE', 'Refinement-ratio tolerance must be finite and positive.');
  }

  const [coarse, medium, fine] = tuple;
  const ratioCoarseMedium = coarse.meshSize / medium.meshSize;
  const ratioMediumFine = medium.meshSize / fine.meshSize;
  const coarseMediumDifference = medium.qoi - coarse.qoi;
  const mediumFineDifference = fine.qoi - medium.qoi;
  const differenceRatio = Math.abs(coarseMediumDifference / mediumFineDifference);
  const observedOrder = solveObservedOrder(
    ratioCoarseMedium,
    ratioMediumFine,
    differenceRatio,
    tolerance,
  );

  const fineDenominator = ratioMediumFine ** observedOrder - 1;
  const mediumDenominator = ratioCoarseMedium ** observedOrder - 1;
  if (!(fineDenominator > 0) || !(mediumDenominator > 0)) {
    throw new ConvergenceInputError('NON_POSITIVE_ORDER', 'Observed order does not produce a positive discretization-error denominator.');
  }

  const extrapolated = fine.qoi + mediumFineDifference / fineDenominator;
  if (!Number.isFinite(extrapolated)) {
    throw new ConvergenceInputError('ORDER_SOLVE_FAILED', 'Richardson extrapolation produced a non-finite value.');
  }

  const fineError = Math.abs(mediumFineDifference) / fineDenominator;
  const mediumError = Math.abs(coarseMediumDifference) / mediumDenominator;
  const fineGciAbsolute = safetyFactor * fineError;
  const mediumGciAbsolute = safetyFactor * mediumError;
  const asymptoticRatio = mediumGciAbsolute
    / (ratioMediumFine ** observedOrder * fineGciAbsolute);
  const regime = Math.abs(asymptoticRatio - 1) <= 0.05
    ? 'asymptotic_likely'
    : 'asymptotic_check_failed';

  return {
    samples: tuple,
    refinementRatioCoarseToMedium: ratioCoarseMedium,
    refinementRatioMediumToFine: ratioMediumFine,
    qoiDifferenceRatio: differenceRatio,
    observedOrder,
    richardsonExtrapolatedQoi: extrapolated,
    fineDiscretizationErrorEstimate: fineError,
    fineDiscretizationErrorPercent: relativePercent(fineError, extrapolated),
    gci: {
      safetyFactor,
      fineAbsolute: fineGciAbsolute,
      finePercent: relativePercent(fineGciAbsolute, fine.qoi),
      mediumAbsolute: mediumGciAbsolute,
      mediumPercent: relativePercent(mediumGciAbsolute, medium.qoi),
      asymptoticRatio,
    },
    regime,
  };
}

export const analyzeConvergence = analyzeThreeMeshConvergence;

function validateSamples(
  samples: readonly [ConvergenceSample, ConvergenceSample, ConvergenceSample],
): void {
  for (const sample of samples) {
    if (!Number.isFinite(sample.meshSize) || !Number.isFinite(sample.qoi)) {
      throw new ConvergenceInputError('NON_FINITE_VALUE', 'Mesh sizes and QoI values must be finite numbers.');
    }
    if (sample.meshSize <= 0) {
      throw new ConvergenceInputError('INVALID_MESH_SIZE', 'Mesh sizes must be positive.');
    }
    if (sample.elementCount !== undefined
      && (!Number.isInteger(sample.elementCount) || sample.elementCount <= 0)) {
      throw new ConvergenceInputError('ELEMENT_COUNT_INVALID', 'Element counts, when provided, must be positive integers.');
    }
  }

  const suppliedElementCounts = samples.filter((sample) => sample.elementCount !== undefined).length;
  if (suppliedElementCounts !== 0 && suppliedElementCounts !== 3) {
    throw new ConvergenceInputError(
      'ELEMENT_COUNT_INVALID',
      'Element counts must be supplied for all three meshes or omitted from all three.',
    );
  }

  const [coarse, medium, fine] = samples;
  if (!(coarse.meshSize > medium.meshSize && medium.meshSize > fine.meshSize)) {
    throw new ConvergenceInputError('MESH_NOT_REFINED', 'Samples must be ordered coarse-to-fine with strictly decreasing mesh size.');
  }
  if (coarse.elementCount !== undefined
    && medium.elementCount !== undefined
    && fine.elementCount !== undefined
    && !(coarse.elementCount < medium.elementCount && medium.elementCount < fine.elementCount)) {
    throw new ConvergenceInputError('ELEMENT_COUNT_NOT_REFINED', 'Element counts must increase strictly from coarse to fine.');
  }

  const firstDifference = medium.qoi - coarse.qoi;
  const secondDifference = fine.qoi - medium.qoi;
  if (firstDifference === 0 || secondDifference === 0) {
    throw new ConvergenceInputError('QOI_DIFFERENCE_ZERO', 'Adjacent QoI values must differ to estimate an observed order.');
  }
  if (Math.sign(firstDifference) !== Math.sign(secondDifference)) {
    throw new ConvergenceInputError('QOI_NOT_MONOTONIC', 'QoI values must be strictly monotonic across the three meshes.');
  }
}

function solveObservedOrder(
  ratioCoarseMedium: number,
  ratioMediumFine: number,
  qoiDifferenceRatio: number,
  tolerance: number,
): number {
  if (!Number.isFinite(qoiDifferenceRatio) || qoiDifferenceRatio <= 0) {
    throw new ConvergenceInputError('NON_POSITIVE_ORDER', 'QoI differences do not support a positive observed order.');
  }

  if (Math.abs(ratioCoarseMedium - ratioMediumFine)
    <= tolerance * Math.max(ratioCoarseMedium, ratioMediumFine)) {
    const order = Math.log(qoiDifferenceRatio) / Math.log(ratioMediumFine);
    if (!Number.isFinite(order) || order <= 0) {
      throw new ConvergenceInputError('NON_POSITIVE_ORDER', 'QoI differences do not decrease under mesh refinement.');
    }
    return order;
  }

  const logTarget = Math.log(qoiDifferenceRatio);
  const logRatioCoarseMedium = Math.log(ratioCoarseMedium);
  const logRatioMediumFine = Math.log(ratioMediumFine);
  const limitingLogRatio = Math.log(logRatioCoarseMedium / logRatioMediumFine);
  if (logTarget <= limitingLogRatio + tolerance) {
    throw new ConvergenceInputError('NON_POSITIVE_ORDER', 'The unequal refinement ratios imply a non-positive observed order.');
  }

  const residual = (order: number) => theoreticalDifferenceRatioLog(
    order,
    logRatioCoarseMedium,
    logRatioMediumFine,
  ) - logTarget;
  let lower = 1e-10;
  let upper = 1;
  while (residual(upper) < 0 && upper < 128) upper *= 2;
  if (!Number.isFinite(residual(upper)) || residual(upper) < 0) {
    throw new ConvergenceInputError('ORDER_SOLVE_FAILED', 'Could not bracket a finite positive observed order.');
  }

  for (let iteration = 0; iteration < 160; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const value = residual(midpoint);
    if (Math.abs(value) <= tolerance) return midpoint;
    if (value > 0) upper = midpoint;
    else lower = midpoint;
  }
  const order = (lower + upper) / 2;
  if (!Number.isFinite(order) || order <= 0) {
    throw new ConvergenceInputError('ORDER_SOLVE_FAILED', 'Observed-order iteration did not converge.');
  }
  return order;
}

function theoreticalDifferenceRatioLog(
  order: number,
  logRatioCoarseMedium: number,
  logRatioMediumFine: number,
): number {
  return order * logRatioMediumFine
    + logExpm1(order * logRatioCoarseMedium)
    - logExpm1(order * logRatioMediumFine);
}

function logExpm1(value: number): number {
  return value > 50
    ? value + Math.log1p(-Math.exp(-value))
    : Math.log(Math.expm1(value));
}

function relativePercent(absoluteError: number, reference: number): number | null {
  return Math.abs(reference) > Number.EPSILON
    ? (absoluteError / Math.abs(reference)) * 100
    : null;
}
