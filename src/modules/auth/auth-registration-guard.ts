import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { isInternalTestCustomerEmail } from "../customer/customer-test-users.js";

/** App signup/OAuth must not register internal harness domains as customers. */
export function assertAppRegistrationEmail(email: string): void {
  if (isInternalTestCustomerEmail(email)) {
    throw new AppError(
      "This email domain is reserved for internal testing and cannot be used for registration.",
      {
        statusCode: 422,
        code: ErrorCodes.VALIDATION_ERROR,
      },
    );
  }
}
