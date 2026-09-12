import { describe, expect, it } from 'vitest';
import { importResultText } from '@/results/importer';

const read = (data: Record<string, unknown>) => importResultText(JSON.stringify(data), 'manifest.json', 'case_1', 'DOLFINx');

describe('conservation and residual evidence', () => {
  it('recomputes force, moment, heat and mass balances from raw totals, ignoring claimed success', () => {
    const response = read({
      applied_force_N: [10, 0, 0], reaction_force_N: [-8, 0, 0],
      force_imbalance_N: [0, 0, 0], balance_tolerance_N: 1,
      applied_moment_Nm: [0, 0, 5], reaction_moment_Nm: [0, 0, -5], moment_balance_tolerance_Nm: 1e-6,
      heat_boundary_outward_W: [-100, 110], heat_source_W: 10, heat_balance_tolerance_W: 1e-6,
      mass_boundary_outward_kg_s: [-2, 3], mass_source_kg_s: 0, mass_balance_tolerance_kg_s: 0.1,
      balance_status: 'pass',
    });
    expect(response.success).toBe(true);
    expect(response.result?.checks.map(({ kind, value, status }) => ({ kind, value, status }))).toEqual([
      { kind: 'force_balance', value: 2, status: 'fail' },
      { kind: 'moment_balance', value: 0, status: 'pass' },
      { kind: 'heat_balance', value: 0, status: 'pass' },
      { kind: 'mass_balance', value: 1, status: 'fail' },
    ]);
    expect(response.result?.status).toBe('failed');
  });

  it('does not infer heat or mass success without a tolerance or measured totals', () => {
    const response = read({ heat_boundary_outward_W: [-1, 1], heat_source_W: 0, mass_balance_status: 'pass' });
    expect(response.result?.checks).toEqual([expect.objectContaining({ kind: 'heat_balance', status: 'not_available' })]);
    expect(read({ heat_balance_status: 'pass', mass_balance_status: 'pass' }).success).toBe(false);
  });

  it('preserves an explicit failure when solver codes disagree', () => {
    expect(read({ converged_reason: 1, analysis_return_code: -1 }).result?.checks[0].status).toBe('fail');
    expect(read({ converged_reason: -1, analysis_return_code: 0 }).result?.checks[0].status).toBe('fail');
  });

  it('evaluates the last measured residual for every declared field', () => {
    const data = {
      residual_tolerances: { p: 1e-4, U: 1e-5 },
      residual_history: [{ iteration: 1, values: { p: 1, U: 1 } }, { iteration: 10, values: { p: 1e-5, U: 5e-6 } }],
      execution_return_code: 0,
    };
    expect(read(data).result?.checks[0]).toMatchObject({ kind: 'solver_convergence', value: 0.5, status: 'pass' });
    data.residual_history[1].values.U = 1e-3;
    expect(read(data).result?.checks[0].status).toBe('fail');
    expect(read(data).result?.checks[1].status).toBe('pass');
  });

  it.each([
    { applied_force_N: [1], reaction_force_N: [1, 2] },
    { applied_force_N: [Number.MAX_VALUE], reaction_force_N: [Number.MAX_VALUE] },
    { applied_moment_Nm: [1] },
    { heat_boundary_outward_W: [1] },
    { heat_boundary_outward_W: [1], heat_source_W: 0, heat_balance_tolerance_W: -1 },
    { residual_history: [], residual_tolerances: { p: 1 } },
    { residual_history: [{ iteration: 1, values: {} }], residual_tolerances: { p: 1 } },
    { residual_history: [{ iteration: 1, values: { p: 1 } }, { iteration: 1, values: { p: 0 } }], residual_tolerances: { p: 1 } },
    { residual_history: [{ iteration: 1, values: { p: 1 } }], residual_tolerances: { p: 0 } },
    { residual_history: [{ iteration: 1, values: { p: Number.MAX_VALUE } }], residual_tolerances: { p: Number.MIN_VALUE } },
    { converged_reason: 1.5 },
    { analysis_return_code: '0' },
  ])('rejects incomplete or nonfinite numeric evidence: %j', (data) => {
    expect(read(data).success).toBe(false);
  });
});
