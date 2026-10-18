import { describe, expect, it } from 'vitest';
import { createModelProject, MODEL_TEMPLATES } from '@/modeling/project';
import { modelInputFingerprint, modelValidationRunStatus, validateModel } from '@/modeling/validation';
import { modelDiagnosticTarget } from '@/modeling/navigation';
import { parseProjectFile } from '@/export/project/load';
import { serializeProject } from '@/export/project/save';
import { useAppStore } from '@/state/store';
import type { ProjectIR } from '@/core/ir/types';

const model = () => structuredClone(createModelProject('Components', 'frame', 'en'));
const codes = (ir: ProjectIR) => validateModel(ir).items.map(item => item.code);

describe('model-only consistency checks', () => {
  it.each(MODEL_TEMPLATES)('accepts a %s model without materials, loads, supports, cases, or solvers', template => {
    const ir = createModelProject('Components', template, 'en');
    expect(ir.materials).toEqual([]);
    expect(ir.sections).toEqual([]);
    expect(ir.loads).toEqual([]);
    expect(ir.boundary_conditions).toEqual([]);
    expect(ir.analysis_cases).toEqual([]);
    const result = validateModel(ir);
    expect(result.summary).toMatchObject({ error_count: 0, warning_count: 0 });
    expect(result.items.every(item => item.code.startsWith('MODEL_'))).toBe(true);
    expect(result.context).toBeUndefined();
    expect(result.model_context?.kind).toBe('model');
    if (template === 'empty') expect(result.items.map(item => item.code)).toEqual(['MODEL_EMPTY']);
  });

  it('rejects invalid dimensions, zero placement scale, and world-coordinate overflow', () => {
    const ir = model();
    ir.geometry.bodies[0].metadata.spanX = -1;
    expect(codes(ir)).toContain('MODEL_SHAPE');
    ir.geometry.bodies[0].metadata.spanX = 6;
    ir.geometry.bodies[0].transform.scale[0] = 0;
    expect(codes(ir)).toContain('MODEL_TRANSFORM');
    ir.geometry.bodies[0].transform.scale[0] = 1e300;
    expect(codes(ir)).toContain('MODEL_COORDINATE');
    ir.geometry.bodies[0].transform.scale[0] = 1;
    ir.geometry.bodies[0].metadata.spanX = 1e200;
    expect(codes(ir)).toContain('MODEL_SHAPE');
  });

  it('checks topology ownership, missing references, duplicate IDs, and coincident edges', () => {
    const ir = model();
    const edge = ir.geometry.edges[0];
    edge.vertex_ids = [ir.geometry.vertices[0].id, ir.geometry.vertices[0].id];
    expect(codes(ir)).toContain('MODEL_EDGE');
    edge.vertex_ids[1] = 'missing';
    expect(validateModel(ir).items).toContainEqual(expect.objectContaining({ code: 'MODEL_REFERENCE', target_ref: edge.id, message: expect.stringContaining('vertex_ids: missing') }));
    ir.geometry.vertices[0].body_id = 'other-body';
    expect(codes(ir)).toContain('MODEL_REFERENCE');
    ir.geometry.vertices[1].id = ir.geometry.vertices[0].id;
    expect(codes(ir)).toContain('MODEL_DUPLICATE_ID');
  });

  it('checks composition groups without requiring any usage', () => {
    const ir = model();
    ir.named_selections[0].usages = [];
    expect(validateModel(ir).summary.error_count).toBe(0);
    ir.named_selections[0].member_refs = ['removed-body'];
    expect(codes(ir)).toContain('MODEL_SELECTION');
    ir.named_selections[0].member_refs = [];
    ir.named_selections[0].status = 'stale';
    expect(codes(ir)).toContain('MODEL_SELECTION_EMPTY');
    expect(codes(ir)).toContain('MODEL_SELECTION_STALE');
    ir.named_selections[0].entity_type = 'node';
    ir.named_selections[0].target_dimension = 0;
    ir.named_selections[0].member_refs = ['external-node'];
    expect(codes(ir)).toContain('MODEL_SELECTION_EXTERNAL');
    expect(codes(ir)).not.toContain('MODEL_SELECTION');
  });

  it('checks optional assignment references without requiring material parameters', () => {
    const ir = model();
    ir.material_assignments = [{ id: 'assignment', material_id: 'missing-material', target_named_selection_id: ir.named_selections[0].id, override_allowed: false }];
    expect(validateModel(ir).items).toContainEqual(expect.objectContaining({ code: 'MODEL_REFERENCE', target_ref: 'assignment' }));
    expect(modelDiagnosticTarget(ir, 'assignment')?.panel).toBe('materials');
    ir.material_assignments = [];
    ir.sections = [{ id: 'section', name: 'Section', section_type: 'beam_rect', dimensions: { width: 0.1, height: 0.2 }, material_id: '', area: null, inertia_y: null, inertia_z: null, torsion_constant: null, thickness: null, metadata: {} }];
    expect(validateModel(ir).summary.error_count).toBe(0);
    ir.sections[0].orientation_ref = 'missing-frame';
    expect(codes(ir)).toContain('MODEL_REFERENCE');
  });

  it('checks coordinate-system attachment cycles and independent finite axes', () => {
    const ir = model();
    const frame = { id: 'local', name: 'Local', origin: [0, 0, 0] as [number, number, number], axis_x: [1, 0, 0] as [number, number, number], axis_y: [0, 1, 0] as [number, number, number], axis_z: [0, 0, 1] as [number, number, number], type: 'cartesian' as const, attached_to: ir.geometry.bodies[0].id };
    ir.geometry.reference_frames.push(frame);
    expect(validateModel(ir).summary.error_count).toBe(0);
    frame.axis_y = [2, 0, 0];
    expect(codes(ir)).toContain('MODEL_FRAME');
    frame.attached_to = frame.id;
    expect(codes(ir)).toContain('MODEL_FRAME_CYCLE');
  });
});

describe('model check provenance and navigation', () => {
  it('does not treat legacy common or solver checks as model checks', () => {
    const ir = model();
    ir.validation = { ...ir.validation, last_run_at: '2026-10-18T00:00:00Z', validated_revision: ir.validation.model_revision, context: { analysis_case_id: 'legacy', solver_target: 'OpenSeesPy', input_fingerprint: 'old-analysis' } };
    expect(modelValidationRunStatus(ir)).toBe('not_run');
    delete ir.validation.context;
    expect(modelValidationRunStatus(ir)).toBe('not_run');
  });

  it('detects changes even when an external edit leaves the revision unchanged', () => {
    const ir = model();
    ir.validation = validateModel(ir);
    expect(modelValidationRunStatus(ir)).toBe('current');
    ir.geometry.bodies[0].transform.position[0] += 0.001;
    expect(modelValidationRunStatus(ir)).toBe('stale');
    ir.validation = validateModel(ir);
    ir.named_selections[0].name = 'Edited group';
    expect(modelValidationRunStatus(ir)).toBe('stale');
  });

  it('retains the model scope through JSON save/load and invalidates it after a store edit', () => {
    useAppStore.getState().loadProject(model());
    useAppStore.getState().runModelValidation();
    const ir = useAppStore.getState().ir;
    const loaded = parseProjectFile(serializeProject(ir));
    expect(loaded.success).toBe(true);
    if (!loaded.success || !loaded.data) throw new Error('Model round-trip failed');
    expect(modelValidationRunStatus(loaded.data)).toBe('current');
    useAppStore.getState().updateBody(ir.geometry.bodies[0].id, { transform: { ...ir.geometry.bodies[0].transform, position: [3, 0, 0] } });
    expect(modelValidationRunStatus(useAppStore.getState().ir)).toBe('stale');
  });

  it('excludes legacy analysis data from the model fingerprint and diagnostics', () => {
    const ir = model();
    const fingerprint = modelInputFingerprint(ir);
    ir.loads = [{ id: 'legacy-load', magnitude: NaN, target_named_selection_id: 'missing' }] as ProjectIR['loads'];
    ir.boundary_conditions = [{ id: 'legacy-bc', target_named_selection_id: 'missing' }] as ProjectIR['boundary_conditions'];
    ir.solver_targets = [];
    expect(modelInputFingerprint(ir)).toBe(fingerprint);
    expect(validateModel(ir).summary.error_count).toBe(0);
    expect(modelDiagnosticTarget(ir, 'legacy-load')).toBeNull();
    expect(modelDiagnosticTarget(ir, 'legacy-bc')).toBeNull();
    expect(modelDiagnosticTarget(ir, ir.geometry.edges[0].id)?.panel).toBe('geometry');
  });
});
