import type { ValidationItem, ValidationSeverity } from '@/core/ir/types';

export interface ValidationRule {
  id: string;
  run: (ir: import('@/core/ir/types').ProjectIR) => ValidationItem[];
}

export function createItem(
  severity: ValidationSeverity,
  code: string,
  title: string,
  message: string,
  target_ref: string,
  suggested_fix: string,
  dismissible = true,
): ValidationItem {
  return {
    id: `val_${code}_${Date.now()}`,
    severity,
    code,
    title,
    message,
    target_ref,
    suggested_fix,
    dismissible,
    status: 'open',
  };
}
