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
  client_order_id?: string | null;
  delivery_id?: number | null;
  latitude?: string | null;
  longitude?: string | null;
  tracking_url?: string | null;
  estimated_arrival_datetime?: string | null;
};

export type BorzoCalculateOrderRequest = {
  type?: string;
  matter: string;
  vehicle_type_id?: number;
  total_weight_kg?: number;
  points: BorzoPoint[];
};

export type BorzoCreateOrderRequest = BorzoCalculateOrderRequest;

export type BorzoCancelOrderRequest = {
  order_id: number;
};

export type BorzoCourier = {
  courier_id?: number | null;
  surname?: string | null;
  name?: string | null;
  middlename?: string | null;
  phone?: string | null;
  photo_url?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
};

export type BorzoOrderPoint = {
  point_id?: number | null;
  delivery_id?: number | null;
  client_order_id?: string | null;
  address?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  required_start_datetime?: string | null;
  required_finish_datetime?: string | null;
  arrival_start_datetime?: string | null;
  arrival_finish_datetime?: string | null;
  estimated_arrival_datetime?: string | null;
  courier_visit_datetime?: string | null;
  contact_person?: BorzoContactPerson | null;
  taking_amount?: string | null;
  buyout_amount?: string | null;
  note?: string | null;
  tracking_url?: string | null;
  delivery?: { status?: string | null } | null;
};

export type BorzoOrderDetail = {
  type?: string | null;
  order_id?: number | null;
  order_name?: string | null;
  vehicle_type_id?: number | null;
  created_datetime?: string | null;
  finish_datetime?: string | null;
  status?: string | null;
  status_description?: string | null;
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
  waybill_document_url?: string | null;
  payment_method?: string | null;
  points?: BorzoOrderPoint[] | null;
  courier?: BorzoCourier | null;
};

export type BorzoCalculateOrderResponse = {
  is_successful: boolean;
  order?: BorzoOrderDetail | null;
  warnings?: string[] | null;
  parameter_warnings?: unknown;
  errors?: string[] | null;
  parameter_errors?: unknown;
};

export type BorzoCreateOrderResponse = BorzoCalculateOrderResponse;

export type BorzoCancelOrderResponse = {
  is_successful: boolean;
  order?: BorzoOrderDetail | null;
  errors?: string[] | null;
  parameter_errors?: unknown;
};

export type BorzoCourierResponse = {
  is_successful: boolean;
  courier?: BorzoCourier | null;
  errors?: string[] | null;
};

export type BorzoOrdersListResponse = {
  is_successful: boolean;
  orders?: BorzoOrderDetail[] | null;
  orders_count?: number | null;
  errors?: string[] | null;
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
