import { z } from "zod";

export const shiprocketLoginResponseSchema = z
  .object({
    token: z.string().min(1).optional(),
    data: z
      .object({
        token: z.string().min(1).optional(),
      })
      .optional(),
  })
  .passthrough();

export type ShiprocketLoginResponse = z.infer<typeof shiprocketLoginResponseSchema>;

export const shiprocketHyperlocalRateEntrySchema = z
  .object({
    courier_name: z.string().optional(),
    courier_company_id: z.union([z.number(), z.string()]).optional(),
    courier_id: z.union([z.number(), z.string()]).optional(),
    rate_id: z.union([z.number(), z.string()]).optional(),
    id: z.union([z.number(), z.string()]).optional(),
    rates: z.union([z.number(), z.string()]).optional(),
    rate: z.union([z.number(), z.string()]).optional(),
    etd: z.union([z.string(), z.number()]).optional(),
    eta: z.union([z.string(), z.number()]).optional(),
    estimated_delivery_days: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const shiprocketHyperlocalServiceabilityResponseSchema = z
  .object({
    status: z.union([z.boolean(), z.number(), z.string()]).optional(),
    message: z.string().optional(),
    data: z.array(shiprocketHyperlocalRateEntrySchema).optional(),
  })
  .passthrough();

export type ShiprocketHyperlocalRateEntry = z.infer<
  typeof shiprocketHyperlocalRateEntrySchema
>;

export type ParsedHyperlocalRateCandidate = {
  courierName: string | null;
  amountInr: number;
  providerQuoteId: string;
  estimatedDeliveryMinutes: number | null;
  raw: ShiprocketHyperlocalRateEntry;
};

export const shiprocketCreateAdhocOrderResponseSchema = z
  .object({
    order_id: z.union([z.number(), z.string()]).optional(),
    shipment_id: z.union([z.number(), z.string()]).optional(),
    status: z.string().optional(),
    status_code: z.union([z.number(), z.string()]).optional(),
    awb_code: z.union([z.string(), z.null()]).optional(),
    courier_company_id: z.union([z.number(), z.string(), z.null()]).optional(),
    courier_name: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

export const shiprocketAssignAwbResponseSchema = z
  .object({
    success: z.union([z.boolean(), z.string()]).optional(),
    message: z.string().optional(),
  })
  .passthrough();

export const shiprocketOrderShowResponseSchema = z
  .object({
    data: z
      .object({
        id: z.union([z.number(), z.string()]).optional(),
        status: z.string().optional(),
        status_code: z.union([z.number(), z.string()]).optional(),
        awb_code: z.union([z.string(), z.null()]).optional(),
        shipments: z.array(z.record(z.string(), z.unknown())).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const shiprocketTrackingResponseSchema = z
  .object({
    tracking_data: z.record(z.string(), z.unknown()).optional(),
    shipment_status: z.union([z.string(), z.number()]).optional(),
    shipment_track: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();
