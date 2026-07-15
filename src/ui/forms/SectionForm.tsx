import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { UnitInput } from './common/UnitInput';
import { SelectInput } from './common/SelectInput';
import type { Section, SectionType } from '@/core/ir/types';
import { fromSINullable, quantityUnitLabel, toSINullable } from '@/core/units';
import { calculateSectionProperties, defaultSectionDimensions } from '@/core/sections/properties';

const SECTION_TYPES: SectionType[] = ['beam_rect', 'beam_circle', 'beam_h', 'shell_thickness', 'generic_frame_section'];

export function SectionForm() {
  const { t } = useTranslation();
  const sections = useAppStore((s) => s.ir.sections);
  const materials = useAppStore((s) => s.ir.materials);
  const sectionAssignments = useAppStore((s) => s.ir.section_assignments);
  const namedSelections = useAppStore((s) => s.ir.named_selections);
  const addSection = useAppStore((s) => s.addSection);
  const updateSection = useAppStore((s) => s.updateSection);
  const removeSection = useAppStore((s) => s.removeSection);
  const addSectionAssignment = useAppStore((s) => s.addSectionAssignment);
  const removeSectionAssignment = useAppStore((s) => s.removeSectionAssignment);
  const units = useAppStore((s) => s.ir.units);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignSecId, setAssignSecId] = useState<string | null>(null);

  const unitSystem = units.system_name;
  const lengthUnit = quantityUnitLabel('length', unitSystem);
  const areaUnit = quantityUnitLabel('area', unitSystem);
  const inertiaUnit = quantityUnitLabel('fourth_moment', unitSystem);

  const handleAdd = () => {
    const dimensions = defaultSectionDimensions('beam_rect');
    const calculated = calculateSectionProperties({ section_type: 'beam_rect', dimensions });
    const sec: Section = {
      id: generateId('section'),
      name: 'New Section',
      section_type: 'beam_rect',
      dimensions,
      material_id: materials[0]?.id ?? '',
      area: calculated?.area ?? null,
      inertia_y: calculated?.inertiaY ?? null,
      inertia_z: calculated?.inertiaZ ?? null,
      torsion_constant: calculated?.torsionConstant ?? null,
      thickness: null,
      metadata: { effective_length_factor: 1, property_source: 'dimensions' },
    };
    addSection(sec);
    setEditingId(sec.id);
  };

  const handleAssign = (secId: string, nsId: string) => {
    addSectionAssignment({
      id: generateId('section_assignment'),
      section_id: secId,
      target_named_selection_id: nsId,
    });
    setAssignSecId(null);
  };

  const editingSec = editingId ? sections.find((s) => s.id === editingId) : null;

  const updateDimension = (section: Section, key: string, displayedValue: number | null) => {
    const value = toSINullable(displayedValue, 'length', unitSystem);
    const dimensions = { ...section.dimensions };
    if (value === null) delete dimensions[key];
    else dimensions[key] = value;
    const calculated = calculateSectionProperties({ section_type: section.section_type, dimensions });
    const hasDerivedProperties = section.section_type === 'beam_rect'
      || section.section_type === 'beam_circle'
      || section.section_type === 'beam_h';
    updateSection(section.id, {
      dimensions,
      ...(calculated ? {
        area: calculated.area,
        inertia_y: calculated.inertiaY,
        inertia_z: calculated.inertiaZ,
        torsion_constant: calculated.torsionConstant,
        metadata: { ...section.metadata, property_source: calculated.source },
      } : hasDerivedProperties ? {
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
      metadata: { ...section.metadata, property_source: calculated?.source ?? 'manual' },
    });
  };

  const updateEffectiveLengthFactor = (section: Section, value: number | null) => {
    const metadata = { ...section.metadata };
    if (value === null) delete metadata.effective_length_factor;
    else metadata.effective_length_factor = value;
    updateSection(section.id, { metadata });
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
          <div className="flex items-center gap-2">
            <span className="text-sm w-28 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{t('sections.name')}</span>
            <input
              type="text"
              value={editingSec.name}
              onChange={(e) => updateSection(editingSec.id, { name: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            />
          </div>

          <SelectInput
            label={t('sections.type')}
            value={editingSec.section_type}
            options={SECTION_TYPES.map((st) => ({ value: st, label: t(`sections.types.${st}`) }))}
            onChange={(v) => changeSectionType(editingSec, v as SectionType)}
          />

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

          {editingSec.section_type !== 'shell_thickness' && (
            <UnitInput
              label={t('sections.effectiveLengthFactor')}
              value={typeof editingSec.metadata.effective_length_factor === 'number' ? editingSec.metadata.effective_length_factor : null}
              unit="—"
              min={0}
              onChange={(value) => updateEffectiveLengthFactor(editingSec, value)}
            />
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

          <UnitInput label={t('sections.area')} value={fromSINullable(editingSec.area, 'area', unitSystem)} unit={areaUnit} onChange={(v) => updateSection(editingSec.id, { area: toSINullable(v, 'area', unitSystem) })} />
          <UnitInput label={t('sections.inertiaY')} value={fromSINullable(editingSec.inertia_y, 'fourth_moment', unitSystem)} unit={inertiaUnit} onChange={(v) => updateSection(editingSec.id, { inertia_y: toSINullable(v, 'fourth_moment', unitSystem) })} />
          <UnitInput label={t('sections.inertiaZ')} value={fromSINullable(editingSec.inertia_z, 'fourth_moment', unitSystem)} unit={inertiaUnit} onChange={(v) => updateSection(editingSec.id, { inertia_z: toSINullable(v, 'fourth_moment', unitSystem) })} />
          <UnitInput label={t('sections.torsion')} value={fromSINullable(editingSec.torsion_constant, 'fourth_moment', unitSystem)} unit={inertiaUnit} onChange={(v) => updateSection(editingSec.id, { torsion_constant: toSINullable(v, 'fourth_moment', unitSystem) })} />
          {editingSec.section_type === 'shell_thickness' && (
            <UnitInput label={t('sections.thickness')} value={fromSINullable(editingSec.thickness, 'length', unitSystem)} unit={lengthUnit} onChange={(v) => updateSection(editingSec.id, { thickness: toSINullable(v, 'length', unitSystem) })} />
          )}

          <button
            onClick={() => setEditingId(null)}
            className="w-full py-1.5 rounded text-sm cursor-pointer"
            style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text-secondary)' }}
          >
            {t('common.apply')}
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
                <div className="flex items-center justify-between">
                  <span className="cursor-pointer" style={{ color: 'var(--color-text)' }} onClick={() => setEditingId(editingId === sec.id ? null : sec.id)}>
                    {sec.name} <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>({t(`sections.types.${sec.section_type}`)})</span>
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => setAssignSecId(assignSecId === sec.id ? null : sec.id)} className="text-xs px-1.5 py-0.5 rounded cursor-pointer" style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-accent)' }}>
                      {t('sections.assignTo')}
                    </button>
                    <button onClick={() => { removeSection(sec.id); if (editingId === sec.id) setEditingId(null); }} className="text-xs px-1.5 cursor-pointer" style={{ color: 'var(--color-error)' }}>&times;</button>
                  </div>
                </div>
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
                        >
                          → {ns?.display_name ?? ns?.name ?? '?'} ×
                        </button>
                      );
                    })}
                  </div>
                )}
                {assignSecId === sec.id && (
                  <div className="mt-2 p-2 rounded space-y-1" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    {namedSelections.length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('common.noSelections')}</p>
                    ) : namedSelections.map((ns) => (
                      <button key={ns.id} onClick={() => handleAssign(sec.id, ns.id)} className="w-full text-left px-2 py-1 rounded text-xs cursor-pointer flex items-center gap-2" style={{ color: 'var(--color-text-secondary)' }}>
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: ns.color }} />{ns.display_name ?? ns.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
