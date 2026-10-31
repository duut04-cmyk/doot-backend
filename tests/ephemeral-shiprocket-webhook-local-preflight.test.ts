import { describe, expect, it } from "vitest";
import {
  assertGuardedLocalDatabaseUrl,
  assertNeutralWebhookRouteRegistered,
  SHIPROCKET_WEBHOOK_LOCAL,
} from "../scripts/ephemeral-shiprocket-webhook-local-preflight.lib.js";

describe("ephemeral Shiprocket webhook local preflight", () => {
  it("accepts the intended local database URL shape", () => {
    const url = `postgresql://postgres:secret@${SHIPROCKET_WEBHOOK_LOCAL.host}:${SHIPROCKET_WEBHOOK_LOCAL.port}/${SHIPROCKET_WEBHOOK_LOCAL.database}?schema=public`;
    expect(() => assertGuardedLocalDatabaseUrl(url)).not.toThrow();
  });

  it("rejects non-local database hosts", () => {
    const url =
      "postgresql://postgres:secret@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres";
    expect(() => assertGuardedLocalDatabaseUrl(url)).toThrow(/host must be 127.0.0.1/);
  });

  it("registers neutral POST /tracking on provider webhook router", () => {
    expect(() => assertNeutralWebhookRouteRegistered()).not.toThrow();
  });
});
