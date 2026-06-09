/**
 * Mock for @reui/core NUI hooks.
 *
 * These mocks allow FiveM-specific component stories to render
 * without a real FiveM game client. Replace with real hooks
 * when running inside the FiveM CEF environment.
 */

export function mockNuiEvent(
  eventName: string,
  handler: (data: unknown) => void,
): () => void {
  // In Storybook, do NOT register a real game listener.
  // Stories that depend on NUI events should call the handler
  // manually via a "Trigger Event" button or the play function.
  console.log(`[mockNuiEvent] registered: ${eventName}`);
  return () => {
    console.log(`[mockNuiEvent] unregistered: ${eventName}`);
  };
}

export function mockNuiState<T>(_eventName: string, initialValue: T): T {
  // Return the initial value directly — stories can override via args.
  return initialValue;
}
