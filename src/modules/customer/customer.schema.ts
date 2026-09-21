import { z } from "zod";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_LIST_PAGE,
  MAX_LIST_LIMIT,
  MAX_SEARCH_LENGTH,
} from "./customer.constants.js";

export const customerIdParamsSchema = z.object({
  id: z.string().uuid("Invalid customer id"),
});

export const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(DEFAULT_LIST_PAGE),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT),
  search: z.string().trim().max(MAX_SEARCH_LENGTH).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]).optional(),
  emailVerified: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

export const updateCustomerSchema = z
  .object({
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type CustomerIdParams = z.infer<typeof customerIdParamsSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type UpdateCustomerBody = z.infer<typeof updateCustomerSchema>;
