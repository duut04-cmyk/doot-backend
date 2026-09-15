import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level:
    env.NODE_ENV === "test"
      ? "silent"
      : env.NODE_ENV === "production"
        ? "info"
        : "debug",
  base: {
    service: "dutt-backend",
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
