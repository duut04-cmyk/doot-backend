# Operational SMS providers (pickup / delivery OTP)

Pickup and drop-off OTPs are sent only via SMS through `SmsService`. Doot generates and verifies OTPs; providers only deliver message bodies.

## Provider selection

Set **`SMS_PROVIDER`**:

| Value    | Use                                                                           |
| -------- | ----------------------------------------------------------------------------- |
| `mock`   | SMS disabled for operational OTP (default safe local)                         |
| `msg91`  | MSG91 Flow API (requires `MSG91_ENABLED=true` and template IDs)               |
| `twilio` | Twilio Programmable SMS (requires Twilio env vars; set `MSG91_ENABLED=false`) |

Only one provider is active. The factory does not load MSG91 and Twilio together.

## Twilio local testing

```env
SMS_PROVIDER=twilio
MSG91_ENABLED=false
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
```

Use pickup/drop **contact** phone numbers on the delivery (not the customer account phone).

For Twilio trial testing with one verified handset, set (development only):

```env
SMS_OTP_RECIPIENT_OVERRIDE=918699486836
```

Pickup and drop OTP SMS will both be sent to that number instead of the delivery contact phones. This is ignored in production.

**Trial accounts:** Twilio may only send to verified numbers and may block arbitrary custom bodies. Confirm your account and route support custom OTP text before relying on pickup/delivery SMS in production.

**Acceptance vs delivery:** A successful Twilio API response (message SID) means Twilio accepted the send request, not that the handset received the SMS.

## MSG91 (India / DLT)

When `SMS_PROVIDER=msg91` and `MSG91_ENABLED=true`, configure auth key, sender ID, and pickup/delivery template IDs as in `.env.example`.

## Dev test route

`POST /api/v1/test/sms` uses `Msg91Service` for template smoke tests. It is **disabled by default** in non-production. Enable locally with `ENABLE_TEST_SMS_ENDPOINT=true` in `.env` (never available in production). Operational pickup/delivery OTP uses `SmsService` only.
