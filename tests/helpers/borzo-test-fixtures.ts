import type { BorzoCalculateOrderResponse } from "../../src/modules/provider/adapters/borzo/borzo.types.js";
import type { QuoteRequest } from "../../src/modules/provider/contracts/quote.js";

export const sampleQuoteRequest: QuoteRequest = {
  pickup: {
    addressText: "12 MG Road, Bengaluru",
    contactName: "Riya",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9876543210",
    instructions: "Gate 2",
  },
  drop: {
    addressText: "88 Indiranagar, Bengaluru",
    contactName: "Aman",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9811122233",
  },
  package: {
    packageType: "DOCUMENT",
    weightKg: 1.5,
    quantity: 1,
  },
  schedule: {
    mode: "ASAP",
    timezone: "Asia/Kolkata",
  },
  requirements: [],
};

export const successfulBorzoCalculateOrderResponse: BorzoCalculateOrderResponse =
  {
    is_successful: true,
    order: {
      type: "standard",
      order_id: 1250032,
      vehicle_type_id: 8,
      payment_amount: "170.00",
      delivery_fee_amount: "170.00",
      weight_fee_amount: "0.00",
      insurance_fee_amount: "0.00",
      loading_fee_amount: "0.00",
      money_transfer_fee_amount: "0.00",
      promo_code_discount_amount: "40.00",
      points: [
        {
          address: "12 MG Road, Bengaluru",
          latitude: "12.9716",
          longitude: "77.5946",
          estimated_arrival_datetime: "2026-09-14T13:27:09+05:30",
        },
        {
          address: "88 Indiranagar, Bengaluru",
          latitude: "12.9784",
          longitude: "77.6408",
          estimated_arrival_datetime: "2026-09-14T14:27:09+05:30",
        },
      ],
    },
    warnings: [],
  };

export const warningBorzoCalculateOrderResponse: BorzoCalculateOrderResponse = {
  is_successful: true,
  order: {
    type: "standard",
    order_id: 1250033,
    vehicle_type_id: 8,
    payment_amount: "170.00",
    delivery_fee_amount: "170.00",
    weight_fee_amount: "0.00",
    points: [],
  },
  warnings: ["invalid_parameters"],
  parameter_warnings: {
    points: [{ contact_person: { phone: ["required"] } }],
  },
};

export const failedBorzoCalculateOrderResponse: BorzoCalculateOrderResponse = {
  is_successful: false,
  errors: ["invalid_parameters"],
  parameter_errors: {
    matter: ["required"],
  },
};
