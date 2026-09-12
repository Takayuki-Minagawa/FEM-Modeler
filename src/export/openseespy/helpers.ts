import type {
  GeometryBody
} from '@/core/ir/types';
import { COORDINATE_TOLERANCE } from './topology';

export const VALUE_TOLERANCE = 1e-12;

export function readPositiveMetadataNumber(
  body: GeometryBody,
  key: string,
  errors: string[],
): number | null {
  const value = body.metadata[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    pushUnique(errors, `Beam body "${body.name}" metadata.${key} must be a finite positive number.`);
    return null;
  }
  return value;
}

export function readIntegerMetadataNumber(
  body: GeometryBody,
  key: string,
  minimum: number,
  errors: string[],
): number | null {
  const value = body.metadata[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    pushUnique(errors, `Beam body "${body.name}" metadata.${key} must be an integer >= ${minimum}.`);
    return null;
  }
  return value;
}

export function requirePositive(
  value: number | null | undefined,
  label: string,
  errors: string[],
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    pushUnique(errors, `${label} must be a finite positive number; no default was substituted.`);
    return null;
  }
  return value;
}

export function getOrCreateTag(tags: Map<string, number>, id: string): number {
  const existing = tags.get(id);
  if (existing !== undefined) return existing;
  const tag = tags.size + 1;
  tags.set(id, tag);
  return tag;
}

export function coordinatesEqual(
  left: [number, number, number],
  right: [number, number, number],
): boolean {
  return left.every((value, index) =>
    Math.abs(value - right[index]) <= COORDINATE_TOLERANCE * Math.max(1, Math.abs(value), Math.abs(right[index])));
}

export function pushUnique(target: string[], message: string): void {
  if (!target.includes(message)) target.push(message);
}

export function singleLineComment(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
      ? ' '
      : character;
  }).join('').trim();
}
