import "express";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    rawBody?: Buffer;
    user?: import("./modules/auth/auth.types.js").AuthenticatedUser;
  }
}

export {};
