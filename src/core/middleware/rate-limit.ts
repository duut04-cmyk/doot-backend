import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";

function isRateLimitEnabled(): boolean {
  if (env.NODE_ENV !== "test") {
    return true;
  }
  return process.env.ENABLE_RATE_LIMIT_TESTS === "true";
}

export type RateLimitWindow = {
  windowMs: number;
  max: number;
};

type StoreEntry = {
  count: number;
  resetAt: number;
};

class MemoryRateLimitStore {
  private readonly entries = new Map<string, StoreEntry>();

  consume(
    key: string,
    window: RateLimitWindow,
  ): {
    allowed: boolean;
    retryAfterSeconds: number;
  } {
    const now = Date.now();
    let entry = this.entries.get(key);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + window.windowMs };
      this.entries.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > window.max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(): void {
    this.entries.clear();
  }
}

const defaultStore = new MemoryRateLimitStore();

export function resetRateLimitStores(): void {
  defaultStore.reset();
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function rateLimitError(): AppError {
  return new AppError("Too many requests. Please try again later.", {
    statusCode: 429,
    code: ErrorCodes.RATE_LIMIT_EXCEEDED,
  });
}

export function createIpRateLimiter(
  scope: string,
  window: RateLimitWindow,
  store: MemoryRateLimitStore = defaultStore,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isRateLimitEnabled()) {
      next();
      return;
    }

    const key = `ip:${scope}:${getClientIp(req)}`;
    const result = store.consume(key, window);

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      next(rateLimitError());
      return;
    }

    next();
  };
}

export function createEmailBodyRateLimiter(
  scope: string,
  window: RateLimitWindow,
  store: MemoryRateLimitStore = defaultStore,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isRateLimitEnabled()) {
      next();
      return;
    }

    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : null;

    if (!email) {
      next();
      return;
    }

    const key = `email:${scope}:${hashKey(email)}`;
    const result = store.consume(key, window);

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      next(rateLimitError());
      return;
    }

    next();
  };
}

export function createBodyFieldRateLimiter(
  scope: string,
  field: string,
  window: RateLimitWindow,
  store: MemoryRateLimitStore = defaultStore,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isRateLimitEnabled()) {
      next();
      return;
    }

    const value = typeof req.body?.[field] === "string" ? req.body[field].trim() : null;

    if (!value) {
      next();
      return;
    }

    const key = `${field}:${scope}:${hashKey(value)}`;
    const result = store.consume(key, window);

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      next(rateLimitError());
      return;
    }

    next();
  };
}

export function createAuthenticatedDeliveryOtpRateLimiter(
  scope: "pickup-generate" | "delivery-generate" | "pickup-verify" | "delivery-verify",
  window: RateLimitWindow,
  store: MemoryRateLimitStore = defaultStore,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isRateLimitEnabled()) {
      next();
      return;
    }

    const userId = req.user?.id;
    const deliveryId = typeof req.params?.id === "string" ? req.params.id : null;

    if (!userId || !deliveryId) {
      next();
      return;
    }

    const key = `otp:${scope}:${userId}:${deliveryId}`;
    const result = store.consume(key, window);

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      next(rateLimitError());
      return;
    }

    next();
  };
}
