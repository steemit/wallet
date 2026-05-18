/** Usernames that must not be linked (legacy GDPR list). */
export const GDPR_USER_LIST = new Set([
  'mateja.klaric',
  'xondra',
  'tgylhn',
  'vichkovski',
  'wizzymt',
  'thedarkoverlord',
  'twoblokestrading',
  'ruttydm',
  'mihailm',
]);

export function isGdprUsername(username: string): boolean {
  return GDPR_USER_LIST.has(username);
}
