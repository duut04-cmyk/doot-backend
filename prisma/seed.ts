/**
 * Bootstrap seed: creates or promotes a single ADMIN user when
 * ADMIN_EMAIL and ADMIN_PASSWORD are set. Does not log secrets.
 *
 * Usage: npx prisma db seed
 */
/* eslint-disable no-console -- seed CLI status messages (no secrets) */
import { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/modules/auth/auth.crypto.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.info(
      "Seed skipped: set ADMIN_EMAIL and ADMIN_PASSWORD to provision an admin.",
    );
    return;
  }

  const passwordHash = await hashPassword(password);
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: "ADMIN",
        passwordHash,
        emailVerified: true,
        status: "ACTIVE",
      },
    });
    console.info(`Updated existing user to ADMIN: ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      name: "Dutt Admin",
      email,
      passwordHash,
      emailVerified: true,
      status: "ACTIVE",
      role: "ADMIN",
    },
  });
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
