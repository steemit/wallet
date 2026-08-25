/**
 * Next.js instrumentation hook (Node runtime only).
 *
 * Edge (`src/proxy.ts`) cannot load the Node OTel SDK. Tracing is initialized
 * here so HTTP + undici (fetch) are patched before API routes and SteemService
 * run. See src/lib/telemetry/.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { registerTelemetry } = await import('./lib/telemetry/register');
    await registerTelemetry();
  } catch (err) {
    console.error(
      '[telemetry] failed to load OpenTelemetry module; continuing without tracing:',
      err instanceof Error ? err.message : err
    );
  }
}
