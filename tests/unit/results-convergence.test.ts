import { describe, expect, it } from 'vitest';
import {
  analyzeThreeMeshConvergence,
  ConvergenceInputError,
} from '@/results/convergence';

describe('three-mesh convergence analysis', () => {
  it('recovers second-order convergence, Richardson extrapolation, and GCI', () => {
    const result = analyzeThreeMeshConvergence([
      { label: 'coarse', meshSize: 0.4, qoi: 10 + 2 * 0.4 ** 2, elementCount: 100 },
      { label: 'medium', meshSize: 0.2, qoi: 10 + 2 * 0.2 ** 2, elementCount: 400 },
      { label: 'fine', meshSize: 0.1, qoi: 10 + 2 * 0.1 ** 2, elementCount: 1_600 },
    ]);

    expect(result.observedOrder).toBeCloseTo(2, 12);
    expect(result.richardsonExtrapolatedQoi).toBeCloseTo(10, 12);
    expect(result.fineDiscretizationErrorEstimate).toBeCloseTo(0.02, 12);
    expect(result.gci.fineAbsolute).toBeCloseTo(0.025, 12);
    expect(result.gci.asymptoticRatio).toBeCloseTo(1, 12);
    expect(result.regime).toBe('asymptotic_likely');
  });

  it('solves observed order for unequal refinement ratios', () => {
    const result = analyzeThreeMeshConvergence([
      { meshSize: 0.4, qoi: 3 - 0.5 * 0.4 ** 2 },
      { meshSize: 0.25, qoi: 3 - 0.5 * 0.25 ** 2 },
      { meshSize: 0.1, qoi: 3 - 0.5 * 0.1 ** 2 },
    ]);

    expect(result.observedOrder).toBeCloseTo(2, 8);
    expect(result.richardsonExtrapolatedQoi).toBeCloseTo(3, 8);
  });

  it('returns null relative GCI when a zero QoI makes normalization undefined', () => {
    const result = analyzeThreeMeshConvergence([
      { meshSize: 0.4, qoi: -0.02 + 2 * 0.4 ** 2 },
      { meshSize: 0.2, qoi: -0.02 + 2 * 0.2 ** 2 },
      { meshSize: 0.1, qoi: 0 },
    ]);

    expect(result.richardsonExtrapolatedQoi).toBeCloseTo(-0.02, 12);
    expect(result.gci.finePercent).toBeNull();
    expect(result.gci.fineAbsolute).toBeGreaterThan(0);
  });

  it.each([
    {
      samples: [{ meshSize: 1, qoi: 1 }, { meshSize: 0.5, qoi: 2 }],
      code: 'SAMPLE_COUNT',
    },
    {
      samples: [{ meshSize: 0.5, qoi: 1 }, { meshSize: 1, qoi: 2 }, { meshSize: 0.25, qoi: 3 }],
      code: 'MESH_NOT_REFINED',
    },
    {
      samples: [{ meshSize: 1, qoi: 1 }, { meshSize: 0.5, qoi: 3 }, { meshSize: 0.25, qoi: 2 }],
      code: 'QOI_NOT_MONOTONIC',
    },
    {
      samples: [{ meshSize: 1, qoi: 1 }, { meshSize: 0.5, qoi: 2 }, { meshSize: 0.25, qoi: 3 }],
      code: 'NON_POSITIVE_ORDER',
    },
    {
      samples: [
        { meshSize: 1, qoi: 1, elementCount: 10 },
        { meshSize: 0.5, qoi: 1.5, elementCount: 9 },
        { meshSize: 0.25, qoi: 1.75, elementCount: 40 },
      ],
      code: 'ELEMENT_COUNT_NOT_REFINED',
    },
    {
      samples: [
        { meshSize: 1, qoi: 1, elementCount: 10 },
        { meshSize: 0.5, qoi: 1.5 },
        { meshSize: 0.25, qoi: 1.75, elementCount: 40 },
      ],
      code: 'ELEMENT_COUNT_INVALID',
    },
  ])('rejects invalid input with code $code', ({ samples, code }) => {
    try {
      analyzeThreeMeshConvergence(samples);
      throw new Error('Expected convergence validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConvergenceInputError);
      expect((error as ConvergenceInputError).code).toBe(code);
    }
  });
});
