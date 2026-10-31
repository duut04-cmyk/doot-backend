import type { IProviderRepository } from "../../../provider/provider.repository.js";
import { SHIPROCKET_PROVIDER_CODE } from "./shiprocket.constants.js";
import { ShiprocketLiveLifecycleExecuteError } from "./shiprocket-live-lifecycle.errors.js";

export async function assertShiprocketLiveProviderIdentity(input: {
  providerRepo: IProviderRepository;
  resolvedProviderId: string;
  selectedOptionProviderId: string;
}): Promise<void> {
  const shiprocketRows = (await input.providerRepo.listProviders()).filter(
    (row) => row.code === SHIPROCKET_PROVIDER_CODE,
  );

  if (shiprocketRows.length === 0) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "No SHIPROCKET provider row exists.",
      "validate_provider",
      "PROVIDER_NOT_FOUND",
    );
  }

  if (shiprocketRows.length > 1) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Multiple SHIPROCKET provider rows exist; live lifecycle cannot choose safely.",
      "validate_provider",
      "PROVIDER_AMBIGUOUS",
    );
  }

  const canonicalId = shiprocketRows[0]!.id;
  const resolvedId = input.resolvedProviderId.trim();
  const selectedId = input.selectedOptionProviderId.trim();

  if (resolvedId !== canonicalId) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Resolved SHIPROCKET provider id does not match the canonical provider row.",
      "validate_provider",
      "PROVIDER_IDENTITY_MISMATCH",
    );
  }

  if (selectedId !== canonicalId) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Selected orchestration provider id does not match the resolved LIVE SHIPROCKET provider.",
      "validate_provider",
      "PROVIDER_IDENTITY_MISMATCH",
    );
  }
}
