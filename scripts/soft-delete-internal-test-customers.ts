#!/usr/bin/env tsx
/**
 * Soft-delete CUSTOMER users with `@doot.test` emails (Cashfree cert / mock harness).
 * Payment rows remain on Payment / Refund tables; only User.status becomes DELETED
 * so they cannot log in and no longer appear in admin customer lists.
 *
 * Usage: npx tsx scripts/soft-delete-internal-test-customers.ts
 */
/* eslint-disable no-console -- CLI */
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { INTERNAL_TEST_EMAIL_DOMAIN } from "../src/modules/customer/customer-test-users.js";

loadDotenv({ override: false });

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.user.updateMany({
      where: {
        role: "CUSTOMER",
        status: { not: "DELETED" },
        email: {
          endsWith: `@${INTERNAL_TEST_EMAIL_DOMAIN}`,
          mode: "insensitive",
        },
      },
      data: { status: "DELETED" },
    });
    console.log(
      `Soft-deleted ${result.count} internal test customer(s) (*@${INTERNAL_TEST_EMAIL_DOMAIN}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
