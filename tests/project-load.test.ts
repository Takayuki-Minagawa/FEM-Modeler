import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { parseProjectFile } from '@/export/project/load';

describe('parseProjectFile', () => {
  it('loads a valid current project file', () => {
    const project = createDefaultProject();

    const result = parseProjectFile(JSON.stringify(project));

    expect(result.success).toBe(true);
    expect(result.data?.meta.project_id).toBe(project.meta.project_id);
    expect(result.warning).toBeUndefined();
  });

  it('migrates legacy project files by filling missing sections', () => {
    const legacyProject = createDefaultProject();
    legacyProject.meta.schema_version = '0.0.5';

    const rawLegacy = JSON.parse(JSON.stringify(legacyProject)) as Record<string, unknown>;
    delete rawLegacy.ui_state;
    delete rawLegacy.validation;

    const result = parseProjectFile(JSON.stringify(rawLegacy));

    expect(result.success).toBe(true);
    expect(result.data?.meta.schema_version).toBe('0.1.0');
    expect(result.data?.ui_state.active_panel).toBe('geometry');
    expect(result.data?.validation.summary.error_count).toBe(0);
    expect(result.warning).toContain('0.0.5');
  });

  it('fills missing fields inside array elements during migration', () => {
    const project = createDefaultProject();
    project.meta.schema_version = '0.0.5';

    // Add a body with a missing field (remove 'locked')
    const raw = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    const geometry = raw.geometry as Record<string, unknown>;
    geometry.bodies = [
      {
        id: 'body_test1',
        name: 'TestBody',
        category: 'solid',
        visible: true,
        // 'locked' is missing — should be filled from defaults
        color: '#cccccc',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        topology_ref: '',
        metadata: {},
      },
    ];

    const result = parseProjectFile(JSON.stringify(raw));

    expect(result.success).toBe(true);
    expect(result.data?.geometry.bodies).toHaveLength(1);
    expect(result.data?.geometry.bodies[0].locked).toBe(false);
    expect(result.data?.geometry.bodies[0].name).toBe('TestBody');
  });

  it('rejects malformed structures with a readable error', () => {
    const malformedProject = createDefaultProject();
    const rawMalformed = {
      ...malformedProject,
      geometry: 'invalid-geometry-section',
    };

    const result = parseProjectFile(JSON.stringify(rawMalformed));

    expect(result.success).toBe(false);
    expect(result.error).toContain('geometry');
  });
});
