import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { applyTemplate } from '@/lib/project-templates';
import { useAppStore } from '@/state/store';
import { canonicalJson, comparisonFingerprint, createExportProvenance, inputFingerprint, resultImportExpectations, resultMatchesInput, solverInputProjection } from '@/core/ir/provenance';
import { importResultText } from '@/results/importer';
import { getUnitPreset } from '@/core/units/presets';

function project() { return structuredClone(useAppStore.getState().ir); }
function csv(metadata: object) { return `# FEM_MODELER_PROVENANCE ${JSON.stringify(metadata)}\nnode_id,ux_m\n1,0.0001`; }

describe('solver input identity', () => {
  beforeEach(() => {
    useAppStore.getState().createProject('provenance', 'frame');
    applyTemplate('frame', 'en');
  });

  it('uses standard SHA-256 over a deterministic input projection', () => {
    const ir = project(), id = ir.analysis_cases[0].id;
    const canonical = canonicalJson(solverInputProjection(ir, 'OpenSeesPy', id));
    expect(inputFingerprint(ir, 'OpenSeesPy', id)).toBe(`sha256:${createHash('sha256').update(canonical).digest('hex')}`);
    expect(canonicalJson({ b: 2, a: { z: 1, c: 0 } })).toBe(canonicalJson({ a: { c: 0, z: 1 }, b: 2 }));
    expect(() => canonicalJson({ magnitude: NaN })).toThrow('non-finite');
  });

  it('rejects old results after Undo followed by a different edit at the same revision', () => {
    const base = project(), loadId = base.loads[0].id, caseId = base.analysis_cases[0].id;
    useAppStore.getState().updateLoad(loadId, { magnitude: 20_000 });
    const old = project();
    const metadata = createExportProvenance(old, 'OpenSeesPy', caseId);
    useAppStore.getState().undo();
    useAppStore.getState().updateLoad(loadId, { magnitude: 30_000 });
    const current = project();
    const imported = importResultText(csv(metadata), 'results.csv', caseId, 'OpenSeesPy', resultImportExpectations(current, 'OpenSeesPy', caseId));
    expect(imported.success).toBe(false);
    expect(imported.error).toContain('fingerprint');
  });

  it('preserves result identity across name, color, display-unit and artifact changes', () => {
    const ir = project(), id = ir.analysis_cases[0].id;
    const metadata = createExportProvenance(ir, 'OpenSeesPy', id);
    const changed = structuredClone(ir);
    changed.meta.project_name = 'new name'; changed.meta.updated_at = '2030-01-01';
    changed.geometry.bodies[0].name = 'renamed'; changed.geometry.bodies[0].color = '#fff';
    changed.geometry.bodies[0].visible = false; changed.materials[0].name = 'renamed material';
    changed.analysis_cases[0].name = 'renamed case'; changed.loads[0].name = 'renamed load';
    changed.units = getUnitPreset('mm-N-s'); changed.validation.model_revision += 10;
    expect(inputFingerprint(changed, 'OpenSeesPy', id)).toBe(metadata.input_fingerprint);
    const imported = importResultText(csv(metadata), 'results.csv', id, 'OpenSeesPy', resultImportExpectations(changed, 'OpenSeesPy', id));
    expect(imported.success).toBe(true);
    expect(imported.result?.metadata.provenance_verified).toBe(true);
    expect(resultMatchesInput(changed, imported.result!)).toBe(true);
    changed.loads[0].magnitude += 1;
    expect(resultMatchesInput(changed, imported.result!)).toBe(false);
  });

  it('rejects a forked project and a saved copy with different inputs', () => {
    const ir = project(), id = ir.analysis_cases[0].id;
    const metadata = createExportProvenance(ir, 'OpenSeesPy', id);
    ir.meta.project_id = 'other-project';
    expect(importResultText(csv(metadata), 'r.csv', id, 'OpenSeesPy', resultImportExpectations(ir, 'OpenSeesPy', id)).error).toContain('another project');
    ir.meta.project_id = metadata.project_id; ir.geometry.bodies[0].transform.scale[0] *= 2;
    expect(importResultText(csv(metadata), 'r.csv', id, 'OpenSeesPy', resultImportExpectations(ir, 'OpenSeesPy', id)).success).toBe(false);
  });

  it('archives another mesh only with explicit consent and matching physics', () => {
    const ir = project(), id = ir.analysis_cases[0].id;
    const metadata = createExportProvenance(ir, 'OpenSeesPy', id);
    ir.mesh_controls.global.global_size = 0.1;
    expect(comparisonFingerprint(ir, 'OpenSeesPy', id)).toBe(metadata.comparison_fingerprint);
    const expected = resultImportExpectations(ir, 'OpenSeesPy', id);
    expect(importResultText(csv(metadata), 'r.csv', id, 'OpenSeesPy', expected).success).toBe(false);
    const imported = importResultText(csv(metadata), 'r.csv', id, 'OpenSeesPy', { ...expected, allowMeshVariation: true });
    expect(imported.success).toBe(true);
    expect(imported.result?.metadata.input_match).toBe('mesh_variant');
    expect(resultMatchesInput(ir, imported.result!)).toBe(false);
    ir.loads[0].magnitude *= 2;
    expect(importResultText(csv(metadata), 'r.csv', id, 'OpenSeesPy', { ...resultImportExpectations(ir, 'OpenSeesPy', id), allowMeshVariation: true }).success).toBe(false);
  });

  it('does not trust stored verification flags or an incomplete run identity', () => {
    const ir = project(), id = ir.analysis_cases[0].id;
    const metadata = { ...createExportProvenance(ir, 'OpenSeesPy', id), provenance_verified: true, imported_for_model_revision: 1, run_id: '' };
    const imported = importResultText(csv(metadata), 'r.csv', id, 'OpenSeesPy', resultImportExpectations(ir, 'OpenSeesPy', id));
    expect(imported.result?.metadata.provenance_verified).toBe(false);
    expect(imported.result?.metadata.imported_for_model_revision).toBeUndefined();
    expect(imported.result?.status).toBe('partial');
  });

  it('allocates separate run IDs while preserving deterministic fingerprints', () => {
    const ir = project();
    const a = createExportProvenance(ir, 'OpenSeesPy'), b = createExportProvenance(ir, 'OpenSeesPy');
    expect(a.input_fingerprint).toBe(b.input_fingerprint);
    expect(a.run_id).not.toBe(b.run_id);
  });

  it('excludes selections used only by local mesh controls from comparison identity', () => {
    useAppStore.getState().createProject('thermal', 'thermal'); applyTemplate('thermal');
    const ir = project(), id = ir.analysis_cases[0].id;
    const before = createExportProvenance(ir, 'DOLFINx', id);
    const meshSelection = { ...ir.named_selections[0], id: 'mesh-only', entity_type: 'face' as const,
      target_dimension: 2 as const, member_refs: [ir.geometry.faces[0].id] };
    ir.named_selections.push(meshSelection);
    ir.mesh_controls.local.push({ id: 'mesh-local', target_named_selection_id: meshSelection.id, control_type: 'local_size',
      size: 0.01, layers: null, bias: null, transfinite_hint: false, boundary_layer_hint: false, priority: 0 });
    expect(inputFingerprint(ir, 'DOLFINx', id)).not.toBe(before.input_fingerprint);
    expect(comparisonFingerprint(ir, 'DOLFINx', id)).toBe(before.comparison_fingerprint);
  });

  it('cannot verify a mesh variant with no input fingerprint', () => {
    const ir = project(), id = ir.analysis_cases[0].id;
    const metadata = { ...createExportProvenance(ir, 'OpenSeesPy', id), input_fingerprint: undefined };
    const imported = importResultText(csv(metadata), 'r.csv', id, 'OpenSeesPy', { ...resultImportExpectations(ir, 'OpenSeesPy', id), allowMeshVariation: true });
    expect(imported.result?.metadata.provenance_verified).toBe(false);
  });
});
