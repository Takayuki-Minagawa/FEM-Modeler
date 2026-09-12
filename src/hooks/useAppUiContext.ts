import { useContext } from 'react';
import { AppUiContext } from '@/contexts/app-context-value';

/** Theme and dialog controls do not subscribe to save status or activity logs. */
export function useAppUiContext() {
  const context = useContext(AppUiContext);
  if (!context) throw new Error('useAppUiContext must be used within AppContextProvider');
  return context;
}
