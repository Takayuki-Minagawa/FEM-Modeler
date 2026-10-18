import { produce } from 'immer';
import { createDefaultProject } from '@/core/ir/defaults';
import { generateId } from '@/core/ir/id-generator';
import { uniqueEntityName } from '@/core/ir/names';
import type { NativeShapeParams } from '@/core/ir/schema/shapes';
import type { NamedSelection, ProjectIR } from '@/core/ir/types';
import { generateShape } from '@/geometry/primitives/generators';

export const MODELING_PANELS = ['geometry', 'selections', 'materials', 'sections', 'export', 'validation'] as const;
export type ModelingPanel = typeof MODELING_PANELS[number];

export const MODEL_TEMPLATES = ['empty', 'frame', 'truss', 'plate', 'pipe', 'lBracket'] as const;
export type ModelTemplate = typeof MODEL_TEMPLATES[number];

export function normalizeModelingPanel(panel: string | null | undefined): ModelingPanel {
  return MODELING_PANELS.find((candidate) => candidate === panel) ?? 'geometry';
}

const templateShapes: Record<Exclude<ModelTemplate, 'empty'>, NativeShapeParams> = {
  frame: { shapeType: 'frame2d', spanX: 6, spanY: 9, columns: 3, floors: 3 },
  truss: { shapeType: 'truss2d', span: 10, height: 2, divisions: 6 },
  plate: { shapeType: 'plate', width: 4, depth: 3, thickness: 0.2 },
  pipe: { shapeType: 'pipe', outerRadius: 1, innerRadius: 0.8, length: 3, segments: 32 },
  lBracket: { shapeType: 'lBracket', width: 2, height: 3, thickness: 0.3, depth: 1 },
};

const templateNames = {
  ja: { frame: 'フレーム', truss: 'トラス', plate: '板', pipe: 'パイプ', lBracket: 'L形ブラケット' },
  en: { frame: 'Frame', truss: 'Truss', plate: 'Plate', pipe: 'Pipe', lBracket: 'L bracket' },
};

/** New modeling projects contain no solver configuration or analysis inputs. */
export function createModelProject(name?: string, template: ModelTemplate = 'empty', lang = 'ja'): ProjectIR {
  const ir = createDefaultProject();
  ir.meta.project_name = name?.trim() || (lang.startsWith('ja') ? '名称未設定のモデル' : 'Untitled model');
  // Retain the shared file schema for round-trip compatibility with older projects.
  ir.meta.default_solver_target = '';
  ir.meta.domain_type = template === 'frame' || template === 'truss' ? template : 'solid';
  ir.geometry.model_type = 'cad_brep';
  ir.solver_targets.forEach((target) => { target.enabled = false; });
  return applyModelTemplate(ir, template, lang);
}

/** Append editable geometry and composition groups without changing existing data. */
export function applyModelTemplate(ir: ProjectIR, template: ModelTemplate, lang = 'ja'): ProjectIR {
  if (template === 'empty') return ir;
  const language = lang.startsWith('ja') ? 'ja' : 'en';
  const shape = generateShape(templateShapes[template], uniqueEntityName(templateNames[language][template], ir.geometry.bodies));
  const graph = template === 'frame' || template === 'truss';
  try {
    return produce(ir, (draft) => {
      const modelType = graph ? 'frame_graph' : 'cad_brep';
      draft.geometry.model_type = draft.geometry.bodies.length === 0 || draft.geometry.model_type === modelType ? modelType : 'hybrid';
      draft.geometry.bodies.push(shape.body);
      draft.geometry.faces.push(...shape.faces);
      draft.geometry.edges.push(...shape.edges);
      draft.geometry.vertices.push(...shape.vertices);

      const addGroup = (name: string, displayName: string, entityType: 'body' | 'edge', memberRefs: string[]) => {
        if (!memberRefs.length) return;
        const selection: NamedSelection = {
          id: generateId('named_selection'),
          name: uniqueEntityName(name, draft.named_selections),
          display_name: uniqueEntityName(displayName, draft.named_selections.map((item) => ({ name: item.display_name ?? item.name }))),
          target_dimension: entityType === 'edge' ? 1 : 3,
          entity_type: entityType,
          member_refs: memberRefs,
          color: shape.body.color,
          description: '',
          created_by: 'user',
          status: 'active',
          usages: entityType === 'edge' ? ['material_assignment', 'section_assignment', 'export_tag'] : ['material_assignment', 'export_tag'],
        };
        draft.named_selections.push(selection);
      };
      addGroup(`${template}_body`, shape.body.name, 'body', [shape.body.id]);
      if (template === 'frame') {
        addGroup('columns', language === 'ja' ? '柱' : 'Columns', 'edge', shape.edges.filter((edge) => edge.name.startsWith('column_')).map((edge) => edge.id));
        addGroup('beams', language === 'ja' ? '梁' : 'Beams', 'edge', shape.edges.filter((edge) => edge.name.startsWith('beam_')).map((edge) => edge.id));
      } else if (template === 'truss') {
        addGroup('top_chords', language === 'ja' ? '上弦材' : 'Top chords', 'edge', shape.edges.filter((edge) => edge.name.startsWith('top_chord_')).map((edge) => edge.id));
        addGroup('bottom_chords', language === 'ja' ? '下弦材' : 'Bottom chords', 'edge', shape.edges.filter((edge) => edge.name.startsWith('bottom_chord_')).map((edge) => edge.id));
        addGroup('web_members', language === 'ja' ? '腹材' : 'Web members', 'edge', shape.edges.filter((edge) => edge.name.startsWith('web_') || edge.name.startsWith('diagonal_')).map((edge) => edge.id));
      }
    });
  } finally {
    // Templates persist the parametric IR; the viewer constructs its own buffers.
    shape.threeGeometry.dispose();
  }
}
