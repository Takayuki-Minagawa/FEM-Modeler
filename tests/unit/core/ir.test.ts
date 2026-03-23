import { describe, it, expect } from 'vitest';
import { createDefaultProject, SCHEMA_NAME, SCHEMA_VERSION } from '@/core/ir/defaults';
import { generateId } from '@/core/ir/id-generator';
import { getUnitPreset, UNIT_PRESETS } from '@/core/units/presets';

describe('IR defaults', () => {
  it('creates a valid default project', () => {
    const project = createDefaultProject();

    expect(project.meta.schema_name).toBe(SCHEMA_NAME);
    expect(project.meta.schema_version).toBe(SCHEMA_VERSION);
    expect(project.meta.project_name).toBe('Untitled Project');
    expect(project.meta.domain_type).toBe('frame');
    expect(project.units.system_name).toBe('SI');
    expect(project.geometry.bodies).toHaveLength(0);
    expect(project.named_selections).toHaveLength(0);
    expect(project.materials).toHaveLength(0);
    expect(project.solver_targets).toHaveLength(3);
  });

  it('has three solver targets by default', () => {
    const project = createDefaultProject();
    const names = project.solver_targets.map((t) => t.target_name);
    expect(names).toContain('OpenSeesPy');
    expect(names).toContain('DOLFINx');
    expect(names).toContain('OpenFOAM');
  });
});

describe('ID generator', () => {
  it('generates IDs with correct prefixes', () => {
    expect(generateId('project')).toMatch(/^proj_/);
    expect(generateId('body')).toMatch(/^body_/);
    expect(generateId('face')).toMatch(/^face_/);
    expect(generateId('named_selection')).toMatch(/^ns_/);
    expect(generateId('material')).toMatch(/^mat_/);
    expect(generateId('boundary_condition')).toMatch(/^bc_/);
    expect(generateId('load')).toMatch(/^load_/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId('body')));
    expect(ids.size).toBe(100);
  });
});

describe('Unit presets', () => {
  it('has SI, mm-N-s, mm-t-s presets', () => {
    expect(UNIT_PRESETS).toHaveLength(3);
    const names = UNIT_PRESETS.map((p) => p.name);
    expect(names).toContain('SI');
    expect(names).toContain('mm-N-s');
    expect(names).toContain('mm-t-s');
  });

  it('returns SI by default', () => {
    const si = getUnitPreset('SI');
    expect(si.base_length).toBe('m');
    expect(si.base_force).toBe('N');
    expect(si.base_mass).toBe('kg');
  });

  it('returns SI for unknown preset name', () => {
    const unknown = getUnitPreset('unknown');
    expect(unknown.system_name).toBe('SI');
  });
});
