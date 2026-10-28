import { describe, expect, it } from "vitest";
import {
  assertPostgresConcurrencyTestDatabaseUrl,
  POSTGRES_CONCURRENCY_TEST_DATABASE_NAME,
} from "./helpers/postgres-concurrency-test-database.js";

describe("assertPostgresConcurrencyTestDatabaseUrl", () => {
  it("accepts an allowed local target with the required database name", () => {
    const url = `postgresql://doot_concurrency_test:secret@127.0.0.1:54329/${POSTGRES_CONCURRENCY_TEST_DATABASE_NAME}`;
    expect(assertPostgresConcurrencyTestDatabaseUrl(url)).toBe(url);
  });

  it("accepts localhost hostname", () => {
    const url = `postgresql://user:pass@localhost:5432/${POSTGRES_CONCURRENCY_TEST_DATABASE_NAME}`;
    expect(assertPostgresConcurrencyTestDatabaseUrl(url)).toBe(url);
  });

  it("rejects missing URL", () => {
    expect(() => assertPostgresConcurrencyTestDatabaseUrl(undefined)).toThrow(
      /TEST_DATABASE_URL is required/,
    );
  });

  it("rejects malformed URL", () => {
    expect(() => assertPostgresConcurrencyTestDatabaseUrl("not-a-url")).toThrow(
      /not a valid URL/,
    );
  });

  it("rejects wrong database name", () => {
    expect(() =>
      assertPostgresConcurrencyTestDatabaseUrl(
        "postgresql://user:pass@127.0.0.1:5432/production_app",
      ),
    ).toThrow(new RegExp(POSTGRES_CONCURRENCY_TEST_DATABASE_NAME));
  });

  it("rejects disallowed remote host", () => {
    expect(() =>
      assertPostgresConcurrencyTestDatabaseUrl(
        `postgresql://user:pass@db.prod.example.com:5432/${POSTGRES_CONCURRENCY_TEST_DATABASE_NAME}`,
      ),
    ).toThrow(/not in the allowed local disposable-test host list/);
  });

  it("rejects production-like managed host patterns", () => {
    expect(() =>
      assertPostgresConcurrencyTestDatabaseUrl(
        `postgresql://user:pass@xyz.supabase.co:5432/${POSTGRES_CONCURRENCY_TEST_DATABASE_NAME}`,
      ),
    ).toThrow(/not permitted for disposable concurrency tests/);
  });
});
