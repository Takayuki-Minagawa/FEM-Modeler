import { describe, expect, it } from 'vitest';
import { getParticipationMode, participationUpdate, selectParticipatingItems } from '@/core/ir/participation';
import type { DomainType, ParticipationField } from '@/core/ir/types';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { parseProjectFile } from '@/export/project/load';
import { serializeProject } from '@/export/project/save';
import { preflightExport, scopeProjectForAnalysisCaseValidation } from '@/export/compiler';
import { exportOpenSeesPy } from '@/export/openseespy/exporter';
import { exportDOLFINx } from '@/export/dolfinx/exporter';
import { exportOpenFOAM } from '@/export/openfoam/exporter';
import { conditionOverlays } from '@/viewer/condition-data';
import { deleteLoadCascade } from '@/core/ir/relations';
import { runValidation } from '@/validation/engine';

function template(domain: DomainType) {
  useAppStore.getState().createProject('participation', domain);
  applyTemplate(domain, 'en');
  return structuredClone(useAppStore.getState().ir);
}

describe('explicit case participation', () => {
  it('preserves legacy empty=all and nonempty=explicit through loading', () => {
    const ir = template('frame');
    ir.analysis_cases[0].participating_load_ids = [];
    const loaded = parseProjectFile(serializeProject(ir));
    expect(loaded.success).toBe(true);
    const analysisCase = loaded.data!.analysis_cases[0];
    expect(analysisCase.participation_modes).toBeUndefined();
    expect(getParticipationMode(analysisCase, 'participating_load_ids')).toBe('all');
    expect(selectParticipatingItems(analysisCase, 'participating_load_ids', loaded.data!.loads)).toHaveLength(1);
    analysisCase.participating_load_ids = [loaded.data!.loads[0].id];
    expect(getParticipationMode(analysisCase, 'participating_load_ids')).toBe('explicit');
  });

  it.each(['participating_material_ids', 'participating_section_ids', 'participating_bc_ids', 'participating_load_ids', 'participating_ic_ids'] as ParticipationField[])(
    'distinguishes all, explicit and none for %s', (field) => {
      const ir = template('frame');
      const analysisCase = ir.analysis_cases[0];
      const items = [{ id: 'first' }, { id: 'second' }];
      Object.assign(analysisCase, participationUpdate(analysisCase, field, [], 'all'));
      expect(selectParticipatingItems(analysisCase, field, items)).toEqual(items);
      Object.assign(analysisCase, participationUpdate(analysisCase, field, ['second']));
      expect(selectParticipatingItems(analysisCase, field, items)).toEqual([items[1]]);
      Object.assign(analysisCase, participationUpdate(analysisCase, field, []));
      expect(selectParticipatingItems(analysisCase, field, items)).toEqual([]);
      const loaded = parseProjectFile(serializeProject(ir));
      expect(loaded.success).toBe(true);
      expect(getParticipationMode(loaded.data!.analysis_cases[0], field)).toBe('none');
    },
  );

  it('keeps no-load intent through file, validation, overlay, coverage and OpenSees export', () => {
    const ir = template('frame');
    const analysisCase = ir.analysis_cases[0];
    const loadId = ir.loads[0].id;
    Object.assign(analysisCase, participationUpdate(analysisCase, 'participating_load_ids', []));
    const loaded = parseProjectFile(serializeProject(ir)).data!;
    expect(loaded.loads).toHaveLength(1);
    expect(scopeProjectForAnalysisCaseValidation(loaded, analysisCase.id).loads).toEqual([]);
    expect(conditionOverlays(loaded).some((item) => item.kind === 'load')).toBe(false);
    expect(preflightExport(loaded, 'OpenSeesPy', analysisCase.id).coverage?.consumedIds).not.toContain(loadId);
    const exported = exportOpenSeesPy(loaded);
    expect(exported.errors).toEqual([]);
    expect(exported.success).toBe(true);
    expect(exported.script).not.toContain('ops.load(');
    expect(JSON.parse(exported.manifest).consumed_ir_ids).not.toContain(loadId);
    expect(runValidation(loaded, 'OpenSeesPy', analysisCase.id).items.some((item) => item.target_ref === loadId)).toBe(false);
  });

  it('keeps a zero-load thermal solve and rejects missing essential boundaries without re-enabling them', () => {
    const ir = template('thermal');
    const analysisCase = ir.analysis_cases[0];
    const loadId = ir.loads[0].id;
    Object.assign(analysisCase, participationUpdate(analysisCase, 'participating_load_ids', []));
    const exported = exportDOLFINx(ir);
    expect(exported.errors).toEqual([]);
    expect(JSON.parse(exported.manifest).consumed_ir_ids).not.toContain(loadId);
    Object.assign(analysisCase, participationUpdate(analysisCase, 'participating_bc_ids', []));
    const unrestrained = exportDOLFINx(ir);
    expect(unrestrained.success).toBe(false);
    expect(unrestrained.errors.join(' ')).toMatch(/temperature|well.posed|Dirichlet/i);
    expect(getParticipationMode(analysisCase, 'participating_bc_ids')).toBe('none');
  });

  it('does not re-enable excluded OpenFOAM boundary conditions or materials', () => {
    const ir = template('fluid');
    const analysisCase = ir.analysis_cases[0];
    Object.assign(analysisCase, participationUpdate(analysisCase, 'participating_bc_ids', []));
    const exported = exportOpenFOAM(ir);
    expect(exported.success).toBe(false);
    expect(exported.errors.join(' ')).toMatch(/inlet|outlet/i);
    expect(runValidation(ir, 'OpenFOAM', analysisCase.id).items.some((item) => item.code === 'OFM_NO_INLET')).toBe(true);
    Object.assign(analysisCase, participationUpdate(analysisCase, 'participating_bc_ids', [], 'all'));
    Object.assign(analysisCase, participationUpdate(analysisCase, 'participating_material_ids', []));
    expect(exportOpenFOAM(ir).errors.join(' ')).toMatch(/requires exactly one material assignment/i);
  });

  it.each(['thermal', 'fluid'] as const)('raw %s export resolves participating materials before checking assignment cardinality', (domain) => {
    const ir = template(domain);
    const original = ir.materials[0];
    ir.materials.push({ ...structuredClone(original), id: 'other_material', name: 'Other material' });
    ir.material_assignments.push({ ...ir.material_assignments[0], id: 'other_assignment', material_id: 'other_material' });
    Object.assign(ir.analysis_cases[0], participationUpdate(ir.analysis_cases[0], 'participating_material_ids', ['other_material']));
    const exported = domain === 'fluid' ? exportOpenFOAM(ir) : exportDOLFINx(ir);
    expect(exported.errors).toEqual([]);
    expect(exported.success).toBe(true);
    expect(JSON.parse(exported.manifest).consumed_ir_ids).toContain('other_material');
    expect(JSON.parse(exported.manifest).consumed_ir_ids).not.toContain(original.id);
  });

  it('deleting the last explicitly chosen load never enables unrelated loads', () => {
    const ir = template('frame');
    const first = ir.loads[0];
    ir.loads.push({ ...first, id: 'unrelated_load', name: 'Unrelated' });
    ir.analysis_cases[0].participating_load_ids = [first.id];
    deleteLoadCascade(ir, first.id);
    expect(ir.loads).toHaveLength(1);
    expect(getParticipationMode(ir.analysis_cases[0], 'participating_load_ids')).toBe('none');
    expect(scopeProjectForAnalysisCaseValidation(ir, ir.analysis_cases[0].id).loads).toEqual([]);
  });
});
