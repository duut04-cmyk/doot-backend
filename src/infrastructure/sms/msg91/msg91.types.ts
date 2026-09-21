export type Msg91FlowRequest = {
  flow_id: string;
  sender: string;
  recipients: Array<
    {
      mobiles: string;
    } & Record<string, string>
  >;
};

export type Msg91FlowResponse = {
  message?: string;
  type?: string;
  request_id?: string;
  requestId?: string;
};
