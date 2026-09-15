import type {
  EmailVerificationOtp,
  RefreshToken,
  User,
  UserRole,
  UserStatus,
} from "@prisma/client";
import type { ACCESS_TOKEN_TYPE } from "./auth.constants.js";

export type AuthUser = User;
export type AuthVerificationOtp = EmailVerificationOtp;
export type AuthRefreshToken = RefreshToken;
export type AuthUserStatus = UserStatus;
export type AuthUserRole = UserRole;

export type AccessTokenPayload = {
  sub: string;
  type: typeof ACCESS_TOKEN_TYPE;
};

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  status: UserStatus;
  role: UserRole;
};

export type PublicUserProfile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  role: UserRole;
};

export type SignupInput = {
  name: string;
  email: string;
  phone?: string;
  password: string;
};

export type VerifyOtpInput = {
  email: string;
  otp: string;
};

export type ResendOtpInput = {
  email: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RefreshSessionInput = {
  refreshToken: string;
};

export type LogoutInput = {
  refreshToken: string;
};

export type ForgotPasswordInput = {
  email: string;
};

export type ResetPasswordInput = {
  token: string;
  password: string;
  confirmPassword: string;
};

export type AuthMessageResult = {
  success: true;
  message: string;
};

export type AuthTokenPairData = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: PublicUserProfile;
};

export type LoginResult = {
  success: true;
  message: string;
  data: AuthTokenPairData;
};

export type RefreshResult = {
  success: true;
  message: string;
  data: Omit<AuthTokenPairData, "user">;
};

export type MeResult = {
  success: true;
  data: {
    user: AuthenticatedUser;
  };
};

export type CreateUserData = {
  name: string;
  email: string;
  phone?: string | null;
  passwordHash?: string | null;
  emailVerified?: boolean;
};

export type CreateOAuthAccountData = {
  userId: string;
  provider: "GOOGLE";
  providerAccountId: string;
};

export type GoogleLoginInput = {
  credential: string;
};

export type UpdateUserData = {
  name?: string;
  phone?: string | null;
  passwordHash?: string;
  emailVerified?: boolean;
  status?: UserStatus;
  role?: UserRole;
};

export type CreateRefreshTokenData = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type CreatePasswordResetTokenData = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export function toAuthenticatedUser(user: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  status: UserStatus;
  role: UserRole;
}): AuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    emailVerified: user.emailVerified,
    status: user.status,
    role: user.role,
  };
}

export function toPublicUserProfile(user: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  role: UserRole;
}): PublicUserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    emailVerified: user.emailVerified,
    role: user.role,
  };
}
