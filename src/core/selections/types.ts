export type EditableEntityType = 'body' | 'face' | 'edge' | 'vertex';
export type SelectionOperation = 'add' | 'remove' | 'replace' | 'invert';
export type SelectionPredicate =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'all' }
  | { kind: 'coordinate_range'; axis: 0 | 1 | 2; min: number | null; max: number | null }
  | { kind: 'face_normal'; direction: [number, number, number]; tolerance_degrees: number };
/** A recipe never runs automatically; member_refs remains the authoritative evaluated set. */
export interface NamedSelectionQuery {
  version: 1;
  coordinate_frame: 'world';
  length_unit: 'm';
  operation: SelectionOperation;
  base_member_refs: string[];
  predicate: SelectionPredicate;
}
