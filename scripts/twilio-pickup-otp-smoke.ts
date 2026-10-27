#!/usr/bin/env tsx
/** One-shot pickup OTP smoke test — redacts OTP in stdout. */
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";

loadDotenv({ override: false });

async function main() {
  const prisma = new PrismaClient();
  try {
    const delivery = await prisma.delivery.findFirst({
      where: { status: { in: ["DRIVER_ASSIGNED", "BOOKED", "PICKUP_OTP_PENDING"] } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, status: true, customerId: true, reference: true },
    });

    if (!delivery) {
      console.log(JSON.stringify({ ok: false, reason: "NO_ELIGIBLE_DELIVERY" }));
      process.exitCode = 1;
      return;
    }

    const token = generateAccessToken(delivery.customerId);
    const url = `http://localhost:5000/api/v1/deliveries/${delivery.id}/pickup-otp`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const data = body.data as Record<string, unknown> | undefined;
    if (data && "_testOtp" in data) {
      data._testOtp = "[REDACTED]";
    }

    const updated = await prisma.delivery.findUnique({
      where: { id: delivery.id },
      select: { status: true },
    });

    console.log(
      JSON.stringify(
        {
          ok: res.ok,
          endpoint: "POST /api/v1/deliveries/{id}/pickup-otp",
          deliveryId: delivery.id,
          deliveryReference: delivery.reference,
          priorStatus: delivery.status,
          httpStatus: res.status,
          response: body,
          deliveryStatusAfter: updated?.status,
          smsDestinationMasked: "******6836",
          note: "Check server logs for provider TWILIO and providerRequestId (message SID).",
        },
        null,
        2,
      ),
    );

    if (!res.ok) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
