import { useState } from 'react';
import { AppLayout } from '@/ui/layout/AppLayout';
import { StartScreen } from '@/ui/dialogs/StartScreen';
import { HelpDialog } from '@/ui/dialogs/HelpDialog';
import { useTheme } from '@/hooks/useTheme';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

export interface AppContext {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  openHelp: () => void;
}

let _appContext: AppContext | null = null;
export function getAppContext(): AppContext | null {
  return _appContext;
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);

  useKeyboardShortcuts();

  _appContext = { theme, toggleTheme, openHelp: () => setHelpOpen(true) };

  return (
    <>
      <AppLayout />
      <StartScreen />
      <HelpDialog isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
