import { randomUUID } from "node:crypto";
import type {
  EmailVerificationOtp,
  OAuthAccount,
  OAuthProvider,
  PasswordResetOtp,
  PasswordResetVerificationToken,
  Prisma,
  RefreshToken,
  User,
  UserRole,
  UserStatus,
} from "@prisma/client";
import type {
  AuthenticatedUserRecord,
  IAuthRepository,
} from "../../src/modules/auth/auth.repository.js";
import type {
  CreateOAuthAccountData,
  CreatePasswordResetOtpData,
  CreatePasswordResetVerificationTokenData,
  CreateRefreshTokenData,
  CreateUserData,
  UpdateUserData,
} from "../../src/modules/auth/auth.types.js";

export class InMemoryAuthRepository implements IAuthRepository {
  users: User[] = [];
  otps: EmailVerificationOtp[] = [];
  refreshTokens: RefreshToken[] = [];
  passwordResetOtps: PasswordResetOtp[] = [];
  passwordResetVerificationTokens: PasswordResetVerificationToken[] = [];
  oauthAccounts: OAuthAccount[] = [];

  async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return fn({} as Prisma.TransactionClient);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async findUserById(userId: string): Promise<User | null> {
    return this.users.find((user) => user.id === userId) ?? null;
  }

  async findAuthenticatedUserById(
    userId: string,
  ): Promise<AuthenticatedUserRecord | null> {
    const user = await this.findUserById(userId);
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phoneCountryCode: user.phoneCountryCode,
      phoneNumber: user.phoneNumber,
      emailVerified: user.emailVerified,
      status: user.status,
      role: user.role,
    };
  }

  async createUser(data: CreateUserData): Promise<User> {
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      name: data.name,
      email: data.email,
      phoneCountryCode: data.phoneCountryCode ?? null,
      phoneNumber: data.phoneNumber ?? null,
      passwordHash: data.passwordHash ?? null,
      emailVerified: data.emailVerified ?? false,
      status: "ACTIVE" as UserStatus,
      role: "CUSTOMER" as UserRole,
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(user);
    return user;
  }

  async updateUser(userId: string, data: UpdateUserData): Promise<User> {
    const user = this.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error("User not found");
    }
    Object.assign(user, data, { updatedAt: new Date() });
    return user;
  }

  async findLatestVerificationOtp(
    userId: string,
  ): Promise<EmailVerificationOtp | null> {
    return (
      this.otps
        .filter((otp) => otp.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
      null
    );
  }

  async findLatestActiveVerificationOtp(
    userId: string,
  ): Promise<EmailVerificationOtp | null> {
    const now = Date.now();
    return (
      this.otps
        .filter(
          (otp) =>
            otp.userId === userId &&
            otp.usedAt === null &&
            otp.expiresAt.getTime() > now,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
      null
    );
  }

  async invalidateVerificationOtps(userId: string): Promise<void> {
    const now = new Date();
    for (const otp of this.otps) {
      if (otp.userId === userId && otp.usedAt === null) {
        otp.usedAt = now;
      }
    }
  }

  async createVerificationOtp(data: {
    userId: string;
    otpHash: string;
    expiresAt: Date;
  }): Promise<EmailVerificationOtp> {
    const otp: EmailVerificationOtp = {
      id: randomUUID(),
      userId: data.userId,
      otpHash: data.otpHash,
      expiresAt: data.expiresAt,
      attempts: 0,
      usedAt: null,
      createdAt: new Date(),
    };
    this.otps.push(otp);
    return otp;
  }

  async markVerificationOtpUsed(otpId: string): Promise<EmailVerificationOtp> {
    const otp = this.otps.find((item) => item.id === otpId);
    if (!otp) {
      throw new Error("OTP not found");
    }
    otp.usedAt = new Date();
    return otp;
  }

  async incrementVerificationOtpAttempts(
    otpId: string,
  ): Promise<EmailVerificationOtp> {
    const otp = this.otps.find((item) => item.id === otpId);
    if (!otp) {
      throw new Error("OTP not found");
    }
    otp.attempts += 1;
    return otp;
  }

  async createRefreshToken(data: CreateRefreshTokenData): Promise<RefreshToken> {
    const token: RefreshToken = {
      id: randomUUID(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.refreshTokens.push(token);
    return token;
  }

  async findRefreshTokenByHash(
    tokenHash: string,
  ): Promise<RefreshToken | null> {
    return (
      this.refreshTokens.find((token) => token.tokenHash === tokenHash) ?? null
    );
  }

  async revokeRefreshToken(tokenId: string): Promise<RefreshToken> {
    const token = this.refreshTokens.find((item) => item.id === tokenId);
    if (!token) {
      throw new Error("Refresh token not found");
    }
    token.revokedAt = new Date();
    return token;
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    const now = new Date();
    for (const token of this.refreshTokens) {
      if (token.userId === userId && token.revokedAt === null) {
        token.revokedAt = now;
      }
    }
  }

  async findLatestPasswordResetOtp(
    userId: string,
  ): Promise<PasswordResetOtp | null> {
    return (
      this.passwordResetOtps
        .filter((otp) => otp.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async findLatestActivePasswordResetOtp(
    userId: string,
  ): Promise<PasswordResetOtp | null> {
    const now = Date.now();
    return (
      this.passwordResetOtps
        .filter(
          (otp) =>
            otp.userId === userId &&
            otp.consumedAt === null &&
            otp.expiresAt.getTime() > now,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async invalidatePasswordResetOtps(userId: string): Promise<void> {
    const now = new Date();
    for (const otp of this.passwordResetOtps) {
      if (otp.userId === userId && otp.consumedAt === null) {
        otp.consumedAt = now;
      }
    }
  }

  async createPasswordResetOtp(
    data: CreatePasswordResetOtpData,
  ): Promise<PasswordResetOtp> {
    const otp: PasswordResetOtp = {
      id: randomUUID(),
      userId: data.userId,
      codeHash: data.codeHash,
      expiresAt: data.expiresAt,
      attempts: 0,
      maxAttempts: data.maxAttempts,
      consumedAt: null,
      createdAt: new Date(),
    };
    this.passwordResetOtps.push(otp);
    return otp;
  }

  async incrementPasswordResetOtpAttempts(
    otpId: string,
    maxAttempts: number,
  ): Promise<PasswordResetOtp | null> {
    const otp = this.passwordResetOtps.find((item) => item.id === otpId);
    if (!otp || otp.consumedAt !== null || otp.attempts >= maxAttempts) {
      return null;
    }
    otp.attempts += 1;
    return otp;
  }

  async consumePasswordResetOtp(
    otpId: string,
  ): Promise<PasswordResetOtp | null> {
    const otp = this.passwordResetOtps.find((item) => item.id === otpId);
    if (!otp || otp.consumedAt !== null) {
      return null;
    }
    otp.consumedAt = new Date();
    return otp;
  }

  async invalidatePasswordResetVerificationTokens(
    userId: string,
  ): Promise<void> {
    const now = new Date();
    for (const token of this.passwordResetVerificationTokens) {
      if (token.userId === userId && token.usedAt === null) {
        token.usedAt = now;
      }
    }
  }

  async createPasswordResetVerificationToken(
    data: CreatePasswordResetVerificationTokenData,
  ): Promise<PasswordResetVerificationToken> {
    const token: PasswordResetVerificationToken = {
      id: randomUUID(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      usedAt: null,
      createdAt: new Date(),
    };
    this.passwordResetVerificationTokens.push(token);
    return token;
  }

  async findPasswordResetVerificationTokenByHash(
    tokenHash: string,
  ): Promise<PasswordResetVerificationToken | null> {
    return (
      this.passwordResetVerificationTokens.find(
        (token) => token.tokenHash === tokenHash,
      ) ?? null
    );
  }

  async markPasswordResetVerificationTokenUsed(
    tokenId: string,
  ): Promise<PasswordResetVerificationToken | null> {
    const token = this.passwordResetVerificationTokens.find(
      (item) => item.id === tokenId,
    );
    if (!token || token.usedAt !== null) {
      return null;
    }
    token.usedAt = new Date();
    return token;
  }

  async updateUserPassword(
    userId: string,
    passwordHash: string,
  ): Promise<User> {
    return this.updateUser(userId, { passwordHash });
  }

  async findOAuthAccount(
    provider: OAuthProvider,
    providerAccountId: string,
  ): Promise<(OAuthAccount & { user: User }) | null> {
    const account = this.oauthAccounts.find(
      (item) =>
        item.provider === provider &&
        item.providerAccountId === providerAccountId,
    );
    if (!account) {
      return null;
    }
    const user = this.users.find((item) => item.id === account.userId);
    if (!user) {
      return null;
    }
    return { ...account, user };
  }

  async createOAuthAccount(
    data: CreateOAuthAccountData,
  ): Promise<OAuthAccount> {
    const exists = this.oauthAccounts.find(
      (item) =>
        item.provider === data.provider &&
        item.providerAccountId === data.providerAccountId,
    );
    if (exists) {
      const error = new Error("Unique constraint failed") as Error & {
        code: string;
      };
      Object.assign(error, { code: "P2002" });
      throw error;
    }

    const now = new Date();
    const account: OAuthAccount = {
      id: randomUUID(),
      userId: data.userId,
      provider: data.provider,
      providerAccountId: data.providerAccountId,
      createdAt: now,
      updatedAt: now,
    };
    this.oauthAccounts.push(account);
    return account;
  }

  async createUserWithOAuthAccount(input: {
    user: CreateUserData;
    oauth: Omit<CreateOAuthAccountData, "userId">;
  }): Promise<{ user: User; oauthAccount: OAuthAccount }> {
    const user = await this.createUser(input.user);
    const oauthAccount = await this.createOAuthAccount({
      userId: user.id,
      provider: input.oauth.provider,
      providerAccountId: input.oauth.providerAccountId,
    });
    return { user, oauthAccount };
  }
}
