// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { useProjectFileLoader } from '@/hooks/useProjectFileLoader';
import { useAsyncOperation } from '@/hooks/useAsyncOperation';
import { useAppStore } from '@/state/store';

const mocks = vi.hoisted(() => ({ read: vi.fn(), activity: vi.fn(), transition: vi.fn() }));
vi.mock('@/export/project/load', async (original) => ({ ...await original<typeof import('@/export/project/load')>(), readFileAsText: mocks.read }));
vi.mock('@/hooks/useAppActionsContext', () => ({ useAppActionsContext: () => ({ addActivity: mocks.activity, transitionProject: mocks.transition }) }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const file = (name = 'project.fem.json') => new File(['{}'], name);
let loadedJson: string;
beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
  useAppStore.getState().createProject('File project', 'solid');
  loadedJson = JSON.stringify(useAppStore.getState().ir);
  useAppStore.getState().createProject('Original', 'solid');
  mocks.transition.mockImplementation(async (replace: () => void) => { replace(); return { success: true }; });
});
afterEach(cleanup);

describe('project-file operation ownership', () => {
  it('does not replace a project switched while the file was reading or publish an old error', async () => {
    const pending = deferred<string>(); mocks.read.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useProjectFileLoader());
    const onCancelled = vi.fn();
    let loading!: ReturnType<typeof result.current.loadFromFile>;
    act(() => { loading = result.current.loadFromFile(file(), { onCancelled }); });
    act(() => useAppStore.getState().createProject('New work', 'thermal'));
    expect(onCancelled).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve('invalid old JSON'); expect((await loading).cancelled).toBe(true); });
    expect(useAppStore.getState().ir.meta.project_name).toBe('New work');
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(result.current.operation?.status).toBe('cancelled');
  });

  it.each(['cancel', 'switch', 'unmount'])('rechecks a queued replacement after %s while draft saving', async (action) => {
    mocks.read.mockResolvedValueOnce(loadedJson);
    const gate = deferred<void>();
    mocks.transition.mockImplementationOnce(async (replace: () => void) => { await gate.promise; replace(); return { success: true }; });
    const view = renderHook(() => useProjectFileLoader());
    const controller = new AbortController();
    let loading!: ReturnType<typeof view.result.current.loadFromFile>;
    await act(async () => { loading = view.result.current.loadFromFile(file(), { signal: controller.signal }); });
    expect(mocks.transition).toHaveBeenCalledOnce();
    if (action === 'cancel') act(() => controller.abort());
    if (action === 'switch') act(() => useAppStore.getState().createProject('Changed', 'solid'));
    if (action === 'unmount') view.unmount();
    const preserved = useAppStore.getState().ir;
    await act(async () => { gate.resolve(); expect((await loading).cancelled).toBe(true); });
    expect(useAppStore.getState().ir).toBe(preserved);
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it('allows its own project transition and keeps the later file when an earlier read completes afterward', async () => {
    const slow = deferred<string>();
    mocks.read.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(loadedJson);
    const { result } = renderHook(() => useProjectFileLoader());
    let first!: ReturnType<typeof result.current.loadFromFile>;
    act(() => { first = result.current.loadFromFile(file('old.fem.json')); });
    let second!: Awaited<ReturnType<typeof result.current.loadFromFile>>;
    await act(async () => { second = await result.current.loadFromFile(file('new.fem.json')); });
    expect(second.success).toBe(true);
    expect(useAppStore.getState().ir.meta.project_name).toBe('File project');
    expect(result.current.operation?.status).toBe('completed');
    const id = result.current.operation!.id;
    await act(async () => { slow.resolve(loadedJson); expect((await first).cancelled).toBe(true); });
    expect(result.current.operation?.id).toBe(id);
    expect(result.current.operation?.label).toBe('new.fem.json');
    expect(mocks.transition).toHaveBeenCalledOnce();
    expect(mocks.activity).toHaveBeenCalledOnce();
  });
});

describe('shared asynchronous operation state', () => {
  it('ignores replaced and cancelled completions while keeping stable lifecycle callbacks', () => {
    const { result, rerender, unmount } = renderHook(() => useAsyncOperation());
    const callbacks = { begin: result.current.begin, cancel: result.current.cancel, reset: result.current.reset };
    let old!: ReturnType<typeof result.current.begin>, current!: typeof old;
    act(() => { old = result.current.begin('old'); });
    act(() => { current = result.current.begin('new', 'processing'); result.current.finish(old, 'failed', 'late error'); });
    expect(old.signal.aborted).toBe(true);
    expect(result.current.operation?.label).toBe('new');
    expect(result.current.operation?.status).toBe('running');
    act(() => { result.current.cancel('Cancelled by user'); result.current.finish(current); });
    expect(result.current.operation?.status).toBe('cancelled');
    expect(result.current.operation?.message).toBe('Cancelled by user');
    rerender();
    expect(result.current.begin).toBe(callbacks.begin);
    expect(result.current.cancel).toBe(callbacks.cancel);
    expect(result.current.reset).toBe(callbacks.reset);
    act(() => { current = result.current.begin('unmounted'); });
    unmount();
    expect(current.signal.aborted).toBe(true);
    expect(result.current.isCurrent(current)).toBe(false);
  });
});
