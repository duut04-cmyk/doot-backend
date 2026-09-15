/**
 * Shared utility helpers will be added here as the platform grows.
 * Keep this module free of Express and Prisma coupling.
 */

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
