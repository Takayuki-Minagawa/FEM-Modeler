import { useContext } from 'react';
import { AppActionsContext } from '@/contexts/app-context-value';

/** Stable actions for forms and input handlers without a persistence subscription. */
export function useAppActionsContext() {
  const context = useContext(AppActionsContext);
  if (!context) throw new Error('useAppActionsContext must be used within AppContextProvider');
  return context;
}
