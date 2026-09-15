export type BorzoContactPerson = {
  phone?: string | null;
  name?: string | null;
};

export type BorzoPoint = {
  address: string;
  contact_person?: BorzoContactPerson;
  note?: string | null;
  required_start_datetime?: string;
  required_finish_datetime?: string;
};

export type BorzoCalculateOrderRequest = {
  type?: string;
  matter: string;
  vehicle_type_id?: number;
  total_weight_kg?: number;
  points: BorzoPoint[];
};

export type BorzoCalculateOrderPoint = {
  address?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  estimated_arrival_datetime?: string | null;
  contact_person?: BorzoContactPerson | null;
};

export type BorzoCalculateOrderOrder = {
  type?: string | null;
  order_id?: number | null;
  vehicle_type_id?: number | null;
  matter?: string | null;
  total_weight_kg?: number | null;
  payment_amount?: string | null;
  delivery_fee_amount?: string | null;
  weight_fee_amount?: string | null;
  insurance_amount?: string | null;
  insurance_fee_amount?: string | null;
  loading_fee_amount?: string | null;
  money_transfer_fee_amount?: string | null;
  promo_code_discount_amount?: string | null;
  backpayment_amount?: string | null;
  cod_fee_amount?: string | null;
  return_fee_amount?: string | null;
  waiting_fee_amount?: string | null;
  points?: BorzoCalculateOrderPoint[] | null;
};

export type BorzoCalculateOrderResponse = {
  is_successful: boolean;
  order?: BorzoCalculateOrderOrder | null;
  warnings?: string[] | null;
  parameter_warnings?: unknown;
  errors?: string[] | null;
  parameter_errors?: unknown;
};

export type BorzoHealthResponse = {
  is_successful: boolean;
};

export type BorzoProviderMetadata = {
  borzoOrderId: string | null;
  borzoOrderType: string | null;
  borzoVehicleTypeId: number | null;
  feeBreakdown: Record<string, string | null>;
};
