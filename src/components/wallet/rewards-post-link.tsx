'use client';

import { isGdprUsername } from '@/lib/wallet/gdpr-user-list';

export function RewardsPostLink({
  socialUrl,
  author,
  permlink,
}: {
  socialUrl: string;
  author: string;
  permlink: string;
}) {
  const label = `${author}/${permlink}`;
  const base = socialUrl.replace(/\/$/, '');

  if (isGdprUsername(author)) {
    return <span>{label}</span>;
  }

  return (
    <a
      href={`${base}/@${author}/${permlink}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline-offset-4 hover:underline"
    >
      {label}
    </a>
  );
}
