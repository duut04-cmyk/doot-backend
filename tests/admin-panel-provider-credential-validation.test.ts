import { describe, expect, it } from "vitest";
import {
  buildCredentialsPutBody,
  credentialFieldUsesPasswordInput,
  credentialFieldsBeingRotated,
  credentialFormValuesFromMetadata,
  emptyCredentialFormValues,
  PROVIDER_CREDENTIAL_FIELD_VALUES,
  sanitizeCredentialSaveError,
} from "../../admin-panel/src/providers/providerCredentialValidation.ts";
import {
  isProviderCredentialsMetadataOnly,
  providerDetailPayloadOmitsSecretKeys,
} from "../../admin-panel/src/providers/providerDetailContract.ts";

describe("admin-panel provider credential validation", () => {
  it("accepts the exact backend credential field names", () => {
    expect(PROVIDER_CREDENTIAL_FIELD_VALUES).toEqual([
      "API_KEY",
      "API_SECRET",
      "ACCESS_TOKEN",
      "CLIENT_ID",
      "CLIENT_SECRET",
      "USERNAME",
      "PASSWORD",
      "ACCOUNT_ID",
      "WEBHOOK_SECRET",
    ]);
  });

  it("builds partial PUT bodies with only non-empty fields", () => {
    const form = emptyCredentialFormValues();
    form.API_KEY = "  key-value  ";
    form.CLIENT_ID = "";

    const result = buildCredentialsPutBody(form);
    expect("body" in result).toBe(true);
    if ("body" in result) {
      expect(result.body).toEqual({ API_KEY: "key-value" });
      expect(result.body.API_SECRET).toBeUndefined();
    }
  });

  it("rejects submissions with no fields provided", () => {
    const result = buildCredentialsPutBody(emptyCredentialFormValues());
    expect("error" in result).toBe(true);
  });

  it("detects rotation for configured fields only", () => {
    const body = { API_KEY: "new-key", USERNAME: "user" };
    const metadata = {
      configured: true,
      fields: [
        { name: "API_KEY" as const, configured: true },
        { name: "USERNAME" as const, configured: false },
      ],
    };
    expect(credentialFieldsBeingRotated(body, metadata)).toEqual(["API_KEY"]);
  });

  it("uses password inputs for secret fields and text for identifiers", () => {
    expect(credentialFieldUsesPasswordInput("API_SECRET")).toBe(true);
    expect(credentialFieldUsesPasswordInput("CLIENT_ID")).toBe(false);
  });

  it("never initializes form values from server metadata", () => {
    const metadata = {
      configured: true,
      fields: PROVIDER_CREDENTIAL_FIELD_VALUES.map((name) => ({
        name,
        configured: true,
      })),
    };
    const values = credentialFormValuesFromMetadata(metadata);
    expect(Object.values(values).every((value) => value === "")).toBe(true);
  });

  it("sanitizes unsafe error messages that might echo secrets", () => {
    expect(
      sanitizeCredentialSaveError("At least one credential field is required"),
    ).toContain("At least one");
    expect(
      sanitizeCredentialSaveError("Unexpected failure with API_KEY=super-secret-value"),
    ).toBe("Failed to save credentials.");
  });

  it("treats credential PUT responses as metadata-only", () => {
    const putResponse = { success: true, data: { configured: true } };
    expect(isProviderCredentialsMetadataOnly(putResponse.data as never)).toBe(false);
    expect(providerDetailPayloadOmitsSecretKeys(putResponse)).toBe(true);
    expect(providerDetailPayloadOmitsSecretKeys({ API_KEY: "should-not-appear" })).toBe(
      false,
    );
  });
});
