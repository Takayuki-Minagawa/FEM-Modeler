import { useState, type ReactNode } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { AppContext } from './app-context-value';

export function AppContextProvider({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        helpOpen,
        openHelp: () => setHelpOpen(true),
        closeHelp: () => setHelpOpen(false),
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
