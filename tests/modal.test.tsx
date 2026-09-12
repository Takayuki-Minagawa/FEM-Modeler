// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Modal } from '@/ui/dialogs/Modal';

it('traps Tab and Escape, preserves focus across callback updates and returns focus on close', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  const opener = document.createElement('button'); document.body.append(opener, host); opener.focus();
  const root = createRoot(host); const close = vi.fn();
  const content = <><h2 id="modal-title">Title</h2><input aria-label="Value" /><button>Last</button></>;
  await act(async () => root.render(<Modal isOpen onClose={() => close()} labelledBy="modal-title">{content}</Modal>));
  const input = host.querySelector('input')!; const last = host.querySelector('button')!;
  expect(document.activeElement).toBe(input);
  last.focus();
  await act(async () => root.render(<Modal isOpen onClose={() => close()} labelledBy="modal-title">{content}</Modal>));
  expect(document.activeElement).toBe(last);
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(input);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(last);
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Modal isOpen={false} onClose={close} labelledBy="modal-title">{content}</Modal>));
  expect(document.activeElement).toBe(opener);
  await act(async () => root.unmount()); host.remove(); opener.remove();
});
