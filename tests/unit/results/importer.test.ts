import { describe, expect, it } from 'vitest';
import { importResultText, solverTargetForProfile } from '@/results';

describe('ResultIR import', () => {
  it('imports numeric solver CSV fields with units and ranges', () => {
    const csv = 'node_id,ux_m,uy_m,reaction_x_N\r\n1,0,-0.001,10\r\n2,0.002,-0.004,-10';

    const response = importResultText(csv, 'results.csv', 'case_1', 'OpenSeesPy');

    expect(response.success).toBe(true);
    expect(response.result?.fields.map((field) => [field.name, field.unit])).toEqual([
      ['ux', 'm'], ['uy', 'm'], ['reaction_x', 'N'],
    ]);
    expect(response.result?.fields[1].minimum).toBe(-0.004);
    expect(response.result?.fields[1].maximum).toBe(-0.001);
    expect(response.result?.fields[0].entity_ids).toEqual(['1', '2']);
    expect(response.result?.status).toBe('partial');
    expect(response.result?.metadata.provenance_verified).toBe(false);
  });

  it('verifies a provenance-bearing solver CSV against the selected case and revision', () => {
    const provenance = JSON.stringify({
      export_target: 'OpenSeesPy', analysis_case_id: 'case_1', model_revision: 7,
    });
    const csv = `# FEM_MODELER_PROVENANCE ${provenance}\nnode_id,ux_m\n1,0.1`;
    const response = importResultText(csv, 'results.csv', 'case_1', 'OpenSeesPy', { expectedModelRevision: 7 });

    expect(response.success).toBe(true);
    expect(response.result?.status).toBe('complete');
    expect(response.result?.metadata).toMatchObject({
      provenance_verified: true,
      imported_for_model_revision: 7,
    });
  });

  it('imports reaction balance and convergence manifests', () => {
    const manifest = JSON.stringify({
      analysis_return_code: 0,
      force_imbalance_N: [1e-9, -2e-9],
      balance_tolerance_N: 1e-6,
      balance_status: 'pass',
    });

    const response = importResultText(manifest, 'result_manifest.json', 'case_1', 'OpenSeesPy');

    expect(response.success).toBe(true);
    expect(response.result?.checks.map((check) => check.kind)).toEqual(['force_balance', 'solver_convergence']);
    expect(response.result?.checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('keeps process success separate from numerical convergence', () => {
    const response = importResultText(JSON.stringify({
      execution_return_code: 0,
      numerical_convergence: 'not_evaluated',
    }), 'result_manifest.json', 'case_1', 'OpenFOAM');
    expect(response.success).toBe(true);
    expect(response.result?.checks).toEqual([
      expect.objectContaining({ kind: 'solver_execution', status: 'pass' }),
    ]);
    expect(response.result?.checks.some((check) => check.kind === 'solver_convergence')).toBe(false);
  });

  it('rejects malformed or nonnumeric CSV', () => {
    const response = importResultText('node_id,label\n1,abc', 'bad.csv', 'case_1', 'DOLFINx');
    expect(response.success).toBe(false);
    expect(response.error).toContain('no finite numeric field');
  });

  it('bounds CSV shape before materializing result fields', () => {
    const headers = Array.from({ length: 257 }, (_, index) => `v${index}`).join(',');
    const values = Array.from({ length: 257 }, () => '1').join(',');
    const response = importResultText(`${headers}\n${values}`, 'wide.csv', 'case_1', 'DOLFINx');
    expect(response.success).toBe(false);
    expect(response.error).toContain('256-column safety limit');
  });

  it('rejects missing numeric cells and ambiguous headers or entity IDs', () => {
    const samples = [
      ['node_id,ux_m\n1,0\n2,', 'missing value'],
      ['node_id,ux_m,ux_m\n1,0,0', 'headers must be unique'],
      ['node_id,ux_m\n,0', 'entity IDs must not be empty'],
      ['node_id,ux_m\n1,0\n1,1', 'entity IDs must be unique'],
    ] as const;
    for (const [csv, message] of samples) {
      const response = importResultText(csv, 'results.csv', 'case_1', 'OpenSeesPy');
      expect(response.success).toBe(false);
      expect(response.error).toContain(message);
    }
  });

  it('warns when explicitly nonnumeric CSV columns are skipped', () => {
    const provenance = JSON.stringify({
      export_target: 'OpenSeesPy', analysis_case_id: 'case_1', model_revision: 3,
    });
    const response = importResultText(
      `# FEM_MODELER_PROVENANCE ${provenance}\nnode_id,label,ux_m\n1,A,0\n2,B,1`,
      'results.csv',
      'case_1',
      'OpenSeesPy',
      { expectedModelRevision: 3 },
    );
    expect(response.success).toBe(true);
    expect(response.warnings.some((warning) => warning.includes('label'))).toBe(true);
    expect(response.result?.metadata.provenance_verified).toBe(true);
    expect(response.result?.status).toBe('partial');
  });

  it('recomputes force balance and rejects malformed conservation values', () => {
    const forgedPass = importResultText(JSON.stringify({
      force_imbalance_N: [2],
      balance_tolerance_N: 1,
      balance_status: 'pass',
    }), 'result_manifest.json', 'case_1', 'OpenSeesPy');
    expect(forgedPass.success).toBe(true);
    expect(forgedPass.result?.checks[0].status).toBe('fail');

    for (const manifest of [
      { force_imbalance_N: [] },
      { force_imbalance_N: [0], balance_tolerance_N: -1 },
      { force_imbalance_N: [0], balance_tolerance_N: '1' },
    ]) {
      const response = importResultText(JSON.stringify(manifest), 'result_manifest.json', 'case_1', 'OpenSeesPy');
      expect(response.success).toBe(false);
    }
  });

  it('rejects a manifest whose declared solver differs from the selected case', () => {
    const response = importResultText(JSON.stringify({
      export_target: 'DOLFINx',
      converged_reason: 1,
    }), 'result_manifest.json', 'case_1', 'OpenFOAM');

    expect(response.success).toBe(false);
    expect(response.error).toContain('produced by DOLFINx');
  });

  it('derives the solver target from the analysis-case profile', () => {
    expect(solverTargetForProfile('openseespy_frame_basic')).toBe('OpenSeesPy');
    expect(solverTargetForProfile('dolfinx_steady_heat')).toBe('DOLFINx');
    expect(solverTargetForProfile('openfoam_simpleFoam')).toBe('OpenFOAM');
  });

  it('rejects manifests for a different analysis case or model revision', () => {
    const wrongCase = importResultText(JSON.stringify({
      export_target: 'OpenSeesPy', analysis_case_id: 'case_2', model_revision: 4,
      analysis_return_code: 0,
    }), 'result_manifest.json', 'case_1', 'OpenSeesPy', { expectedModelRevision: 4 });
    expect(wrongCase.success).toBe(false);
    expect(wrongCase.error).toContain('case_2');

    const wrongRevision = importResultText(JSON.stringify({
      export_target: 'OpenSeesPy', analysis_case_id: 'case_1', model_revision: 3,
      analysis_return_code: 0,
    }), 'result_manifest.json', 'case_1', 'OpenSeesPy', { expectedModelRevision: 4 });
    expect(wrongRevision.success).toBe(false);
    expect(wrongRevision.error).toContain('revision 3');
  });
});
