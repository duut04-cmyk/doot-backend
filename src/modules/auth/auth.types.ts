import type {
  EmailVerificationOtp,
  RefreshToken,
  User,
  UserRole,
  UserStatus,
} from "@prisma/client";
import type { PhoneResponse } from "../../core/phone/phone.types.js";
import { toPhoneResponse } from "../../core/phone/phone.js";
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
  phone: PhoneResponse | null;
  emailVerified: boolean;
  status: UserStatus;
  role: UserRole;
};

export type PublicUserProfile = {
  id: string;
  name: string;
  email: string;
  phone: PhoneResponse | null;
  emailVerified: boolean;
  role: UserRole;
};

export type SignupInput = {
  name: string;
  email: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
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

export type VerifyPasswordResetOtpInput = {
  email: string;
  otp: string;
};

export type ResendPasswordResetOtpInput = {
  email: string;
};

export type ResetPasswordInput = {
  resetToken: string;
  newPassword: string;
};

export type PasswordResetVerifyResult = {
  success: true;
  data: {
    resetToken: string;
    expiresAt: string;
  };
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
  phoneCountryCode?: string | null;
  phoneNumber?: string | null;
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
  phoneCountryCode?: string | null;
  phoneNumber?: string | null;
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

export type CreatePasswordResetOtpData = {
  userId: string;
  codeHash: string;
  expiresAt: Date;
  maxAttempts: number;
};

export type CreatePasswordResetVerificationTokenData = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

type UserPhoneFields = {
  phoneCountryCode: string | null;
  phoneNumber: string | null;
};

export function toAuthenticatedUser(user: {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: UserStatus;
  role: UserRole;
} & UserPhoneFields): AuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: toPhoneResponse(user.phoneCountryCode, user.phoneNumber),
    emailVerified: user.emailVerified,
    status: user.status,
    role: user.role,
  };
}

export function toPublicUserProfile(user: {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
} & UserPhoneFields): PublicUserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: toPhoneResponse(user.phoneCountryCode, user.phoneNumber),
    emailVerified: user.emailVerified,
    role: user.role,
  };
}
