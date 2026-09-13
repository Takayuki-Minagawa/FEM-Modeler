/* eslint-disable @typescript-eslint/no-explicit-any */
// The pinned OCCT 7.4 Embind distribution has no TypeScript declarations.
// Keep its dynamic constructor/overload boundary inside the kernel adapter.
export type OCCT = Record<string, any>;
export type OCShape = any;
export interface OCHandle { delete(): void }
