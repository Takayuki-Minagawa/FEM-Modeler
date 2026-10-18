import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { useAppActionsContext } from '@/hooks/useAppActionsContext';
import type { DownloadedArtifact } from '@/export/shared/packaging';
import type { ExportHistoryContext } from '@/contexts/app-context-value';
import { useAsyncOperation } from '@/hooks/useAsyncOperation';
import { AsyncOperationStatus } from './common/AsyncOperationStatus';
import { modelExportCopy } from '@/i18n/locales/model-export';

type ModelExportTarget = 'STEP' | 'IGES' | 'JSON' | 'Bundle';
const targets: ModelExportTarget[] = ['STEP', 'IGES', 'JSON', 'Bundle'];

export function ExportForm() {
  const { i18n } = useTranslation();
  const copy = modelExportCopy(i18n.language);
  const { addActivity, saveProjectFile, recordExportResult } = useAppActionsContext();

  const [exporting, setExporting] = useState<ModelExportTarget | null>(null);
  const [lastResult, setLastResult] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const { operation, begin, setPhase, finish, cancel, reset } = useAsyncOperation();
  const activeCADExport = useRef<AbortController | null>(null);
  const activeExport = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (next.projectSession !== previous.projectSession) {
        activeCADExport.current?.abort();
        activeExport.current = null;
        setExporting(null);
        if (next.ir.meta.project_id !== previous.ir.meta.project_id) { setLastResult(null); reset(); }
        else cancel();
      }
    });
    return () => {
      mounted.current = false;
      activeExport.current = null;
      unsubscribe();
      activeCADExport.current?.abort();
      activeCADExport.current = null;
    };
  }, [cancel, reset]);
  const handleExport = async (target: ModelExportTarget) => {
    const cadFormat = target === 'STEP' ? 'step' : target === 'IGES' ? 'iges' : undefined;
    // Preserve the full editing model, including data from older project files.
    // CAD output does not depend on material assignments or analysis settings.
    const snapshot = useAppStore.getState().ir;
    const token = begin(target, 'preparing');
    const id = token.id;
    activeExport.current = id;
    const historyContext: ExportHistoryContext = {
      projectId: snapshot.meta.project_id, projectName: snapshot.meta.project_name,
      revision: snapshot.validation.model_revision, operationId: id,
    };

    const controller = cadFormat ? token.controller : undefined;
    const session = useAppStore.getState().projectSession;
    const current = () => mounted.current && activeExport.current === id
      && useAppStore.getState().projectSession === session
      && (!controller || (activeCADExport.current === controller && !controller.signal.aborted));
    if (controller) {
      activeCADExport.current?.abort();
      activeCADExport.current = controller;
      controller.signal.addEventListener('abort', () => {
        if (mounted.current && activeCADExport.current === controller) {
          setExporting(null);
          setLastResult(null);
        }
      }, { once: true });
    }
    setExporting(target);
    setLastResult(null);
    setPhase(token, target === 'Bundle' ? 'packaging' : 'generating');
    try {
      let result: { errors: string[]; warnings: string[]; artifact?: DownloadedArtifact };
      switch (target) {
        case 'STEP':
        case 'IGES': {
          const { downloadCAD } = await import('@/export/cad/exporter');
          if (!current()) return;
          result = await downloadCAD(snapshot, cadFormat!, controller!.signal);
          break;
        }
        case 'JSON':
          saveProjectFile(id);
          result = { errors: [], warnings: [] };
          break;
        case 'Bundle':
          result = { errors: [], warnings: [], artifact: await (await import('@/export/project/bundle')).downloadProjectBundle(snapshot) };
          break;
      }
      // A completed download belongs to its captured project even after navigation.
      // Cancelled CAD work must never record a successful artifact.
      if (controller && !current()) return;
      if (target !== 'JSON') {
        recordExportResult(target, result.errors, result.warnings, { ...historyContext, ...(result.errors.length ? {} : result.artifact) });
      }
      if (!current()) return;
      if (target !== 'JSON') {
        addActivity(
          result.errors.length > 0 ? 'error' : result.warnings.length > 0 ? 'warning' : 'success',
          copy.activity(target, result.errors.length > 0 ? 'failed' : result.warnings.length > 0 ? 'warning' : 'completed'),
        );
      }
      setLastResult(result);
      finish(token, result.errors.length ? 'failed' : 'completed');
    } catch (e) {
      const errors = [String(e)];
      if (controller && !current()) return;
      recordExportResult(target, errors, [], historyContext);
      if (!current()) return;
      addActivity('error', copy.activity(target, 'failed'));
      setLastResult({ errors, warnings: [] });
      finish(token, 'failed');
    } finally {
      if (activeExport.current === id) {
        activeExport.current = null;
        if (controller) activeCADExport.current = null;
        if (mounted.current) setExporting(null);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        <p>{copy.handoff}</p>
        <p>{copy.projectData}</p>
        <p>{copy.cadLimits}</p>
      </div>
      <div className="space-y-2">
        {targets.map((target) => (
          <button
            type="button"
            key={target}
            onClick={() => handleExport(target)}
            disabled={exporting !== null}
            className="w-full p-3 rounded text-left transition-colors cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {target === 'JSON' ? copy.save : target}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{copy.targets[target]}</div>
              </div>
              {exporting === target && <span className="text-xs" style={{ color: 'var(--color-accent)' }}>{copy.running}</span>}
            </div>
          </button>
        ))}
      </div>
      <AsyncOperationStatus operation={operation} onCancel={exporting === 'STEP' || exporting === 'IGES' ? () => cancel() : undefined} cancelLabel={copy.cancelCAD}>
        {lastResult && <>
          {lastResult.errors.map((error, index) => <div key={index} className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</div>)}
          {lastResult.warnings.map((warning, index) => <div key={index} className="text-xs" style={{ color: 'var(--color-warning)' }}>{warning}</div>)}
        </>}
      </AsyncOperationStatus>
    </div>
  );
}
