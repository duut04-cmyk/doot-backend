import type {
  EmailVerificationOtp,
  OAuthAccount,
  OAuthProvider,
  PasswordResetToken,
  Prisma,
  RefreshToken,
  User,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import type {
  CreateOAuthAccountData,
  CreatePasswordResetTokenData,
  CreateRefreshTokenData,
  CreateUserData,
  UpdateUserData,
} from "./auth.types.js";

export type AuthDbClient =
  | Prisma.TransactionClient
  | ReturnType<typeof getPrismaClient>;

const authenticatedUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  emailVerified: true,
  status: true,
  role: true,
} as const;

export type AuthenticatedUserRecord = Prisma.UserGetPayload<{
  select: typeof authenticatedUserSelect;
}>;

export interface IAuthRepository {
  withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
  findUserByEmail(email: string, client?: AuthDbClient): Promise<User | null>;
  findUserById(userId: string, client?: AuthDbClient): Promise<User | null>;
  findAuthenticatedUserById(
    userId: string,
    client?: AuthDbClient,
  ): Promise<AuthenticatedUserRecord | null>;
  createUser(data: CreateUserData, client?: AuthDbClient): Promise<User>;
  updateUser(
    userId: string,
    data: UpdateUserData,
    client?: AuthDbClient,
  ): Promise<User>;
  findLatestVerificationOtp(
    userId: string,
    client?: AuthDbClient,
  ): Promise<EmailVerificationOtp | null>;
  findLatestActiveVerificationOtp(
    userId: string,
    client?: AuthDbClient,
  ): Promise<EmailVerificationOtp | null>;
  invalidateVerificationOtps(
    userId: string,
    client?: AuthDbClient,
  ): Promise<void>;
  createVerificationOtp(
    data: {
      userId: string;
      otpHash: string;
      expiresAt: Date;
    },
    client?: AuthDbClient,
  ): Promise<EmailVerificationOtp>;
  markVerificationOtpUsed(
    otpId: string,
    client?: AuthDbClient,
  ): Promise<EmailVerificationOtp>;
  incrementVerificationOtpAttempts(
    otpId: string,
    client?: AuthDbClient,
  ): Promise<EmailVerificationOtp>;
  createRefreshToken(
    data: CreateRefreshTokenData,
    client?: AuthDbClient,
  ): Promise<RefreshToken>;
  findRefreshTokenByHash(
    tokenHash: string,
    client?: AuthDbClient,
  ): Promise<RefreshToken | null>;
  revokeRefreshToken(
    tokenId: string,
    client?: AuthDbClient,
  ): Promise<RefreshToken>;
  revokeAllRefreshTokens(userId: string, client?: AuthDbClient): Promise<void>;
  createPasswordResetToken(
    data: CreatePasswordResetTokenData,
    client?: AuthDbClient,
  ): Promise<PasswordResetToken>;
  findPasswordResetTokenByHash(
    tokenHash: string,
    client?: AuthDbClient,
  ): Promise<PasswordResetToken | null>;
  invalidatePasswordResetTokens(
    userId: string,
    client?: AuthDbClient,
  ): Promise<void>;
  markPasswordResetTokenUsed(
    tokenId: string,
    client?: AuthDbClient,
  ): Promise<PasswordResetToken>;
  updateUserPassword(
    userId: string,
    passwordHash: string,
    client?: AuthDbClient,
  ): Promise<User>;
  findOAuthAccount(
    provider: OAuthProvider,
    providerAccountId: string,
    client?: AuthDbClient,
  ): Promise<(OAuthAccount & { user: User }) | null>;
  createOAuthAccount(
    data: CreateOAuthAccountData,
    client?: AuthDbClient,
  ): Promise<OAuthAccount>;
  createUserWithOAuthAccount(input: {
    user: CreateUserData;
    oauth: Omit<CreateOAuthAccountData, "userId">;
  }): Promise<{ user: User; oauthAccount: OAuthAccount }>;
}

export class AuthRepository implements IAuthRepository {
  private db(client?: AuthDbClient) {
    return client ?? getPrismaClient();
  }

  async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return getPrismaClient().$transaction(fn);
  }

  findUserByEmail(email: string, client?: AuthDbClient): Promise<User | null> {
    return this.db(client).user.findUnique({ where: { email } });
  }

  findUserById(userId: string, client?: AuthDbClient): Promise<User | null> {
    return this.db(client).user.findUnique({ where: { id: userId } });
  }

  findAuthenticatedUserById(
    userId: string,
    client?: AuthDbClient,
  ): Promise<AuthenticatedUserRecord | null> {
    return this.db(client).user.findUnique({
      where: { id: userId },
      select: authenticatedUserSelect,
    });
  }

  createUser(data: CreateUserData, client?: AuthDbClient): Promise<User> {
    return this.db(client).user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone ?? null,
        passwordHash: data.passwordHash ?? null,
        emailVerified: data.emailVerified ?? false,
      },
    });
  }

  updateUser(
    userId: string,
    data: UpdateUserData,
    client?: AuthDbClient,
  ): Promise<User> {
    return this.db(client).user.update({
      where: { id: userId },
      data,
    });
  }

  findLatestVerificationOtp(
    userId: string,
    client?: AuthDbClient,
  ): Promise<EmailVerificationOtp | null> {
    return this.db(client).emailVerificationOtp.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  findLatestActiveVerificationOtp(
    userId: string,
    client?: AuthDbClient,
  ): Promise<EmailVerificationOtp | null> {
    return this.db(client).emailVerificationOtp.findFirst({
      where: {
        userId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async invalidateVerificationOtps(
    userId: string,
    client?: AuthDbClient,
  ): Promise<void> {
    await this.db(client).emailVerificationOtp.updateMany({
      where: {
        userId,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });
  }

  createVerificationOtp(
    data: {
      userId: string;
      otpHash: string;
      expiresAt: Date;
    },
    client?: AuthDbClient,
  ): Promise<EmailVerificationOtp> {
    return this.db(client).emailVerificationOtp.create({
      data: {
        userId: data.userId,
        otpHash: data.otpHash,
        expiresAt: data.expiresAt,
        attempts: 0,
      },
    });
  }

  markVerificationOtpUsed(
    otpId: string,
    client?: AuthDbClient,
  ): Promise<EmailVerificationOtp> {
    return this.db(client).emailVerificationOtp.update({
      where: { id: otpId },
      data: { usedAt: new Date() },
    });
  }

  incrementVerificationOtpAttempts(
    otpId: string,
    client?: AuthDbClient,
  ): Promise<EmailVerificationOtp> {
    return this.db(client).emailVerificationOtp.update({
      where: { id: otpId },
      data: { attempts: { increment: 1 } },
    });
  }

  createRefreshToken(
    data: CreateRefreshTokenData,
    client?: AuthDbClient,
  ): Promise<RefreshToken> {
    return this.db(client).refreshToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  findRefreshTokenByHash(
    tokenHash: string,
    client?: AuthDbClient,
  ): Promise<RefreshToken | null> {
    return this.db(client).refreshToken.findFirst({
      where: { tokenHash },
    });
  }

  revokeRefreshToken(
    tokenId: string,
    client?: AuthDbClient,
  ): Promise<RefreshToken> {
    return this.db(client).refreshToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllRefreshTokens(
    userId: string,
    client?: AuthDbClient,
  ): Promise<void> {
    await this.db(client).refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  createPasswordResetToken(
    data: CreatePasswordResetTokenData,
    client?: AuthDbClient,
  ): Promise<PasswordResetToken> {
    return this.db(client).passwordResetToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  findPasswordResetTokenByHash(
    tokenHash: string,
    client?: AuthDbClient,
  ): Promise<PasswordResetToken | null> {
    return this.db(client).passwordResetToken.findFirst({
      where: { tokenHash },
    });
  }

  async invalidatePasswordResetTokens(
    userId: string,
    client?: AuthDbClient,
  ): Promise<void> {
    await this.db(client).passwordResetToken.updateMany({
      where: {
        userId,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });
  }

  markPasswordResetTokenUsed(
    tokenId: string,
    client?: AuthDbClient,
  ): Promise<PasswordResetToken> {
    return this.db(client).passwordResetToken.update({
      where: { id: tokenId },
      data: { usedAt: new Date() },
    });
  }

  updateUserPassword(
    userId: string,
    passwordHash: string,
    client?: AuthDbClient,
  ): Promise<User> {
    return this.db(client).user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  findOAuthAccount(
    provider: OAuthProvider,
    providerAccountId: string,
    client?: AuthDbClient,
  ): Promise<(OAuthAccount & { user: User }) | null> {
    return this.db(client).oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      include: { user: true },
    });
  }

  createOAuthAccount(
    data: CreateOAuthAccountData,
    client?: AuthDbClient,
  ): Promise<OAuthAccount> {
    return this.db(client).oAuthAccount.create({
      data: {
        userId: data.userId,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
      },
    });
  }

  async createUserWithOAuthAccount(input: {
    user: CreateUserData;
    oauth: Omit<CreateOAuthAccountData, "userId">;
  }): Promise<{ user: User; oauthAccount: OAuthAccount }> {
    return this.withTransaction(async (tx) => {
      const user = await this.createUser(input.user, tx);
      const oauthAccount = await this.createOAuthAccount(
        {
          userId: user.id,
          provider: input.oauth.provider,
          providerAccountId: input.oauth.providerAccountId,
        },
        tx,
      );
      return { user, oauthAccount };
    });
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (
    error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return true;
  }

  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

export const authRepository = new AuthRepository();
