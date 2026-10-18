import { parseFiniteNumber } from '../common/numeric';
export const AXIS_LABELS = ['X', 'Y', 'Z'] as const;

export type TupleInput = [string, string, string];

export function formatTuple(values: [number, number, number]): TupleInput {
  return values.map(String) as TupleInput;
}

export function parseTuple(values: TupleInput, invalidMessage: string): [number, number, number] {
  return values.map((value) => {
    const parsed = parseFiniteNumber(value);
    if (parsed === null) throw new Error(invalidMessage);
    return parsed;
  }) as [number, number, number];
}

export function updateTupleInput(
  tuple: TupleInput,
  index: number,
  nextValue: string,
): TupleInput {
  const next = [...tuple] as TupleInput;
  next[index] = nextValue;
  return next;
}
