export type IntegrationStatus =
  "connected" | "not_configured" | "degraded" | "coming_soon";

export type IntegrationCategoryId =
  "identity" | "communications" | "infrastructure" | "webhooks" | "security";

export type IntegrationItemDto = {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategoryId;
  status: IntegrationStatus;
  statusLabel: string;
  usedBy: string;
  impact: string;
  metadata: Record<string, string>;
  manageHref: string | null;
};

export type IntegrationCategoryDto = {
  id: IntegrationCategoryId;
  title: string;
  description: string;
  items: IntegrationItemDto[];
};

export type IntegrationSummaryDto = {
  connected: number;
  total: number;
  needsAttention: number;
};

export type IntegrationsStatusDto = {
  summary: IntegrationSummaryDto;
  categories: IntegrationCategoryDto[];
  checkedAt: string;
};
