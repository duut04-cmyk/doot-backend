import type { ProviderCapability } from "@prisma/client";
import { DIMENSIONS_REQUIRED_ABOVE_KG } from "../delivery/delivery.constants.js";
import type { DeliveryDetailDto } from "../delivery/delivery.types.js";
import { decimalToNumber } from "../delivery/delivery.types.js";
import type { ProviderWithRelations } from "../provider/provider.repository.js";
import { isOrchestrationEligible } from "../provider/provider.readiness.js";
import {
  providerAdapterRegistry,
} from "../provider/adapters/provider-adapter-registry.js";
import {
  operationRequiresCapability,
} from "../provider/adapters/provider-adapter.capabilities.js";
import type { AdapterOperation } from "../provider/adapters/provider-adapter.types.js";
import {
  EXCLUSION_REASONS,
  SCHEDULED_SERVICE_TYPES,
} from "./orchestration.constants.js";
import type { ProviderEvaluationCompatibility } from "./orchestration.types.js";

const REQUIRED_OPERATIONS: AdapterOperation[] = ["getQuote"];

export function isProviderOrchestrationCandidate(
  provider: ProviderWithRelations,
): boolean {
  if (provider.status !== "ACTIVE") {
    return false;
  }

  if (
    !isOrchestrationEligible({
      enabled: provider.enabled,
      orchestrationEnabled: provider.orchestrationEnabled,
      integrationStatus: provider.integrationStatus,
      healthStatus: provider.healthStatus,
    })
  ) {
    return false;
  }

  if (!providerAdapterRegistry.has(provider.code)) {
    return false;
  }

  const configuredCapabilities = new Set(
    provider.capabilities.map((item) => item.capability),
  );

  for (const operation of REQUIRED_OPERATIONS) {
    if (!operationRequiresCapability(operation, configuredCapabilities)) {
      return false;
    }
  }

  const adapter = providerAdapterRegistry.resolve(provider.code);
  if (!adapter) {
    return false;
  }

  if (!adapter.supportsOperation("getQuote")) {
    return false;
  }

  const canEvaluate =
    adapter.supportsOperation("checkServiceability") ||
    typeof (adapter as { probeQuote?: unknown }).probeQuote === "function";

  return canEvaluate;
}

export function evaluatePreAdapterCompatibility(
  provider: ProviderWithRelations,
  delivery: DeliveryDetailDto,
): {
  compatible: ProviderEvaluationCompatibility;
  exclusionReasons: string[];
} {
  const exclusionReasons: string[] = [];
  const compatibility: ProviderEvaluationCompatibility = {
    weightCompatible: true,
    dimensionsCompatible: true,
    requirementsCompatible: true,
    scheduleCompatible: true,
  };

  const weightKg = delivery.package.weightKg;
  const limits = provider.packageLimits;

  if (limits?.maxWeightKg != null) {
    const maxWeight = decimalToNumber(limits.maxWeightKg);
    if (weightKg > maxWeight) {
      compatibility.weightCompatible = false;
      exclusionReasons.push(EXCLUSION_REASONS.WEIGHT_EXCEEDS_PROVIDER_LIMIT);
    }
  }

  if (limits?.minWeightKg != null) {
    const minWeight = decimalToNumber(limits.minWeightKg);
    if (weightKg < minWeight) {
      compatibility.weightCompatible = false;
      exclusionReasons.push(EXCLUSION_REASONS.WEIGHT_BELOW_PROVIDER_MINIMUM);
    }
  }

  if (compatibility.weightCompatible) {
    const vehicleLimits = provider.vehicles.filter((vehicle) => vehicle.enabled);
    if (vehicleLimits.length > 0) {
      const fitsAnyVehicle = vehicleLimits.some((vehicle) => {
        if (vehicle.maxWeightKg == null) return true;
        return weightKg <= decimalToNumber(vehicle.maxWeightKg);
      });
      if (!fitsAnyVehicle) {
        compatibility.weightCompatible = false;
        exclusionReasons.push(EXCLUSION_REASONS.WEIGHT_EXCEEDS_PROVIDER_LIMIT);
      }
    }
  }

  if (limits?.supportedPackageTypes?.length) {
    if (!limits.supportedPackageTypes.includes(delivery.package.packageType)) {
      compatibility.requirementsCompatible = false;
      exclusionReasons.push(EXCLUSION_REASONS.PACKAGE_TYPE_NOT_SUPPORTED);
    }
  }

  const dimensionsRequired = weightKg > DIMENSIONS_REQUIRED_ABOVE_KG;
  const hasDimensions =
    delivery.package.lengthCm != null &&
    delivery.package.widthCm != null &&
    delivery.package.heightCm != null;

  if (dimensionsRequired || hasDimensions) {
    if (hasDimensions && limits) {
      const { lengthCm, widthCm, heightCm } = delivery.package;
      if (
        (limits.maxLengthCm != null &&
          lengthCm != null &&
          lengthCm > decimalToNumber(limits.maxLengthCm)) ||
        (limits.maxWidthCm != null &&
          widthCm != null &&
          widthCm > decimalToNumber(limits.maxWidthCm)) ||
        (limits.maxHeightCm != null &&
          heightCm != null &&
          heightCm > decimalToNumber(limits.maxHeightCm))
      ) {
        compatibility.dimensionsCompatible = false;
        exclusionReasons.push(EXCLUSION_REASONS.DIMENSIONS_EXCEED_PROVIDER_LIMIT);
      }
    }
  }

  if (delivery.schedule.mode === "SCHEDULED") {
    const enabledServices = provider.services.filter((service) => service.enabled);
    const supportsScheduled = enabledServices.some((service) =>
      SCHEDULED_SERVICE_TYPES.has(service.serviceType),
    );
    if (!supportsScheduled && enabledServices.length > 0) {
      compatibility.scheduleCompatible = false;
      exclusionReasons.push(EXCLUSION_REASONS.SCHEDULE_NOT_SUPPORTED);
    }
  }

  return { compatible: compatibility, exclusionReasons };
}

export function resolvePrimaryService(
  provider: ProviderWithRelations,
): { serviceId: string | null; serviceCode: string | null } {
  const enabled = provider.services
    .filter((service) => service.enabled)
    .sort((a, b) => a.priority - b.priority);
  const primary = enabled[0];
  if (!primary) {
    return { serviceId: null, serviceCode: null };
  }
  return { serviceId: primary.id, serviceCode: primary.code };
}

export function providerHasCapability(
  provider: ProviderWithRelations,
  capability: ProviderCapability,
): boolean {
  return provider.capabilities.some((item) => item.capability === capability);
}
