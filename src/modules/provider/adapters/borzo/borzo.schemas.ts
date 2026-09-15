import { z } from "zod";

const borzoMoneySchema = z.union([z.string(), z.null()]).optional();

const borzoContactPersonSchema = z
  .object({
    phone: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const borzoPointSchema = z
  .object({
    address: z.string().nullable().optional(),
    latitude: z.string().nullable().optional(),
    longitude: z.string().nullable().optional(),
    estimated_arrival_datetime: z.string().nullable().optional(),
    contact_person: borzoContactPersonSchema,
  })
  .passthrough();

const borzoOrderSchema = z
  .object({
    type: z.string().nullable().optional(),
    order_id: z.number().nullable().optional(),
    vehicle_type_id: z.number().nullable().optional(),
    matter: z.string().nullable().optional(),
    total_weight_kg: z.number().nullable().optional(),
    payment_amount: borzoMoneySchema,
    delivery_fee_amount: borzoMoneySchema,
    weight_fee_amount: borzoMoneySchema,
    insurance_amount: borzoMoneySchema,
    insurance_fee_amount: borzoMoneySchema,
    loading_fee_amount: borzoMoneySchema,
    money_transfer_fee_amount: borzoMoneySchema,
    promo_code_discount_amount: borzoMoneySchema,
    backpayment_amount: borzoMoneySchema,
    cod_fee_amount: borzoMoneySchema,
    return_fee_amount: borzoMoneySchema,
    waiting_fee_amount: borzoMoneySchema,
    points: z.array(borzoPointSchema).nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

export const borzoCalculateOrderResponseSchema = z
  .object({
    is_successful: z.boolean(),
    order: borzoOrderSchema,
    warnings: z.array(z.string()).nullable().optional(),
    parameter_warnings: z.unknown().optional(),
    errors: z.array(z.string()).nullable().optional(),
    parameter_errors: z.unknown().optional(),
  })
  .passthrough();

export const borzoHealthResponseSchema = z
  .object({
    is_successful: z.boolean(),
  })
  .passthrough();
