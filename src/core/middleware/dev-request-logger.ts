import type { NextFunction, Request, Response } from "express";

/** Next.js-style request lines for local development terminals. */
export function devRequestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const path = req.originalUrl ?? req.url;
    console.log(
      `${req.method} ${path} ${res.statusCode} in ${durationMs.toFixed(0)}ms`,
    );
  });

  next();
}
