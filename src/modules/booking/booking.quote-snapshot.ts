import type { QuoteSnapshot } from "./booking.types.js";

export function mergeProviderMetadataIntoQuoteSnapshot(
  snapshot: QuoteSnapshot,
  metadata?: Record<string, unknown>,
): QuoteSnapshot {
  if (!metadata || Object.keys(metadata).length === 0) {
    return snapshot;
  }
  return {
    ...snapshot,
    providerMetadata: {
      ...(snapshot.providerMetadata ?? {}),
      ...metadata,
    },
  };
}

export function resolveShiprocketProviderMetadata(
  quoteSnapshot: QuoteSnapshot,
  evaluationMetadata?: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  const fromSnapshot = quoteSnapshot.providerMetadata;
  if (fromSnapshot && Object.keys(fromSnapshot).length > 0) {
    return fromSnapshot;
  }
  if (evaluationMetadata && Object.keys(evaluationMetadata).length > 0) {
    return evaluationMetadata;
  }
  return undefined;
}
