import { AppLayout } from '@/ui/layout/AppLayout';
import { StartScreen } from '@/ui/dialogs/StartScreen';
import { HelpDialog } from '@/ui/dialogs/HelpDialog';
import { ImportDialog } from '@/ui/dialogs/ImportDialog';
import { AppContextProvider } from '@/contexts/AppContext';
import { useAppContext } from '@/hooks/useAppContext';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

function AppInner() {
  const { helpOpen, closeHelp, importOpen, closeImport } = useAppContext();
  useKeyboardShortcuts();

  return (
    <>
      <AppLayout />
      <StartScreen />
      <HelpDialog isOpen={helpOpen} onClose={closeHelp} />
      <ImportDialog isOpen={importOpen} onClose={closeImport} />
    </>
  );
}

export default function App() {
  return (
    <AppContextProvider>
      <AppInner />
    </AppContextProvider>
  );
}
