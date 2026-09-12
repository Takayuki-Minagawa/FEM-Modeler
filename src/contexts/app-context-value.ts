import { createContext } from 'react';
import type { Theme } from '@/hooks/useTheme';
import type { DraftSummary } from '@/lib/project-draft-storage';

export type ActivityLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface ActivityLogEntry {
  id: string;
  level: ActivityLogLevel;
  message: string;
  timestamp: string;
}

export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface DraftPersistenceState {
  status: DraftSaveStatus;
  lastSavedAt: string | null;
  errorMessage: string | null;
}

export type ExportHistoryStatus = 'success' | 'warning' | 'error';

export interface ExportHistoryEntry {
  id: string;
  target: string;
  timestamp: string;
  status: ExportHistoryStatus;
  errorCount: number;
  warningCount: number;
  errors: string[];
  warnings: string[];
}

export interface AppContextValue {
  theme: Theme;
  toggleTheme: () => void;
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  importOpen: boolean;
  openImport: () => void;
  closeImport: () => void;
  draftSummary: DraftSummary | null;
  autosaveState: DraftPersistenceState;
  activityLog: ActivityLogEntry[];
  addActivity: (level: ActivityLogLevel, message: string) => void;
  clearActivityLog: () => void;
  saveProjectFile: () => void;
  transitionProject: (replace: () => void) => Promise<{ success: boolean; error?: string }>;
  readiness: 'initializing' | 'awaiting_restore' | 'editing';
  recentProjects: DraftSummary[];
  listDraftVersions: (projectId: string) => Promise<DraftSummary[]>;
  restoreDraft: (projectId?: string, versionId?: string) => Promise<boolean>;
  discardDraft: (projectId?: string) => Promise<void>;
  exportHistory: ExportHistoryEntry[];
  recordExportResult: (target: string, errors: string[], warnings: string[]) => void;
  clearExportHistory: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export type AppUiContextValue = Pick<AppContextValue, 'theme' | 'toggleTheme' | 'helpOpen' | 'openHelp' | 'closeHelp' | 'importOpen' | 'openImport' | 'closeImport'>;
export type AppActionsContextValue = Pick<AppContextValue, 'addActivity' | 'clearActivityLog' | 'saveProjectFile' | 'transitionProject' | 'recordExportResult' | 'clearExportHistory'>;
export const AppUiContext = createContext<AppUiContextValue | null>(null);
export const AppActionsContext = createContext<AppActionsContextValue | null>(null);
