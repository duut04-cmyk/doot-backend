import { driverService } from "../driver/driver.service.js";
import { trackingService } from "../tracking/tracking.service.js";
import { operationalRefreshService } from "./operational-refresh.service.js";

let configured = false;

/** Wire operational refresh handlers after module graph is loaded. */
export function configureOperationalRefresh(): void {
  if (configured) {
    return;
  }
  operationalRefreshService.configure({
    driver: driverService,
    tracking: trackingService,
  });
  configured = true;
}
