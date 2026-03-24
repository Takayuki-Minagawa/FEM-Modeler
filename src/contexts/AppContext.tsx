import { useCallback, useState, type ReactNode } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useProjectDraftPersistence } from '@/hooks/useProjectDraftPersistence';
import { generateId } from '@/core/ir/id-generator';
import { AppContext } from './app-context-value';
import type { ExportHistoryEntry, ExportHistoryStatus } from './app-context-value';

const MAX_EXPORT_HISTORY = 30;

export function AppContextProvider({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportHistory, setExportHistory] = useState<ExportHistoryEntry[]>([]);
  const draftPersistence = useProjectDraftPersistence();

  const recordExportResult = useCallback((target: string, errors: string[], warnings: string[]) => {
    const status: ExportHistoryStatus = errors.length > 0
      ? 'error'
      : warnings.length > 0
        ? 'warning'
        : 'success';

    const entry: ExportHistoryEntry = {
      id: generateId('log'),
      target,
      timestamp: new Date().toISOString(),
      status,
      errorCount: errors.length,
      warningCount: warnings.length,
      errors: [...errors],
      warnings: [...warnings],
    };

    setExportHistory((current) => [entry, ...current].slice(0, MAX_EXPORT_HISTORY));
  }, []);

  const clearExportHistory = useCallback(() => {
    setExportHistory([]);
  }, []);

  const saveProjectFile = useCallback(() => {
    draftPersistence.saveProjectFile();
    recordExportResult('JSON', [], []);
  }, [draftPersistence, recordExportResult]);

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        helpOpen,
        openHelp: () => setHelpOpen(true),
        closeHelp: () => setHelpOpen(false),
        importOpen,
        openImport: () => setImportOpen(true),
        closeImport: () => setImportOpen(false),
        draftSummary: draftPersistence.draftSummary,
        autosaveState: draftPersistence.autosaveState,
        activityLog: draftPersistence.activityLog,
        addActivity: draftPersistence.addActivity,
        clearActivityLog: draftPersistence.clearActivityLog,
        saveProjectFile,
        restoreDraft: draftPersistence.restoreDraft,
        discardDraft: draftPersistence.discardDraft,
        exportHistory,
        recordExportResult,
        clearExportHistory,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
