// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneCanvas } from '@/viewer/SceneCanvas';

const mocks = vi.hoisted(() => {
  const root = { configure: vi.fn(), render: vi.fn(), unmount: vi.fn() };
  return { root, createRoot: vi.fn(() => root), extend: vi.fn(), events: vi.fn() };
});
vi.mock('@react-three/fiber', () => mocks);

let resized: ResizeObserverCallback;
let width = 800;
let height = 600;
beforeEach(() => {
  vi.clearAllMocks(); width = 800; height = 600;
  mocks.root.configure.mockResolvedValue(mocks.root);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height, top: 10, left: 20, bottom: height + 10, right: width + 20, x: 20, y: 10, toJSON() {} }));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resized = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
});
afterEach(async () => { cleanup(); await act(async () => {}); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('viewer root lifecycle', () => {
  it('keeps a single live WebGL root through StrictMode effect replay and disposes on real unmount', async () => {
    const view = render(<StrictMode><SceneCanvas><group /></SceneCanvas></StrictMode>);
    await act(async () => {});
    expect(mocks.createRoot).toHaveBeenCalledTimes(1);
    expect(mocks.root.unmount).not.toHaveBeenCalled();
    expect(mocks.root.configure).toHaveBeenLastCalledWith(expect.objectContaining({ events: mocks.events, frameloop: 'demand', dpr: [1, 2], size: { width: 800, height: 600, top: 10, left: 20 } }));
    expect(mocks.root.render).toHaveBeenCalled();
    view.unmount(); await act(async () => {});
    expect(mocks.root.unmount).toHaveBeenCalledTimes(1);
  });

  it('updates children and measured size without recreating the root or camera options', async () => {
    const view = render(<SceneCanvas><group name="before" /></SceneCanvas>);
    await act(async () => {});
    const firstCamera = mocks.root.configure.mock.calls[0][0].camera;
    const firstTree = mocks.root.render.mock.calls.at(-1)![0];
    view.rerender(<SceneCanvas><group name="after" /></SceneCanvas>);
    expect(mocks.root.render.mock.calls.at(-1)![0]).not.toBe(firstTree);
    width = 1000; height = 400;
    await act(async () => { resized([], {} as ResizeObserver); await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(mocks.root.configure.mock.calls.at(-1)![0]).toMatchObject({ size: { width: 1000, height: 400 } });
    expect(mocks.root.configure.mock.calls.at(-1)![0].camera).toBe(firstCamera);
    expect(mocks.createRoot).toHaveBeenCalledTimes(1);
  });

  it('does not render a late configuration after unmount', async () => {
    let configured!: (value: typeof mocks.root) => void;
    mocks.root.configure.mockImplementation(() => new Promise((resolve) => { configured = resolve; }));
    const view = render(<SceneCanvas><group /></SceneCanvas>);
    view.unmount();
    await act(async () => { configured(mocks.root); });
    expect(mocks.root.render).not.toHaveBeenCalled();
    expect(mocks.root.unmount).toHaveBeenCalledTimes(1);
  });

  it('waits for a nonzero panel size before allocating WebGL', async () => {
    width = 0; height = 0;
    render(<SceneCanvas><group /></SceneCanvas>);
    expect(mocks.createRoot).not.toHaveBeenCalled();
    width = 600; height = 400;
    await act(async () => { resized([], {} as ResizeObserver); await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(mocks.createRoot).toHaveBeenCalledTimes(1);
  });
});
