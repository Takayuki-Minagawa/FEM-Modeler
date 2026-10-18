import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}
export function useViewportWidth() {
  return useSyncExternalStore(subscribe, () => window.innerWidth, () => 1440);
}
