// @vitest-environment jsdom
import { act } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Modal } from '@/ui/dialogs/Modal';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAppStore } from '@/state/store';
import { generateShape } from '@/geometry/primitives/generators';

const { saveProjectFile } = vi.hoisted(() => ({ saveProjectFile: vi.fn() }));
vi.mock('@/hooks/useAppActionsContext', () => ({ useAppActionsContext: () => ({ saveProjectFile }) }));
function Harness({ open = true, close = () => undefined }: { open?: boolean; close?: () => void }) {
  useKeyboardShortcuts();
  return <Modal isOpen={open} onClose={close} labelledBy="modal-title"><h2 id="modal-title">Help</h2><button>Close</button><input aria-label="Dialog value" /></Modal>;
}
async function press(target: EventTarget, key: string, code: string, keyCode: number, ctrlKey = false, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, code, keyCode, ctrlKey, shiftKey, bubbles: true, cancelable: true });
  await act(async () => { target.dispatchEvent(event); });
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keyup', { key, code, keyCode, ctrlKey, shiftKey, bubbles: true })); });
  return event;
}
beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.getState().createProject('Keyboard safety');
  const shape = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 });
  useAppStore.getState().addBodyWithTopology(shape.body, shape);
  useAppStore.getState().setSelectedEntities([shape.body.id]);
  shape.threeGeometry.dispose();
});
afterEach(cleanup);

it('blocks background Delete, Backspace, Undo, Redo, Save and deselection from modal buttons', async () => {
  const close = vi.fn(); const view = render(<Harness close={close} />);
  const original = useAppStore.getState();
  const button = view.getByRole('button', { name: 'Close' });
  expect(document.activeElement).toBe(button);
  for (const [key, code, keyCode, ctrl, shift] of [
    ['Delete', 'Delete', 46, false, false], ['Backspace', 'Backspace', 8, false, false],
    ['z', 'KeyZ', 90, true, false], ['z', 'KeyZ', 90, true, true], ['s', 'KeyS', 83, true, false],
  ] as const) await press(button, key, code, keyCode, ctrl, shift);
  await press(button, 'Escape', 'Escape', 27);
  expect(close).toHaveBeenCalledOnce();
  expect(useAppStore.getState().ir).toBe(original.ir);
  expect(useAppStore.getState().selectedEntityIds).toEqual(original.selectedEntityIds);
  expect(saveProjectFile).not.toHaveBeenCalled();
});

it('keeps native input keys available inside a dialog and restores Delete after closing', async () => {
  const view = render(<Harness />);
  const input = view.getByRole('textbox'); input.focus();
  expect((await press(input, 'Backspace', 'Backspace', 8)).defaultPrevented).toBe(false);
  expect((await press(input, 'z', 'KeyZ', 90, true)).defaultPrevented).toBe(false);
  view.rerender(<Harness open={false} />);
  await press(document.body, 'Delete', 'Delete', 46);
  expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(0);
  await press(document.body, 'z', 'KeyZ', 90, true);
  expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(1);
});
