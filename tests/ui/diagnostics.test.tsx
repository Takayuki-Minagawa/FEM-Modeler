// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { DiagnosticMessage } from '@/ui/forms/common/DiagnosticMessage';
import { createItem } from '@/validation/types';

afterEach(cleanup);
describe('localized stable diagnostics', () => {
  it('switches the explanation while retaining exact solver details', async () => {
    const item = createItem('error', 'LOAD_NO_TARGET', 'Missing load target', 'Load_1 has no target.', 'load_1', 'Select a target.');
    await i18n.changeLanguage('ja');
    render(<DiagnosticMessage item={item} />);
    expect(screen.getByText('荷重の対象を選んでください')).toBeDefined();
    expect(screen.getByText('Load_1 has no target.')).toBeDefined();
    cleanup();
    await i18n.changeLanguage('en');
    render(<DiagnosticMessage item={item} />);
    expect(screen.getByText('Missing load target')).toBeDefined();
    expect(screen.queryByText('荷重の対象を選んでください')).toBeNull();
  });
});
