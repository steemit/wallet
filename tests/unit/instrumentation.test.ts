import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('instrumentation register()', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_RUNTIME;
  });

  afterEach(() => {
    delete process.env.NEXT_RUNTIME;
    vi.restoreAllMocks();
  });

  it('skips setup outside the Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const registerTelemetry = vi.fn();
    vi.doMock('@/lib/telemetry/register', () => ({ registerTelemetry }));
    const { register } = await import('@/instrumentation');
    await register();
    expect(registerTelemetry).not.toHaveBeenCalled();
  });

  it('loads telemetry on the Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const registerTelemetry = vi.fn().mockResolvedValue(true);
    vi.doMock('@/lib/telemetry/register', () => ({ registerTelemetry }));
    const { register } = await import('@/instrumentation');
    await register();
    expect(registerTelemetry).toHaveBeenCalledOnce();
  });

  it('does not throw when the telemetry module fails to load', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    vi.doMock('@/lib/telemetry/register', () => {
      throw new Error('cannot load sdk');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
