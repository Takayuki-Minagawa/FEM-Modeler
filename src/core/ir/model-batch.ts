import type { NamedSelection, ProjectIR } from './types';
import { generateId } from './id-generator';
import { uniqueEntityName } from './names';
import { sectionTargetIssue } from '@/core/sections/assignment';

export type DuplicateKind = 'material' | 'section';
export type AssignmentKind = DuplicateKind;
export interface BatchChange { patch: Partial<ProjectIR> }

/** Duplicate model metadata without changing any existing assignment. */
export function planDuplicate(ir: ProjectIR, kind: DuplicateKind, sourceId: string, copyLabel: string): BatchChange & { createdId: string; name: string } {
  const collection = kind === 'material' ? 'materials' : 'sections';
  const source = ir[collection].find((item) => item.id === sourceId);
  if (!source) throw new Error('bulk.missingEntity');
  const copy = { ...structuredClone(source), id: generateId(kind), name: uniqueEntityName(`${source.name} ${copyLabel}`, ir[collection]) };
  return { patch: { [collection]: [...ir[collection], copy] }, createdId: copy.id, name: copy.name };
}

export function assignmentIssue(ir: ProjectIR, selection: NamedSelection, kind: AssignmentKind, itemId: string): string | null {
  if (selection.status !== 'active' || selection.member_refs.length === 0) return 'assignments.inactive';
  if (kind === 'material') return selection.target_dimension > 0 ? null : 'assignments.materialDimension';
  const section = ir.sections.find((item) => item.id === itemId);
  return section ? sectionTargetIssue(section.section_type, selection, ir.geometry.bodies) : 'bulk.missingEntity';
}

export function planAssignments(ir: ProjectIR, kind: AssignmentKind, itemId: string, targetIds: string[]): BatchChange {
  if (!(kind === 'material' ? ir.materials : ir.sections).some((item) => item.id === itemId)) throw new Error('bulk.missingEntity');
  const targets = new Set(targetIds);
  if (!targets.size) throw new Error('bulk.selectTargets');
  for (const id of targets) {
    const target = ir.named_selections.find((item) => item.id === id);
    if (!target) throw new Error('bulk.missingEntity');
    const issue = assignmentIssue(ir, target, kind, itemId);
    if (issue) throw new Error(issue);
  }
  return { patch: kind === 'material' ? {
    material_assignments: [
      ...ir.material_assignments.filter((item) => !targets.has(item.target_named_selection_id)),
      ...[...targets].map((target) => ({ id: generateId('material_assignment'), material_id: itemId, target_named_selection_id: target, override_allowed: true })),
    ],
  } : {
    section_assignments: [
      ...ir.section_assignments.filter((item) => !targets.has(item.target_named_selection_id)),
      ...[...targets].map((target) => ({ id: generateId('section_assignment'), section_id: itemId, target_named_selection_id: target })),
    ],
  } };
}
