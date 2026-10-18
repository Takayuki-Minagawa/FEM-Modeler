import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { generateNativeFrameMesh } from '@/mesh/native-frame';
import { resultInputStatus, resultImportExpectations } from '@/core/ir/provenance';
import { resultSolverStatus } from '@/results/import-diagnostics';
import { importResultText } from '@/results/importer';
import { summarizeMesh } from '@/results/package';
import { parseProjectFile } from '@/export/project/load';
import { studyFromResults } from '@/results/studies';
import { buildResultGeometry } from '@/viewer/result-geometry';

beforeEach(() => { useAppStore.getState().createProject('Frame', 'frame'); applyTemplate('frame', 'en'); });
const project = () => structuredClone(useAppStore.getState().ir);

describe('native graph mesh generation', () => {
  it.each(['frame', 'truss'] as const)('creates actual %s connectivity, SI quality, identity, and no solver result', (domain) => {
    useAppStore.getState().createProject(domain, domain); applyTemplate(domain, 'en');
    const ir = project(); const analysisCase = ir.analysis_cases[0]; const before = JSON.stringify(ir);
    const result = generateNativeFrameMesh(ir, analysisCase.id);
    expect(JSON.stringify(ir)).toBe(before); expect(result.mesh!.elements).toHaveLength(ir.geometry.edges.length);
    expect(result.mesh!.elements.map((element) => element.id)).toEqual(ir.geometry.edges.map((edge) => edge.id));
    expect(result.mesh!.nodes.map((node) => node.id).every((id) => ir.geometry.vertices.some((v) => v.id === id))).toBe(true);
    expect(result.fields).toEqual([]); expect(result.checks).toEqual([]); expect(resultSolverStatus(result)).toBe('not_run');
    expect(result.metadata).toMatchObject({ stage: 'mesh_only', mesh_settings_applied: false });
    expect(resultInputStatus(ir, result)).toBe('current');
    const lengths = [...result.mesh!.quality[0].values].sort((a, b) => a - b);
    expect(result.mesh!.representative_size).toBe(lengths[Math.floor(lengths.length / 2)]);
    const data = buildResultGeometry(result, undefined, 1, false)!;
    expect(data.wire.getAttribute('position').count).toBeGreaterThan(0);
    data.surface.dispose(); data.wire.dispose(); data.nodes.dispose();
  });

  it('transforms native nodes into world metres and measures their actual lengths', () => {
    const ir = project(); const body = ir.geometry.bodies[0];
    body.transform = { position: [100, 20, -3], rotation: [0, 0, 90], scale: [2, 2, 2] };
    const result = generateNativeFrameMesh(ir, ir.analysis_cases[0].id);
    const node = result.mesh!.nodes[0]; const vertex = ir.geometry.vertices.find((item) => item.id === node.id)!;
    expect(node.position[0]).toBeCloseTo(100 - 2 * vertex.position[1]);
    expect(node.position[1]).toBeCloseTo(20 + 2 * vertex.position[0]);
    result.mesh!.elements.forEach((element, index) => {
      const edge = ir.geometry.edges.find((item) => item.id === element.id)!;
      const [a, b] = edge.vertex_ids.map((id) => ir.geometry.vertices.find((v) => v.id === id)!.position);
      expect(result.mesh!.quality[0].values[index]).toBeCloseTo(2 * Math.hypot(...a.map((value, axis) => value - b[axis])));
    });
  });

  it('tags incident elements with active case selection IDs and preserves them on project reload', () => {
    const ir = project(); const result = generateNativeFrameMesh(ir, ir.analysis_cases[0].id);
    expect(result.mesh!.elements.some((element) => element.boundary_tags.length > 0)).toBe(true);
    expect(result.mesh!.elements.flatMap((element) => element.boundary_tags).every((tag) => ir.named_selections.some((selection) => selection.id === tag && selection.status === 'active'))).toBe(true);
    ir.results.push(result);
    const loaded = parseProjectFile(JSON.stringify(ir)); expect(loaded.success).toBe(true);
    expect(loaded.data!.results[0].mesh).toEqual(result.mesh); expect(resultSolverStatus(loaded.data!.results[0])).toBe('not_run');
  });

  it('retains zero-length topology for bad-element inspection without asserting solver success', () => {
    const ir = project(); const edge = ir.geometry.edges[0];
    const [a, b] = edge.vertex_ids.map((id) => ir.geometry.vertices.find((v) => v.id === id)!); b.position = [...a.position];
    const result = generateNativeFrameMesh(ir, ir.analysis_cases[0].id);
    expect(summarizeMesh(result.mesh!).badElementIds).toContain(edge.id);
    const rendered = buildResultGeometry(result, undefined, 1, true)!;
    expect(rendered.displayedNodes.map((node) => node.id)).toEqual(expect.arrayContaining(edge.vertex_ids));
    expect(rendered.displayedNodes.length).toBeLessThan(result.mesh!.nodes.length);
    expect(rendered.nodes.getAttribute('position').count).toBe(rendered.displayedNodes.length);
    expect(rendered.nodes.getAttribute('color').getX(0)).toBe(1);
    rendered.surface.dispose(); rendered.wire.dispose(); rendered.nodes.dispose();
    expect(resultSolverStatus(result)).toBe('not_run');
  });

  it('rejects broken connectivity, nonfinite transforms and unsupported continuum cases', () => {
    const ir = project(); ir.geometry.edges[0].vertex_ids[0] = 'missing';
    expect(() => generateNativeFrameMesh(ir, ir.analysis_cases[0].id)).toThrow('connectivity');
    const overflow = project(); overflow.geometry.bodies[0].transform.scale[0] = Number.MAX_VALUE;
    expect(() => generateNativeFrameMesh(overflow, overflow.analysis_cases[0].id)).toThrow(/finite/);
    const unsupported = project(); unsupported.analysis_cases[0].domain_type = 'solid';
    expect(() => generateNativeFrameMesh(unsupported, unsupported.analysis_cases[0].id)).toThrow('frame or truss');
    const imported = project(); imported.geometry.bodies[0].asset_ref = 'cad';
    expect(() => generateNativeFrameMesh(imported, imported.analysis_cases[0].id)).toThrow('Imported CAD');
  });

  it('roundtrips mesh-only packages through importer verification without checks-only or solver-success claims', () => {
    const ir = project(); const result = generateNativeFrameMesh(ir, ir.analysis_cases[0].id);
    const file = JSON.stringify({ format: 'fem-modeler-result-package-v1', manifest: result.metadata, mesh: result.mesh, fields: [] });
    const imported = importResultText(file, 'mesh.json', result.analysis_case_id, result.solver_target, resultImportExpectations(ir, result.solver_target, result.analysis_case_id));
    expect(imported.success).toBe(true); expect(imported.warnings).toEqual([]);
    expect(resultSolverStatus(imported.result!)).toBe('not_run'); expect(resultInputStatus(ir, imported.result!)).toBe('current');
    ir.mesh_controls.global.global_size = 0.01;
    expect(resultInputStatus(ir, result)).toBe('stale');
  });

  it('rejects mesh-only artifacts from convergence even if source claims attach fields and successful checks', () => {
    const ir = project(); const result = generateNativeFrameMesh(ir, ir.analysis_cases[0].id);
    result.checks = [{ kind: 'solver_execution', status: 'pass', value: 0, tolerance: 0, unit: '', message: 'Forged source claim' }];
    expect(resultSolverStatus(result)).toBe('not_run');
    expect(() => studyFromResults([result, { ...result, id: 'two' }, { ...result, id: 'three' }], { fieldName: 'ux', unit: 'm', reduction: 'maximum' })).toThrow('Mesh-only');
  });
});
