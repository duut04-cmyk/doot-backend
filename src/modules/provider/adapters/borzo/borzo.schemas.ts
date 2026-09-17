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
    tracking_url: z.string().nullable().optional(),
    delivery_id: z.number().nullable().optional(),
    client_order_id: z.string().nullable().optional(),
  })
  .passthrough();

export const borzoCourierSchema = z
  .object({
    courier_id: z.number().nullable().optional(),
    surname: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    middlename: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    photo_url: z.string().nullable().optional(),
    latitude: z.union([z.string(), z.number()]).nullable().optional(),
    longitude: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const borzoOrderDetailObjectSchema = z
  .object({
    type: z.string().nullable().optional(),
    order_id: z.number().nullable().optional(),
    order_name: z.string().nullable().optional(),
    vehicle_type_id: z.number().nullable().optional(),
    created_datetime: z.string().nullable().optional(),
    finish_datetime: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    status_description: z.string().nullable().optional(),
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
    waybill_document_url: z.string().nullable().optional(),
    payment_method: z.string().nullable().optional(),
    points: z.array(borzoPointSchema).nullable().optional(),
    courier: borzoCourierSchema,
  })
  .passthrough();

export const borzoOrderDetailSchema = borzoOrderDetailObjectSchema
  .nullable()
  .optional();

export const borzoCalculateOrderResponseSchema = z
  .object({
    is_successful: z.boolean(),
    order: borzoOrderDetailSchema,
    warnings: z.array(z.string()).nullable().optional(),
    parameter_warnings: z.unknown().optional(),
    errors: z.array(z.string()).nullable().optional(),
    parameter_errors: z.unknown().optional(),
  })
  .passthrough();

export const borzoCreateOrderResponseSchema = borzoCalculateOrderResponseSchema;

export const borzoCancelOrderResponseSchema = z
  .object({
    is_successful: z.boolean(),
    order: borzoOrderDetailSchema,
    errors: z.array(z.string()).nullable().optional(),
    parameter_errors: z.unknown().optional(),
  })
  .passthrough();

export const borzoCourierResponseSchema = z
  .object({
    is_successful: z.boolean(),
    courier: borzoCourierSchema,
    errors: z.array(z.string()).nullable().optional(),
  })
  .passthrough();

export const borzoOrdersListResponseSchema = z
  .object({
    is_successful: z.boolean(),
    orders: z.array(borzoOrderDetailObjectSchema).nullable().optional(),
    orders_count: z.number().nullable().optional(),
    errors: z.array(z.string()).nullable().optional(),
  })
  .passthrough();

export const borzoHealthResponseSchema = z
  .object({
    is_successful: z.boolean(),
  })
  .passthrough();
