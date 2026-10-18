import { useCallback, useEffect, useRef, useState } from 'react';
import { generateId } from '@/core/ir/id-generator';

export type AsyncPhase = 'preparing' | 'reading' | 'processing' | 'generating' | 'packaging' | 'applying' | 'review';
export interface AsyncOperation {
  id: string;
  label: string;
  phase: AsyncPhase;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  message?: string;
}
export interface AsyncToken { id: string; controller: AbortController; signal: AbortSignal }

/** Owns one operation. Replaced, cancelled and unmounted runs cannot publish late state. */
export function useAsyncOperation() {
  const [operation, setOperation] = useState<AsyncOperation | null>(null);
  const active = useRef<AsyncToken | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.controller.abort(); active.current = null; };
  }, []);
  const isCurrent = useCallback((token: AsyncToken) => mounted.current && active.current === token && !token.signal.aborted, []);
  const begin = useCallback((label: string, phase: AsyncPhase = 'reading', id = generateId('run')): AsyncToken => {
    active.current?.controller.abort();
    const controller = new AbortController();
    const token = { id, controller, signal: controller.signal };
    active.current = token;
    controller.signal.addEventListener('abort', () => {
      if (mounted.current && active.current === token) {
        active.current = null;
        setOperation((previous) => previous?.id === id ? { ...previous, status: 'cancelled' } : previous);
      }
    }, { once: true });
    if (mounted.current) setOperation({ id, label, phase, status: 'running' });
    return token;
  }, []);
  const setPhase = useCallback((token: AsyncToken, phase: AsyncPhase) => {
    if (isCurrent(token)) setOperation((previous) => previous?.id === token.id ? { ...previous, phase } : previous);
  }, [isCurrent]);
  const finish = useCallback((token: AsyncToken, status: 'completed' | 'failed' = 'completed', message?: string) => {
    if (!isCurrent(token)) return;
    active.current = null;
    setOperation((previous) => previous?.id === token.id ? { ...previous, status, message } : previous);
  }, [isCurrent]);
  const cancel = useCallback((message?: string) => {
    const token = active.current;
    if (!token) return;
    token.controller.abort();
    if (message && mounted.current) setOperation((previous) => previous?.id === token.id ? { ...previous, message } : previous);
  }, []);
  const reset = useCallback(() => {
    active.current?.controller.abort(); active.current = null;
    if (mounted.current) setOperation(null);
  }, []);
  return { operation, begin, isCurrent, setPhase, finish, cancel, reset };
}
