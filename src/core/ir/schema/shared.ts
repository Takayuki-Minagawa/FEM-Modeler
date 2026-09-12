import { z } from 'zod';

export const tuple3NumberSchema = z.tuple([z.number(), z.number(), z.number()]);
export const unknownRecordSchema = z.record(z.string(), z.unknown());
export const stringRecordSchema = z.record(z.string(), z.string());
export const booleanRecordSchema = z.record(z.string(), z.boolean());
export const dofMapSchema = z.strictObject({
  ux: z.enum(['fixed', 'free', 'prescribed']),
  uy: z.enum(['fixed', 'free', 'prescribed']),
  uz: z.enum(['fixed', 'free', 'prescribed']),
  rx: z.enum(['fixed', 'free', 'prescribed']),
  ry: z.enum(['fixed', 'free', 'prescribed']),
  rz: z.enum(['fixed', 'free', 'prescribed']),
});
