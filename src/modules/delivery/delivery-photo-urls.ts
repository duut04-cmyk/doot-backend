import { objectStorageService } from "../../infrastructure/object-storage/object-storage.service.js";
import type { DeliveryDetailDto } from "./delivery.types.js";
import type { DeliveryHistoryDetail } from "./delivery-history.types.js";

async function enrichPhotoList<T extends { objectKey: string }>(
  photos: T[],
): Promise<Array<T & { url: string | null }>> {
  return Promise.all(
    photos.map(async (photo) => ({
      ...photo,
      url: await objectStorageService.resolveObjectReadUrl(photo.objectKey),
    })),
  );
}

export async function enrichDeliveryDetailPhotoUrls(
  detail: DeliveryDetailDto,
): Promise<DeliveryDetailDto> {
  const photos = await enrichPhotoList(detail.package.photos);
  return {
    ...detail,
    package: {
      ...detail.package,
      photos,
    },
  };
}

export async function enrichHistoryDetailPhotoUrls(
  detail: DeliveryHistoryDetail,
): Promise<DeliveryHistoryDetail> {
  const photos = await enrichPhotoList(detail.package.photos);
  return {
    ...detail,
    package: {
      ...detail.package,
      photos,
    },
  };
}
