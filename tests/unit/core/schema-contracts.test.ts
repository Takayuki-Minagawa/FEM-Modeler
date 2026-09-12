import { describe, expect, it } from 'vitest';
import { nativeShapeSchema, parseNativeShapeMetadata } from '@/core/ir/schema/shapes';
import { boundaryConditionSchema, loadSchema } from '@/core/ir/schema/conditions';
import { createDefaultProject } from '@/core/ir/defaults';
import { parseProjectFile } from '@/export/project/load';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';

const baseLoad = { id: 'load', name: 'load', target_named_selection_id: '', application_mode: 'per_volume',
  direction: [0, -1, 0], magnitude: 1, distribution: 'uniform', temporal_profile: 'constant', load_case: '', coordinate_system: 'global', status: 'confirmed' };

describe('domain schema contracts', () => {
  it.each([
    { shapeType: 'box', width: -1, height: 1, depth: 1 },
    { shapeType: 'pipe', innerRadius: 2, outerRadius: 1, length: 1, segments: 32 },
    { shapeType: 'plateWithHole', width: 1, depth: 1, thickness: 0.1, holeRadius: 0.6 },
    { shapeType: 'lBracket', width: 1, height: 1, thickness: 1, depth: 1 },
    { shapeType: 'frame2d', spanX: 1, spanY: 1, columns: 1, floors: 1 },
    { shapeType: 'cylinder', radius: 1, height: 1, segments: 3.5 },
    { shapeType: 'invented', width: 1 },
    { shapeType: 'box', width: 1, height: 1, depth: 1, temperature: 300 },
  ])('rejects invalid generation parameters: %j', (shape) => {
    expect(nativeShapeSchema.safeParse(shape).success).toBe(false);
  });

  it('extracts generation parameters without destroying existing solver hints', () => {
    const metadata = { shapeType: 'channel', length: 1, height: 1, depth: 0.1, two_dimensional: true, note: 'retained' };
    expect(parseNativeShapeMetadata(metadata)).toMatchObject({ shapeType: 'channel', length: 1 });
    expect(metadata.two_dimensional).toBe(true);
    expect(() => parseNativeShapeMetadata({ shapeType: 'unknown' })).toThrow('Unknown native shape');
  });

  it('permits fluid body force drafts while rejecting physically unrelated loads and values', () => {
    expect(loadSchema.safeParse({ ...baseLoad, load_type: 'body_force', physics_domain: 'fluid' }).success).toBe(true);
    expect(loadSchema.safeParse({ ...baseLoad, load_type: 'body_force', physics_domain: 'thermal' }).success).toBe(false);
    useAppStore.getState().createProject('thermal', 'thermal'); applyTemplate('thermal');
    const condition = useAppStore.getState().ir.boundary_conditions[0];
    expect(boundaryConditionSchema.safeParse({ ...condition, values: { scalar: 300, pressure_basis: 'dynamic' } }).success).toBe(false);
    expect(boundaryConditionSchema.safeParse({ ...condition, physics_domain: 'fluid' }).success).toBe(false);
  });

  it('migrates 0.2 SI values once and downgrades revision-only results', () => {
    useAppStore.getState().createProject('SI source', 'thermal'); applyTemplate('thermal');
    const ir = structuredClone(useAppStore.getState().ir);
    const width = ir.geometry.bodies[0].metadata.width;
    ir.units.system_name = 'mm-N-s';
    const raw = { ...ir, meta: { ...ir.meta, schema_version: '0.2.0' }, convergence_studies: undefined,
      results: [{ id: 'old-result', analysis_case_id: ir.analysis_cases[0].id, solver_target: 'DOLFINx', source_file_name: 'old.csv', imported_at: new Date(0).toISOString(), status: 'complete', checks: [],
        fields: [{ id: 'old-field', name: 'T', location: 'node', component_names: ['T'], unit: 'K', entity_ids: ['1'], values: [300], minimum: 300, maximum: 300 }],
        metadata: { provenance_verified: true, imported_for_model_revision: 1 } }] };
    const loaded = parseProjectFile(JSON.stringify(raw));
    expect(loaded.success).toBe(true);
    expect(loaded.data?.geometry.bodies[0].metadata.width).toBe(width);
    expect(loaded.data?.convergence_studies).toEqual([]);
    expect(loaded.data?.results[0]).toMatchObject({ status: 'partial', metadata: { provenance_verified: false } });
    expect(loaded.data?.results[0].metadata.imported_for_model_revision).toBeUndefined();
    expect(parseProjectFile(JSON.stringify(loaded.data)).success).toBe(true);
  });

  it('requires the new artifact array for current files', () => {
    const ir = { ...createDefaultProject(), convergence_studies: undefined };
    expect(parseProjectFile(JSON.stringify(ir)).error).toContain('convergence_studies');
  });
});
