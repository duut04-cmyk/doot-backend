import type { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/modules/auth/auth.crypto.js";

export type AdminSeedResult = "created" | "updated" | "skipped";

/**
 * Creates or promotes a single ADMIN user when ADMIN_EMAIL and ADMIN_PASSWORD
 * are configured. Never logs secrets.
 */
export async function provisionAdminUser(
  prisma: PrismaClient,
): Promise<AdminSeedResult> {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;

  if (!email || !password) {
    return "skipped";
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
    return "updated";
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
  return "created";
}
