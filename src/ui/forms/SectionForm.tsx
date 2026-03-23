import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { UnitInput } from './common/UnitInput';
import { SelectInput } from './common/SelectInput';
import type { Section, SectionType } from '@/core/ir/types';

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
  const units = useAppStore((s) => s.ir.units);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignSecId, setAssignSecId] = useState<string | null>(null);

  const isSI = units.system_name === 'SI';
  const lengthUnit = isSI ? 'm' : 'mm';
  const areaUnit = isSI ? 'm²' : 'mm²';
  const inertiaUnit = isSI ? 'm⁴' : 'mm⁴';

  const handleAdd = () => {
    const sec: Section = {
      id: generateId('section'),
      name: 'New Section',
      section_type: 'beam_rect',
      dimensions: { width: 0.3, height: 0.5 },
      material_id: materials[0]?.id ?? '',
      area: null,
      inertia_y: null,
      inertia_z: null,
      torsion_constant: null,
      thickness: null,
      metadata: {},
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
            onChange={(v) => updateSection(editingSec.id, { section_type: v as SectionType })}
          />

          <SelectInput
            label={t('sections.material')}
            value={editingSec.material_id}
            options={[
              { value: '', label: '—' },
              ...materials.map((m) => ({ value: m.id, label: m.name })),
            ]}
            onChange={(v) => updateSection(editingSec.id, { material_id: v })}
          />

          <UnitInput label={t('sections.area')} value={editingSec.area} unit={areaUnit} onChange={(v) => updateSection(editingSec.id, { area: v })} />
          <UnitInput label={t('sections.inertiaY')} value={editingSec.inertia_y} unit={inertiaUnit} onChange={(v) => updateSection(editingSec.id, { inertia_y: v })} />
          <UnitInput label={t('sections.inertiaZ')} value={editingSec.inertia_z} unit={inertiaUnit} onChange={(v) => updateSection(editingSec.id, { inertia_z: v })} />
          <UnitInput label={t('sections.torsion')} value={editingSec.torsion_constant} unit={inertiaUnit} onChange={(v) => updateSection(editingSec.id, { torsion_constant: v })} />
          {editingSec.section_type === 'shell_thickness' && (
            <UnitInput label={t('sections.thickness')} value={editingSec.thickness} unit={lengthUnit} onChange={(v) => updateSection(editingSec.id, { thickness: v })} />
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
            const nsNames = assignments.map((a) => namedSelections.find((n) => n.id === a.target_named_selection_id)?.name ?? '?');
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
                {nsNames.length > 0 && <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>→ {nsNames.join(', ')}</div>}
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
