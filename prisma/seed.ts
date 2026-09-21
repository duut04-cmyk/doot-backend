/**
 * Bootstrap seed: creates or promotes a single ADMIN user when
 * ADMIN_EMAIL and ADMIN_PASSWORD are set. Does not log secrets.
 *
 * Usage: npx prisma db seed
 */
/* eslint-disable no-console -- seed CLI status messages (no secrets) */
import { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env.js";
import { provisionAdminUser } from "./seed-admin.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const result = await provisionAdminUser(prisma);

  if (result === "skipped") {
    console.info(
      "Seed skipped: set ADMIN_EMAIL and ADMIN_PASSWORD to provision an admin.",
    );
    return;
  }

  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  if (result === "updated") {
    console.info(`Updated existing user to ADMIN: ${email}`);
    return;
  }

  console.info(`Created ADMIN user: ${email}`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed");
    throw error;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
