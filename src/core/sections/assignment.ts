import type { GeometryBody, NamedSelection, SectionType } from '@/core/ir/types';

/** Shared dimension/category check; callers separately validate references and selection status. */
export function sectionTargetIssue(
  sectionType: SectionType,
  selection: NamedSelection,
  bodies: readonly GeometryBody[],
): 'assignments.shellDimension' | 'assignments.beamDimension' | null {
  if (sectionType === 'shell_thickness') return selection.target_dimension === 2 ? null : 'assignments.shellDimension';
  if (selection.target_dimension === 1) return null;
  if (selection.target_dimension === 3 && selection.entity_type === 'body'
    && selection.member_refs.length > 0
    && selection.member_refs.every((id) => bodies.some((body) => body.id === id && body.category === 'beam_region'))) return null;
  return 'assignments.beamDimension';
}
