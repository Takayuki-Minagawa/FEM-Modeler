import { createContext } from 'react';
import type { Theme } from '@/hooks/useTheme';

export interface AppContextValue {
  theme: Theme;
  toggleTheme: () => void;
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  importOpen: boolean;
  openImport: () => void;
  closeImport: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);
