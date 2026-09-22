/**
 * Unit tests for the forensic infrastructure-IP self-check, including the
 * IPv4-mapped IPv6 coverage (::ffff:a.b.c.d) added in fix/recovery-hardening.
 */
import { describe, it, expect } from 'vitest';
import { isInfrastructureIp } from '@/lib/middleware/infra-ip';

describe('isInfrastructureIp', () => {
  it.each([
    '10.1.2.3', // RFC1918 10/8
    '127.0.0.1', // loopback
    '192.168.1.1', // RFC1918 192.168/16
    '172.16.0.1', // RFC1918 172.16/12
    '172.31.255.254', // RFC1918 172.16/12 upper edge
    '169.254.169.254', // IPv4 link-local (EC2 instance metadata)
  ])('flags plain IPv4 infrastructure: %s', (ip) => {
    expect(isInfrastructureIp(ip)).toBe(true);
  });

  it.each([
    '::1', // IPv6 loopback
    'fd00::1', // IPv6 ULA
    'fc00::1', // IPv6 ULA (reserved)
    'fe80::1', // IPv6 link-local
  ])('flags plain IPv6 infrastructure: %s', (ip) => {
    expect(isInfrastructureIp(ip)).toBe(true);
  });

  it.each([
    '::ffff:10.0.0.1', // mapped RFC1918 (the drift shape the old regex missed)
    '::ffff:169.254.169.254', // mapped link-local / instance metadata
    '::FFFF:172.16.0.1', // mapped RFC1918, uppercase prefix
    '  ::ffff:127.0.0.1 ', // whitespace tolerance
  ])('flags IPv4-mapped infrastructure: %s', (ip) => {
    expect(isInfrastructureIp(ip)).toBe(true);
  });

  it.each([
    '::ffff:8.8.8.8', // mapped PUBLIC IPv4 — still a real client, not infra
    '8.8.8.8', // public IPv4
    '2600::1', // global IPv6
    '2001:db8::1', // documentation-range but globally scoped syntax
  ])('does not flag public addresses: %s', (ip) => {
    expect(isInfrastructureIp(ip)).toBe(false);
  });
});
