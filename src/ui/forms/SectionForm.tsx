import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { UnitInput } from './common/UnitInput';
import { SelectInput } from './common/SelectInput';
import { EntityRow } from './common/EntityRow';
import { FormField } from './common/FormField';
import { AssignmentPicker } from './common/AssignmentPicker';
import { DuplicateAction } from './common/BulkActions';
import { uniqueEntityName } from '@/core/ir/names';
import type { Section, SectionType } from '@/core/ir/types';
import { fromSINullable, quantityUnitLabel, toSINullable } from '@/core/units';
import { calculateSectionProperties, defaultSectionDimensions } from '@/core/sections/properties';
import { modelFormsEn, modelFormsJa } from '@/i18n/locales/model-forms';

const SECTION_TYPES = ['beam_rect', 'beam_circle', 'beam_h', 'shell_thickness'] as const;
const supportsCalculation = (section: Section) => ['beam_rect', 'beam_circle', 'beam_h'].includes(section.section_type);
const isAutomatic = (section: Section) => supportsCalculation(section) && (section.metadata.property_mode === 'automatic'
  || (section.metadata.property_mode === undefined && ['dimensions', 'needs_review'].includes(String(section.metadata.property_source))));

export function SectionForm() {
  const { t, i18n } = useTranslation();
  const sections = useAppStore((s) => s.ir.sections);
  const materials = useAppStore((s) => s.ir.materials);
  const sectionAssignments = useAppStore((s) => s.ir.section_assignments);
  const namedSelections = useAppStore((s) => s.ir.named_selections);
  const addSection = useAppStore((s) => s.addSection);
  const updateSection = useAppStore((s) => s.updateSection);
  const removeSection = useAppStore((s) => s.removeSection);
  const removeSectionAssignment = useAppStore((s) => s.removeSectionAssignment);
  const units = useAppStore((s) => s.ir.units);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignSecId, setAssignSecId] = useState<string | null>(null);

  const unitSystem = units.system_name;
  const copy = i18n.language === 'ja' ? modelFormsJa : modelFormsEn;
  const lengthUnit = quantityUnitLabel('length', unitSystem);
  const areaUnit = quantityUnitLabel('area', unitSystem);
  const inertiaUnit = quantityUnitLabel('fourth_moment', unitSystem);

  const handleAdd = () => {
    const dimensions = defaultSectionDimensions('beam_rect');
    const calculated = calculateSectionProperties({ section_type: 'beam_rect', dimensions });
    const sec: Section = {
      id: generateId('section'),
      name: uniqueEntityName(i18n.language === 'ja' ? '新規断面' : 'New Section', sections),
      section_type: 'beam_rect',
      dimensions,
      material_id: materials[0]?.id ?? '',
      area: calculated?.area ?? null,
      inertia_y: calculated?.inertiaY ?? null,
      inertia_z: calculated?.inertiaZ ?? null,
      torsion_constant: calculated?.torsionConstant ?? null,
      thickness: null,
      metadata: { property_source: 'dimensions', property_mode: 'automatic' },
    };
    addSection(sec);
    setEditingId(sec.id);
  };

  const editingSec = editingId ? sections.find((s) => s.id === editingId) : null;
  const geometricProperties = editingSec ? calculateSectionProperties(editingSec) : null;

  const updateDimension = (section: Section, key: string, displayedValue: number | null) => {
    const value = toSINullable(displayedValue, 'length', unitSystem);
    const dimensions = { ...section.dimensions };
    if (value === null) delete dimensions[key];
    else dimensions[key] = value;
    const calculated = calculateSectionProperties({ section_type: section.section_type, dimensions });
    updateSection(section.id, {
      dimensions,
      ...(isAutomatic(section) ? calculated ? {
        area: calculated.area,
        inertia_y: calculated.inertiaY,
        inertia_z: calculated.inertiaZ,
        torsion_constant: calculated.torsionConstant,
        metadata: { ...section.metadata, property_source: calculated.source },
      } : {
        area: null,
        inertia_y: null,
        inertia_z: null,
        torsion_constant: null,
        metadata: { ...section.metadata, property_source: 'needs_review' },
      } : {}),
    });
  };

  const changeSectionType = (section: Section, sectionType: SectionType) => {
    const dimensions = defaultSectionDimensions(sectionType);
    const calculated = calculateSectionProperties({ section_type: sectionType, dimensions });
    updateSection(section.id, {
      section_type: sectionType,
      dimensions,
      area: calculated?.area ?? null,
      inertia_y: calculated?.inertiaY ?? null,
      inertia_z: calculated?.inertiaZ ?? null,
      torsion_constant: calculated?.torsionConstant ?? null,
      thickness: null,
      metadata: { ...section.metadata, property_source: calculated?.source ?? 'manual', property_mode: calculated ? 'automatic' : 'manual' },
    });
  };

  return (
    <div className="space-y-4">
      <button
        onClick={handleAdd}
        className="w-full py-2 rounded text-sm cursor-pointer"
        style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
      >
        {t('sections.addSection')}
      </button>

      {/* Editing */}
      {editingSec && (
        <div className="p-3 rounded space-y-2" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-accent)' }}>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('workflow.immediate')}</p>
          <DuplicateAction kind="section" itemId={editingSec.id} onDuplicated={setEditingId} />
          <FormField label={t('sections.name')}>{(attributes) => (
            <input
              {...attributes}
              type="text"
              value={editingSec.name}
              onChange={(e) => updateSection(editingSec.id, { name: e.target.value })}
              className="w-full min-w-0 px-2 py-1.5 rounded text-sm outline-none"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            />
          )}</FormField>

          <SelectInput
            label={t('sections.type')}
            value={editingSec.section_type}
            options={[
              ...SECTION_TYPES.map((st) => ({ value: st, label: copy.sectionTypes[st] })),
              ...(editingSec.section_type === 'generic_frame_section' ? [{ value: 'generic_frame_section', label: copy.legacySection }] : []),
            ]}
            onChange={(v) => changeSectionType(editingSec, v as SectionType)}
          />
          {editingSec.section_type === 'generic_frame_section' && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{copy.legacySectionHint}</p>}

          {(['beam_rect', 'beam_h'].includes(editingSec.section_type)) && (
            <>
              <UnitInput label={t('sections.width')} value={fromSINullable(editingSec.dimensions.width ?? null, 'length', unitSystem)} unit={lengthUnit} onChange={(v) => updateDimension(editingSec, 'width', v)} />
              <UnitInput label={t('sections.height')} value={fromSINullable(editingSec.dimensions.height ?? null, 'length', unitSystem)} unit={lengthUnit} onChange={(v) => updateDimension(editingSec, 'height', v)} />
            </>
          )}
          {editingSec.section_type === 'beam_circle' && (
            <UnitInput label={t('sections.diameter')} value={fromSINullable(editingSec.dimensions.diameter ?? null, 'length', unitSystem)} unit={lengthUnit} onChange={(v) => updateDimension(editingSec, 'diameter', v)} />
          )}
          {editingSec.section_type === 'beam_h' && (
            <>
              <UnitInput label={t('sections.flangeThickness')} value={fromSINullable(editingSec.dimensions.flange_thickness ?? null, 'length', unitSystem)} unit={lengthUnit} onChange={(v) => updateDimension(editingSec, 'flange_thickness', v)} />
              <UnitInput label={t('sections.webThickness')} value={fromSINullable(editingSec.dimensions.web_thickness ?? null, 'length', unitSystem)} unit={lengthUnit} onChange={(v) => updateDimension(editingSec, 'web_thickness', v)} />
            </>
          )}

          <SelectInput
            label={t('sections.material')}
            value={editingSec.material_id}
            options={[
              { value: '', label: '—' },
              ...materials.map((m) => ({ value: m.id, label: m.name })),
            ]}
            onChange={(v) => updateSection(editingSec.id, { material_id: v })}
          />

          {supportsCalculation(editingSec) && <section aria-label={copy.geometryProperties} className="space-y-1 text-xs">
            <h4 className="font-bold">{copy.geometryProperties}</h4>
            {geometricProperties ? <dl>
              {([
                ['sections.area', fromSINullable(geometricProperties.area, 'area', unitSystem), areaUnit],
                ['sections.inertiaY', fromSINullable(geometricProperties.inertiaY, 'fourth_moment', unitSystem), inertiaUnit],
                ['sections.inertiaZ', fromSINullable(geometricProperties.inertiaZ, 'fourth_moment', unitSystem), inertiaUnit],
              ] as const).map(([label, value, unit]) => <div key={label} className="flex justify-between gap-2"><dt>{t(label)}</dt><dd>{value} {unit}</dd></div>)}
            </dl> : <p>{copy.invalidSectionDimensions}</p>}
          </section>}
          {editingSec.section_type === 'shell_thickness' && (
            <UnitInput label={t('sections.thickness')} value={fromSINullable(editingSec.thickness, 'length', unitSystem)} unit={lengthUnit} onChange={(v) => updateSection(editingSec.id, { thickness: toSINullable(v, 'length', unitSystem) })} />
          )}

          <button
            onClick={() => setEditingId(null)}
            className="w-full py-1.5 rounded text-sm cursor-pointer"
            style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text-secondary)' }}
          >
            {t('workflow.close')}
          </button>
        </div>
      )}

      {/* List */}
      {sections.length === 0 ? (
        <div className="text-sm text-center p-4" style={{ color: 'var(--color-text-muted)' }}>{t('sections.noSections')}</div>
      ) : (
        <div className="space-y-1">
          {sections.map((sec) => {
            const assignments = sectionAssignments.filter((a) => a.section_id === sec.id);
            return (
              <div key={sec.id} className="px-3 py-2 rounded text-sm" style={{ backgroundColor: 'var(--color-bg-input)' }}>
                <EntityRow name={sec.name} entityId={sec.id} selected={editingId === sec.id}
                  onSelect={() => setEditingId(editingId === sec.id ? null : sec.id)}
                  onDelete={() => { removeSection(sec.id); if (editingId === sec.id) setEditingId(null); }}>{sec.section_type === 'generic_frame_section' ? copy.legacySection : copy.sectionTypes[sec.section_type]}</EntityRow>
                    <button type="button" aria-label={`${t('sections.assignTo')}: ${sec.name} (${sec.id})`} aria-expanded={assignSecId === sec.id} onClick={() => setAssignSecId(assignSecId === sec.id ? null : sec.id)} className="text-xs px-1.5 py-0.5 rounded cursor-pointer" style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-accent)' }}>
                      {t('sections.assignTo')}
                    </button>
                {assignments.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {assignments.map((assignment) => {
                      const ns = namedSelections.find((item) => item.id === assignment.target_named_selection_id);
                      return (
                        <button
                          key={assignment.id}
                          type="button"
                          onClick={() => removeSectionAssignment(assignment.id)}
                          className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
                          style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-secondary)' }}
                          title={t('common.remove', { defaultValue: 'Remove assignment' })}
                          aria-label={t('assignments.remove', { item: sec.name, target: `${ns?.display_name ?? ns?.name ?? '?'} (${ns?.id ?? assignment.target_named_selection_id})` })}
                        >
                          → {ns?.display_name ?? ns?.name ?? '?'} ×
                        </button>
                      );
                    })}
                  </div>
                )}
                {assignSecId === sec.id && (
                  <AssignmentPicker kind="section" itemId={sec.id} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
