import type {
  DeliveryStatus,
  HandlingRequirement,
  PackageSizeTier,
  PackageType,
  ScheduleMode,
} from "@prisma/client";
import { DIMENSIONS_REQUIRED_ABOVE_KG } from "./delivery.constants.js";

export type DeliveryLocationInput = {
  addressText: string;
  contactName: string;
  contactPhone: string;
  instructions?: string | null;
};

export type DeliveryPackagePhotoInput = {
  objectKey: string;
  storageProvider?: string;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
};

export type DeliveryPackageInput = {
  packageType: PackageType;
  description?: string | null;
  weightKg: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  sizeTier?: PackageSizeTier | null;
  quantity?: number;
  photos?: DeliveryPackagePhotoInput[];
};

export type DeliveryScheduleInput = {
  mode: ScheduleMode;
  timezone: string;
  windowStart?: string | null;
  windowEnd?: string | null;
};

export type CreateDeliveryInput = {
  pickup: DeliveryLocationInput;
  drop: DeliveryLocationInput;
  package: DeliveryPackageInput;
  requirements?: Array<HandlingRequirement | "NONE">;
  specialInstructions?: string | null;
  schedule: DeliveryScheduleInput;
  compliance: { accepted: boolean };
};

export type DeliveryLocationDto = {
  addressText: string;
  contactName: string;
  contactPhone: string;
  instructions: string | null;
};

export type DeliveryPackagePhotoDto = {
  objectKey: string;
  storageProvider: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
};

export type DeliveryPackageDto = {
  packageType: PackageType;
  description: string | null;
  weightKg: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  sizeTier: PackageSizeTier;
  quantity: number;
  photos: DeliveryPackagePhotoDto[];
};

export type DeliveryScheduleDto = {
  mode: ScheduleMode;
  timezone: string;
  scheduledAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
};

export type DeliveryComplianceDto = {
  accepted: boolean;
  acceptedAt: string;
};

export type DeliveryDetailDto = {
  id: string;
  reference: string;
  status: DeliveryStatus;
  pickup: DeliveryLocationDto;
  drop: DeliveryLocationDto;
  package: DeliveryPackageDto;
  requirements: HandlingRequirement[];
  specialInstructions: string | null;
  schedule: DeliveryScheduleDto;
  compliance: DeliveryComplianceDto;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryListItemDto = {
  id: string;
  reference: string;
  status: DeliveryStatus;
  pickup: { addressText: string; contactName: string };
  drop: { addressText: string; contactName: string };
  packageType: PackageType;
  weightKg: number;
  sizeTier: PackageSizeTier;
  schedule: {
    mode: ScheduleMode;
    scheduledAt: string | null;
    timezone: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type PaginatedDeliveriesDto = {
  items: DeliveryListItemDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type CreateDeliveryResult = {
  success: true;
  data: DeliveryDetailDto;
};

export type ListDeliveriesResult = {
  success: true;
  data: PaginatedDeliveriesDto;
};

export type GetDeliveryResult = {
  success: true;
  data: DeliveryDetailDto;
};

export type NormalizedCreateDelivery = {
  pickup: {
    addressText: string;
    contactName: string;
    contactPhone: string;
    instructions: string | null;
  };
  drop: {
    addressText: string;
    contactName: string;
    contactPhone: string;
    instructions: string | null;
  };
  package: {
    packageType: PackageType;
    description: string | null;
    weightKg: number;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
    sizeTier: PackageSizeTier;
    quantity: number;
    photos: Array<{
      objectKey: string;
      storageProvider: string;
      mimeType: string | null;
      fileSizeBytes: number | null;
    }>;
  };
  requirements: HandlingRequirement[];
  specialInstructions: string | null;
  schedule: {
    mode: ScheduleMode;
    timezone: string;
    scheduledAt: Date | null;
    windowStart: Date | null;
    windowEnd: Date | null;
  };
  complianceAcceptedAt: Date;
};

export function deriveSizeTier(weightKg: number): PackageSizeTier {
  if (weightKg <= 1) return "SMALL";
  if (weightKg <= DIMENSIONS_REQUIRED_ABOVE_KG) return "MEDIUM";
  return "LARGE";
}

export function decimalToNumber(value: { toString(): string } | number): number {
  if (typeof value === "number") return value;
  return Number(value.toString());
}
