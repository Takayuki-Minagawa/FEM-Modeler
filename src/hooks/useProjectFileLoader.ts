import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { MAX_PROJECT_FILE_BYTES, readFileAsText, parseProjectFile } from '@/export/project/load';
import { useAppActionsContext } from '@/hooks/useAppActionsContext';
import { useAsyncOperation, type AsyncPhase } from './useAsyncOperation';

export interface ProjectFileLoadResult {
  success: boolean;
  projectName?: string;
  error?: string;
  warning?: string;
  cancelled?: boolean;
}

interface LoadOptions { signal?: AbortSignal; onPhase?: (phase: AsyncPhase) => void; onCancelled?: () => void }

export function useProjectFileLoader() {
  const { t, i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const { addActivity, transitionProject } = useAppActionsContext();
  const loadProject = useAppStore((s) => s.loadProject);
  const { operation, begin, isCurrent, setPhase, finish, cancel, reset } = useAsyncOperation();
  const applying = useRef(false);
  useEffect(() => useAppStore.subscribe((next, previous) => {
    if (next.projectSession !== previous.projectSession && !applying.current) cancel();
  }), [cancel]);

  const loadFromFile = useCallback(
    async (file: File, options: LoadOptions = {}): Promise<ProjectFileLoadResult> => {
      const token = begin(file.name);
      const session = useAppStore.getState().projectSession;
      const abort = () => token.controller.abort();
      const cancelledByLoader = () => options.onCancelled?.();
      token.signal.addEventListener('abort', cancelledByLoader, { once: true });
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      const current = () => isCurrent(token) && useAppStore.getState().projectSession === session;
      const cancelled = (): ProjectFileLoadResult => ({ success: false, cancelled: true, error: t('asyncOperation.importCancelled') });
      const phase = (value: AsyncPhase) => { setPhase(token, value); options.onPhase?.(value); };
      try {
        if (!current()) return cancelled();
        if (file.size > MAX_PROJECT_FILE_BYTES) throw new Error('Project file exceeds the 100 MB safety limit.');
        const bundle = file.name.toLowerCase().endsWith('.fem.zip');
        const contents = bundle ? await file.arrayBuffer() : await readFileAsText(file);
        if (!current()) return cancelled();
        phase('processing');
        const result = bundle
          ? await (await import('@/export/project/bundle')).parseProjectBundle(contents as ArrayBuffer)
          : parseProjectFile(contents as string);
        if (!current()) return cancelled();
        if (!result.success || !result.data) throw new Error(result.error ?? 'Failed to load project');
        const data = result.data;
        phase('applying');
        let applied = false;
        const transition = await transitionProject(() => {
          // A draft save can await storage: verify the original operation again at replacement.
          if (!current()) return;
          applying.current = true;
          try { loadProject(data); applied = true; } finally { applying.current = false; }
        });
        if (!applied) {
          if (!current()) return cancelled();
          if (!transition.success) throw new Error(transition.error ?? 'Failed to load project');
          return cancelled();
        }
        if (!isCurrent(token)) return cancelled();
        const message = isJa ? `プロジェクト "${data.meta.project_name}" を読み込みました。` : `Loaded project "${data.meta.project_name}".`;
        addActivity('success', message);
        if (result.warning) addActivity('warning', result.warning);
        finish(token, 'completed', message);
        return { success: true, projectName: data.meta.project_name, warning: result.warning };
      } catch (cause) {
        if (!current()) return cancelled();
        const error = cause instanceof Error ? cause.message : String(cause);
        addActivity('error', error); finish(token, 'failed', error);
        return { success: false, error };
      } finally {
        options.signal?.removeEventListener('abort', abort);
        token.signal.removeEventListener('abort', cancelledByLoader);
      }
    },
    [addActivity, begin, finish, isCurrent, isJa, loadProject, setPhase, t, transitionProject],
  );

  const openFilePicker = useCallback(
    (accept: string, onResult?: (result: ProjectFileLoadResult) => void) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        loadFromFile(file).then(
          (result) => { if (!result.cancelled) onResult?.(result); },
          (err) => {
            const error = err instanceof Error ? err.message : String(err);
            addActivity('error', error);
            onResult?.({ success: false, error });
          },
        );
      };
      input.click();
    },
    [addActivity, loadFromFile],
  );

  return { loadFromFile, openFilePicker, operation, cancel, reset };
}
