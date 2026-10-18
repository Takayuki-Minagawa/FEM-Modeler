import { useAppStore } from '@/state/store';
import type { DiagnosticTarget } from '@/validation/navigation';

export function openDiagnosticTarget(target: DiagnosticTarget): void {
  const store = useAppStore.getState();
  store.setActivePanel(target.panel);
  if (target.panel === 'geometry' && target.id) store.setSelectedEntities([target.id]);
  window.dispatchEvent(new Event('fem-open-properties'));
  requestAnimationFrame(() => {
    const row = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-entity-id]'))
      .find(element => element.dataset.entityId === target.id);
    if (row) {
      if (row.getAttribute('aria-pressed') !== 'true' && row.getAttribute('aria-expanded') !== 'true') row.click();
      row.focus();
    }
  });
}
