export class ShiprocketLiveLifecycleExecuteError extends Error {
  constructor(
    message: string,
    readonly phase: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ShiprocketLiveLifecycleExecuteError";
  }
}
