import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import {
  createProjectDraftRecord,
  summarizeProjectDraft,
} from '@/lib/project-draft-storage';

describe('project draft storage helpers', () => {
  it('builds a draft record with project metadata', () => {
    const ir = createDefaultProject();
    ir.meta.project_id = 'project_123';
    ir.meta.project_name = 'Autosave Sample';
    ir.meta.schema_version = '9.9.9';

    const record = createProjectDraftRecord(ir, '2026-03-24T10:11:12.000Z');

    expect(record.key).toBe('current');
    expect(record.projectId).toBe('project_123');
    expect(record.projectName).toBe('Autosave Sample');
    expect(record.schemaVersion).toBe('9.9.9');
    expect(record.savedAt).toBe('2026-03-24T10:11:12.000Z');
    expect(record.ir).toBe(ir);
  });

  it('derives a compact summary from a draft record', () => {
    const ir = createDefaultProject();
    ir.meta.project_id = 'project_456';
    ir.meta.project_name = 'Recovered Project';

    const summary = summarizeProjectDraft(
      createProjectDraftRecord(ir, '2026-03-24T11:22:33.000Z'),
    );

    expect(summary).toEqual({
      projectId: 'project_456',
      projectName: 'Recovered Project',
      savedAt: '2026-03-24T11:22:33.000Z',
      schemaVersion: ir.meta.schema_version,
    });
  });
});
