import { AppLayout } from '@/ui/layout/AppLayout';
import { StartScreen } from '@/ui/dialogs/StartScreen';
import { HelpDialog } from '@/ui/dialogs/HelpDialog';
import { AppContextProvider } from '@/contexts/AppContext';
import { useAppContext } from '@/hooks/useAppContext';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

function AppInner() {
  const { helpOpen, closeHelp } = useAppContext();
  useKeyboardShortcuts();

  return (
    <>
      <AppLayout />
      <StartScreen />
      <HelpDialog isOpen={helpOpen} onClose={closeHelp} />
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
