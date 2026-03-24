import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadProjectFile } from '@/export/project/save';
import { useAppStore } from '@/state/store';
import {
  clearProjectDraft,
  getProjectDraftSummary,
  loadProjectDraft,
  saveProjectDraft,
  type DraftSummary,
} from '@/lib/project-draft-storage';
import { generateId } from '@/core/ir/id-generator';
import type {
  ActivityLogEntry,
  ActivityLogLevel,
  DraftPersistenceState,
} from '@/contexts/app-context-value';

const AUTOSAVE_DELAY_MIN_MS = 1200;
const AUTOSAVE_DELAY_MAX_MS = 5000;
const AUTOSAVE_SIZE_THRESHOLD = 200_000; // bytes — above this, scale delay toward max
const MAX_ACTIVITY_LOG = 60;

function computeAutosaveDelay(ir: unknown): number {
  // Estimate serialized size without allocating a full string for small models.
  // JSON.stringify is the most reliable size proxy we have.
  let size: number;
  try {
    size = JSON.stringify(ir).length;
  } catch {
    return AUTOSAVE_DELAY_MAX_MS;
  }
  if (size <= AUTOSAVE_SIZE_THRESHOLD) return AUTOSAVE_DELAY_MIN_MS;
  const ratio = Math.min((size - AUTOSAVE_SIZE_THRESHOLD) / AUTOSAVE_SIZE_THRESHOLD, 1);
  return Math.round(AUTOSAVE_DELAY_MIN_MS + ratio * (AUTOSAVE_DELAY_MAX_MS - AUTOSAVE_DELAY_MIN_MS));
}

function createActivityEntry(level: ActivityLogLevel, message: string): ActivityLogEntry {
  return {
    id: generateId('log'),
    level,
    message,
    timestamp: new Date().toISOString(),
  };
}

export function useProjectDraftPersistence() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const ir = useAppStore((s) => s.ir);
  const loadProject = useAppStore((s) => s.loadProject);
  const setStartScreenOpen = useAppStore((s) => s.setStartScreenOpen);

  const [draftSummary, setDraftSummary] = useState<DraftSummary | null>(null);
  const [autosaveState, setAutosaveState] = useState<DraftPersistenceState>({
    status: 'idle',
    lastSavedAt: null,
    errorMessage: null,
  });
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);

  const skipInitialAutosaveRef = useRef(true);

  const addActivity = useCallback((level: ActivityLogLevel, message: string) => {
    setActivityLog((current) => [
      createActivityEntry(level, message),
      ...current,
    ].slice(0, MAX_ACTIVITY_LOG));
  }, []);

  const clearActivityLog = useCallback(() => {
    setActivityLog([]);
  }, []);

  const refreshDraftSummary = useCallback(async () => {
    const summary = await getProjectDraftSummary();
    setDraftSummary(summary);
    return summary;
  }, []);

  useEffect(() => {
    let ignore = false;

    void getProjectDraftSummary()
      .then((summary) => {
        if (ignore) return;
        setDraftSummary(summary);
        if (summary) {
          setAutosaveState({
            status: 'saved',
            lastSavedAt: summary.savedAt,
            errorMessage: null,
          });
        }
      })
      .catch((error) => {
        if (ignore) return;
        const message = error instanceof Error ? error.message : String(error);
        setAutosaveState({
          status: 'error',
          lastSavedAt: null,
          errorMessage: message,
        });
        addActivity(
          'warning',
          isJa
            ? `自動保存領域を初期化できませんでした: ${message}`
            : `Failed to initialize draft storage: ${message}`,
        );
      });

    return () => {
      ignore = true;
    };
  }, [addActivity, isJa]);

  useEffect(() => {
    if (skipInitialAutosaveRef.current) {
      skipInitialAutosaveRef.current = false;
      return;
    }

    let cancelled = false;
    const delay = computeAutosaveDelay(ir);
    const timer = window.setTimeout(() => {
      setAutosaveState((current) => ({
        ...current,
        status: 'saving',
        errorMessage: null,
      }));

      void saveProjectDraft(ir)
        .then((summary) => {
          if (cancelled) return;
          setDraftSummary(summary);
          setAutosaveState({
            status: 'saved',
            lastSavedAt: summary.savedAt,
            errorMessage: null,
          });
        })
        .catch((error) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          setAutosaveState((current) => ({
            status: 'error',
            lastSavedAt: current.lastSavedAt,
            errorMessage: message,
          }));
          addActivity(
            'error',
            isJa
              ? `草稿の自動保存に失敗しました: ${message}`
              : `Failed to auto-save project draft: ${message}`,
          );
        });
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addActivity, ir, isJa]);

  const saveProjectFileWithLog = useCallback(() => {
    const currentIr = useAppStore.getState().ir;
    downloadProjectFile(currentIr);
    addActivity(
      'success',
      isJa
        ? `プロジェクト "${currentIr.meta.project_name}" を保存しました。`
        : `Saved project "${currentIr.meta.project_name}".`,
    );
  }, [addActivity, isJa]);

  const restoreDraft = useCallback(async () => {
    try {
      const draft = await loadProjectDraft();
      if (!draft) {
        addActivity(
          'warning',
          isJa ? '復元できる自動保存草稿はありません。' : 'No auto-saved draft is available.',
        );
        setDraftSummary(null);
        return false;
      }

      loadProject(draft);
      setStartScreenOpen(false);
      const summary = await refreshDraftSummary();
      setAutosaveState({
        status: 'saved',
        lastSavedAt: summary?.savedAt ?? draft.meta.updated_at,
        errorMessage: null,
      });
      addActivity(
        'success',
        isJa
          ? `自動保存された草稿 "${draft.meta.project_name}" を復元しました。`
          : `Restored auto-saved draft "${draft.meta.project_name}".`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAutosaveState((current) => ({
        status: 'error',
        lastSavedAt: current.lastSavedAt,
        errorMessage: message,
      }));
      addActivity(
        'error',
        isJa ? `草稿の復元に失敗しました: ${message}` : `Failed to restore draft: ${message}`,
      );
      return false;
    }
  }, [addActivity, isJa, loadProject, refreshDraftSummary, setStartScreenOpen]);

  const discardDraft = useCallback(async () => {
    try {
      await clearProjectDraft();
      setDraftSummary(null);
      setAutosaveState({
        status: 'idle',
        lastSavedAt: null,
        errorMessage: null,
      });
      addActivity(
        'warning',
        isJa ? '保存済みの草稿を破棄しました。' : 'Discarded the saved draft.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAutosaveState((current) => ({
        status: 'error',
        lastSavedAt: current.lastSavedAt,
        errorMessage: message,
      }));
      addActivity(
        'error',
        isJa ? `草稿の破棄に失敗しました: ${message}` : `Failed to discard draft: ${message}`,
      );
    }
  }, [addActivity, isJa]);

  return {
    draftSummary,
    autosaveState,
    activityLog,
    addActivity,
    clearActivityLog,
    saveProjectFile: saveProjectFileWithLog,
    restoreDraft,
    discardDraft,
  };
}
