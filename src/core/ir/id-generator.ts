import { nanoid } from 'nanoid';

const PREFIX_MAP = {
  project: 'proj_',
  body: 'body_',
  face: 'face_',
  edge: 'edge_',
  vertex: 'vtx_',
  named_selection: 'ns_',
  material: 'mat_',
  material_assignment: 'mata_',
  section: 'sec_',
  section_assignment: 'seca_',
  mesh_local: 'mesh_',
  boundary_condition: 'bc_',
  load: 'load_',
  initial_condition: 'ic_',
  analysis_case: 'case_',
  solver_target: 'tgt_',
  validation: 'val_',
  log: 'log_',
  ai_annotation: 'ai_',
  audit: 'aud_',
  reference_frame: 'ref_',
  geometry_parameter: 'gp_',
} as const;

export type IdPrefix = keyof typeof PREFIX_MAP;

export function generateId(prefix: IdPrefix): string {
  return `${PREFIX_MAP[prefix]}${nanoid(12)}`;
}
