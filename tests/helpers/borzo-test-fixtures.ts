import type {
  BorzoCalculateOrderResponse,
  BorzoCancelOrderResponse,
  BorzoCourierResponse,
  BorzoCreateOrderResponse,
  BorzoOrdersListResponse,
} from "../../src/modules/provider/adapters/borzo/borzo.types.js";
import type { BookingRequest } from "../../src/modules/provider/contracts/booking.js";
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

export const sampleBookingRequest: BookingRequest = {
  ...sampleQuoteRequest,
  deliveryId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  deliveryReference: "DOTT-TEST-001",
  idempotencyKey: "dutt-test-booking-key-001",
};

export const borzoTestCourier = {
  courier_id: 9001,
  name: "Raj",
  surname: "Kumar",
  middlename: null,
  phone: "919876543210",
  photo_url: "https://example.test/courier/9001.jpg",
  latitude: "12.9716",
  longitude: "77.5946",
};

export const successfulBorzoCreateOrderResponse: BorzoCreateOrderResponse = {
  is_successful: true,
  order: {
    type: "standard",
    order_id: 1250100,
    order_name: "50100",
    vehicle_type_id: 8,
    created_datetime: "2026-09-15T08:00:00+05:30",
    status: "new",
    status_description: "new",
    matter: "Documents",
    total_weight_kg: 1.5,
    payment_amount: "170.00",
    delivery_fee_amount: "170.00",
    weight_fee_amount: "0.00",
    insurance_fee_amount: "0.00",
    loading_fee_amount: "0.00",
    points: [
      {
        address: "12 MG Road, Bengaluru",
        latitude: "12.9716",
        longitude: "77.5946",
        estimated_arrival_datetime: "2026-09-15T09:00:00+05:30",
        tracking_url: "https://example.test/track/1250100",
        client_order_id: "dutt-test-booking-key-001",
      },
      {
        address: "88 Indiranagar, Bengaluru",
        latitude: "12.9784",
        longitude: "77.6408",
        estimated_arrival_datetime: "2026-09-15T10:00:00+05:30",
      },
    ],
    courier: borzoTestCourier,
  },
  warnings: [],
};

export const failedBorzoCreateOrderResponse: BorzoCreateOrderResponse = {
  is_successful: false,
  errors: ["invalid_parameters"],
  parameter_errors: {
    points: [{ contact_person: { phone: ["required"] } }],
  },
};

export const successfulBorzoCourierResponse: BorzoCourierResponse = {
  is_successful: true,
  courier: borzoTestCourier,
};

export const successfulBorzoOrdersListResponse: BorzoOrdersListResponse = {
  is_successful: true,
  orders: successfulBorzoCreateOrderResponse.order
    ? [successfulBorzoCreateOrderResponse.order]
    : [],
  orders_count: 1,
};

export const successfulBorzoCancelOrderResponse: BorzoCancelOrderResponse = {
  is_successful: true,
  order: {
    order_id: 1250100,
    status: "canceled",
    status_description: "canceled",
    finish_datetime: "2026-09-15T08:30:00+05:30",
  },
};

export const rejectedBorzoCancelOrderResponse: BorzoCancelOrderResponse = {
  is_successful: false,
  errors: ["order_cannot_be_canceled"],
};
