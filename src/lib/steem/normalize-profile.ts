/**
 * Parse and sanitize Steem/Hive account profile fields from chain metadata.
 * Mirrors wallet-legacy `NormalizeProfile.js` (posting_json_metadata + fallbacks).
 */

export interface NormalizedProfile {
  name: string | undefined;
  about: string | undefined;
  location: string | undefined;
  website: string | undefined;
  profile_image: string | undefined;
  cover_image: string | undefined;
}

function truncate(str: string, maxLen: number): string {
  const t = str.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}...`;
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseProfileBlock(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const md = JSON.parse(raw) as Record<string, unknown> | null;
    if (!md || typeof md !== 'object') return {};
    const profile = md.profile;
    if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
      return profile as Record<string, unknown>;
    }
  } catch {
    // Invalid JSON — same as legacy: skip
  }
  return {};
}

function normalizeWebsite(website: string | undefined): string | undefined {
  if (!website || website.length > 100) return undefined;
  let w = website.trim();
  if (!/^https?:\/\//i.test(w)) {
    w = `http://${w}`;
  }
  try {
    const u = new URL(w);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

function normalizeHttpsUrl(maybeUrl: string | undefined): string | undefined {
  if (!maybeUrl) return undefined;
  const u = maybeUrl.trim();
  return /^https?:\/\//.test(u) ? u : undefined;
}

type AccountWithMeta = {
  name?: string;
  posting_json_metadata?: string;
  json_metadata?: string;
};

/**
 * Normalize profile from `get_accounts` row(s).
 */
export function normalizeProfile(account: AccountWithMeta | null | undefined): NormalizedProfile {
  if (!account) {
    return {
      name: undefined,
      about: undefined,
      location: undefined,
      website: undefined,
      profile_image: undefined,
      cover_image: undefined,
    };
  }

  let profile = parseProfileBlock(account.posting_json_metadata);
  if (Object.keys(profile).length === 0 && account.json_metadata) {
    profile = parseProfileBlock(account.json_metadata);
  }

  let name = pickString(profile.name);
  let about = pickString(profile.about);
  let location = pickString(profile.location);
  const website = normalizeWebsite(pickString(profile.website));
  const profile_image = normalizeHttpsUrl(pickString(profile.profile_image));
  const cover_image = normalizeHttpsUrl(pickString(profile.cover_image));

  if (name) {
    name = truncate(name, 20);
    if (/^@/.test(name)) name = undefined;
  }
  if (about) about = truncate(about, 160);
  if (location) location = truncate(location, 30);

  return {
    name: name || undefined,
    about: about || undefined,
    location: location || undefined,
    website: website || undefined,
    profile_image: profile_image || undefined,
    cover_image: cover_image || undefined,
  };
}
