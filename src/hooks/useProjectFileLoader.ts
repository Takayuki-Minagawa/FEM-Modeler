import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { MAX_PROJECT_FILE_BYTES, readFileAsText, parseProjectFile } from '@/export/project/load';
import { useAppActionsContext } from '@/hooks/useAppActionsContext';

export interface ProjectFileLoadResult {
  success: boolean;
  projectName?: string;
  error?: string;
  warning?: string;
}

export function useProjectFileLoader() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const { addActivity, transitionProject } = useAppActionsContext();
  const loadProject = useAppStore((s) => s.loadProject);

  const loadFromFile = useCallback(
    async (file: File): Promise<ProjectFileLoadResult> => {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        const error = 'Project file exceeds the 100 MB safety limit.';
        addActivity('error', error);
        return { success: false, error };
      }
      const result = file.name.toLowerCase().endsWith('.fem.zip')
        ? await (await import('@/export/project/bundle')).parseProjectBundle(await file.arrayBuffer())
        : parseProjectFile(await readFileAsText(file));

      if (!result.success || !result.data) {
        const error = result.error ?? 'Failed to load project';
        addActivity('error', error);
        return { success: false, error };
      }

      const data = result.data;
      const transition = await transitionProject(() => loadProject(data));
      if (!transition.success) return transition;
      addActivity(
        'success',
        isJa
          ? `プロジェクト "${result.data.meta.project_name}" を読み込みました。`
          : `Loaded project "${result.data.meta.project_name}".`,
      );
      if (result.warning) {
        addActivity('warning', result.warning);
      }

      return {
        success: true,
        projectName: result.data.meta.project_name,
        warning: result.warning,
      };
    },
    [addActivity, isJa, loadProject, transitionProject],
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
          (result) => onResult?.(result),
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

  return { loadFromFile, openFilePicker };
}
