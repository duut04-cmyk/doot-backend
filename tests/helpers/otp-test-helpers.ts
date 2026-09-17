import type { User, UserRole, UserStatus } from "@prisma/client";
import type { InMemoryAuthRepository } from "./in-memory-auth-repository.js";

export function seedCustomerUser(
  authRepo: InMemoryAuthRepository,
  input: {
    id: string;
    email?: string;
    name?: string;
  },
): User {
  const now = new Date();
  const user: User = {
    id: input.id,
    name: input.name ?? "Test Customer",
    email: input.email ?? "customer@example.com",
    phoneCountryCode: "+91",
    phoneNumber: "9876543210",
    passwordHash: "hash",
    emailVerified: true,
    status: "ACTIVE" as UserStatus,
    role: "CUSTOMER" as UserRole,
    createdAt: now,
    updatedAt: now,
  };
  authRepo.users.push(user);
  return user;
}
