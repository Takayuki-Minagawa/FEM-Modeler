import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useProjectDraftPersistence } from '@/hooks/useProjectDraftPersistence';
import { generateId } from '@/core/ir/id-generator';
import { AppContext, AppUiContext, AppActionsContext } from './app-context-value';
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

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const openImport = useCallback(() => setImportOpen(true), []);
  const closeImport = useCallback(() => setImportOpen(false), []);
  const downloadDraftFile = draftPersistence.saveProjectFile;

  const saveProjectFile = useCallback(() => {
    downloadDraftFile();
    recordExportResult('JSON', [], []);
  }, [downloadDraftFile, recordExportResult]);

  const value = useMemo(() => ({
    ...draftPersistence, theme, toggleTheme, helpOpen, openHelp, closeHelp, importOpen, openImport, closeImport,
    saveProjectFile, exportHistory, recordExportResult, clearExportHistory,
  }), [draftPersistence, theme, toggleTheme, helpOpen, openHelp, closeHelp, importOpen, openImport, closeImport,
    saveProjectFile, exportHistory, recordExportResult, clearExportHistory]);
  const uiValue = useMemo(() => ({ theme, toggleTheme, helpOpen, openHelp, closeHelp, importOpen, openImport, closeImport }),
    [theme, toggleTheme, helpOpen, openHelp, closeHelp, importOpen, openImport, closeImport]);
  const { addActivity, clearActivityLog } = draftPersistence;
  const actionsValue = useMemo(() => ({ addActivity, clearActivityLog, saveProjectFile, recordExportResult, clearExportHistory }),
    [addActivity, clearActivityLog, saveProjectFile, recordExportResult, clearExportHistory]);
  return <AppUiContext.Provider value={uiValue}><AppActionsContext.Provider value={actionsValue}>
    <AppContext.Provider value={value}>{children}</AppContext.Provider>
  </AppActionsContext.Provider></AppUiContext.Provider>;
}
