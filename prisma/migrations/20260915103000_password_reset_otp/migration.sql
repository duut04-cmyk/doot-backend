-- Password reset: replace link tokens with OTP + short-lived verification tokens.

DROP TABLE IF EXISTS "PasswordResetToken";

CREATE TABLE "PasswordResetOtp" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetOtp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordResetVerificationToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PasswordResetOtp_userId_idx" ON "PasswordResetOtp"("userId");
CREATE INDEX "PasswordResetOtp_expiresAt_idx" ON "PasswordResetOtp"("expiresAt");
CREATE INDEX "PasswordResetOtp_consumedAt_idx" ON "PasswordResetOtp"("consumedAt");

CREATE INDEX "PasswordResetVerificationToken_userId_idx" ON "PasswordResetVerificationToken"("userId");
CREATE INDEX "PasswordResetVerificationToken_expiresAt_idx" ON "PasswordResetVerificationToken"("expiresAt");

ALTER TABLE "PasswordResetOtp" ADD CONSTRAINT "PasswordResetOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetVerificationToken" ADD CONSTRAINT "PasswordResetVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
