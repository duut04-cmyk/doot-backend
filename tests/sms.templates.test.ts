import { describe, expect, it } from "vitest";
import {
  renderSmsTemplateMessage,
  SMS_TEMPLATES,
} from "../src/infrastructure/sms/templates/sms.templates.js";

describe("SMS templates", () => {
  it("defines account, pickup, and delivery templates", () => {
    expect(SMS_TEMPLATES.ACCOUNT_OTP.message).toContain("{{otp}}");
    expect(SMS_TEMPLATES.PICKUP_OTP.message).toContain("pickup OTP");
    expect(SMS_TEMPLATES.DELIVERY_OTP.message).toContain("delivery OTP");
  });

  it("renders template variables into the message text", () => {
    expect(renderSmsTemplateMessage("ACCOUNT_OTP", { otp: "123456" })).toBe(
      "Your DOOT verification OTP is 123456. It is valid for 10 minutes. Do not share this OTP with anyone.",
    );
  });
});
