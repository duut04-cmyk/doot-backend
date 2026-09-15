import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const REQUEST_ID_HEADER = "x-request-id";

function isValidRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = isValidRequestId(incoming) ? incoming : randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}
