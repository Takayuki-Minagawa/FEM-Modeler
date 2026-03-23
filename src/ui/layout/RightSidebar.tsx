import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { GeometryForm } from '@/ui/forms/GeometryForm';
import { NamedSelectionsForm } from '@/ui/forms/NamedSelectionsForm';
import { MaterialForm } from '@/ui/forms/MaterialForm';
import { SectionForm } from '@/ui/forms/SectionForm';
import { MeshControlForm } from '@/ui/forms/MeshControlForm';
import { BoundaryConditionForm } from '@/ui/forms/BoundaryConditionForm';
import { LoadForm } from '@/ui/forms/LoadForm';
import { AnalysisCaseForm } from '@/ui/forms/AnalysisCaseForm';
import { ExportForm } from '@/ui/forms/ExportForm';

const PANELS_WITH_FORMS = [
  'geometry', 'selections', 'materials', 'sections', 'mesh',
  'bc', 'loads', 'analysis', 'export',
] as const;

const PANEL_I18N_KEYS = [
  'geometry', 'selections', 'materials', 'sections', 'mesh',
  'bc', 'loads', 'ic', 'analysis', 'export', 'validation',
] as const;

const FORM_TITLES: Record<string, string> = {
  geometry: 'properties.title',
  selections: 'properties.title',
  materials: 'materials.formTitle',
  sections: 'sections.formTitle',
  mesh: 'properties.title',
  bc: 'bc.formTitle',
  loads: 'loads.formTitle',
  analysis: 'properties.title',
  export: 'properties.title',
};

export function RightSidebar() {
  const { t } = useTranslation();
  const activePanel = useAppStore((s) => s.activePanel);

  const hasForm = (PANELS_WITH_FORMS as readonly string[]).includes(activePanel);
  const titleKey = FORM_TITLES[activePanel] ?? 'properties.title';

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ backgroundColor: 'var(--color-bg-secondary)' }}
    >
      <div className="p-4">
        <div
          className="text-sm font-bold uppercase tracking-wider mb-4"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t(titleKey)}
        </div>

        {activePanel === 'geometry' && <GeometryForm />}
        {activePanel === 'selections' && <NamedSelectionsForm />}
        {activePanel === 'materials' && <MaterialForm />}
        {activePanel === 'sections' && <SectionForm />}
        {activePanel === 'mesh' && <MeshControlForm />}
        {activePanel === 'bc' && <BoundaryConditionForm />}
        {activePanel === 'loads' && <LoadForm />}
        {activePanel === 'analysis' && <AnalysisCaseForm />}
        {activePanel === 'export' && <ExportForm />}

        {!hasForm && (PANEL_I18N_KEYS as readonly string[]).includes(activePanel) && (
          <div
            className="text-base p-5 rounded text-center leading-relaxed"
            style={{
              backgroundColor: 'var(--color-bg-input)',
              color: 'var(--color-text-muted)',
            }}
          >
            {t(`properties.${activePanel}`)}
          </div>
        )}
      </div>
    </div>
  );
}
