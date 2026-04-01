'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MapPin, LinkIcon, Calendar } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

interface UserProfileBannerProps {
  accountname: string;
  displayName?: string;
  about?: string;
  location?: string;
  website?: string;
  createdDate?: string;
  coverImage?: string;
  profileImage?: string;
  socialUrl?: string;
  isMyAccount: boolean;
}

export function UserProfileBanner({
  accountname,
  displayName,
  about,
  location,
  website,
  createdDate,
  coverImage,
  profileImage,
}: UserProfileBannerProps) {
  const t = useTranslations('wallet');
  const format = useFormatter();

  const websiteLabel = website
    ? website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
    : null;

  const defaultAvatarUrl = `https://steemitimages.com/u/${accountname}/avatar`;
  const avatarSrc = profileImage || defaultAvatarUrl;

  const joinDateLabel =
    createdDate &&
    format.dateTime(new Date(createdDate), {
      year: 'numeric',
      month: 'long',
    });

  return (
    <div className="UserProfile__banner" style={coverImage ? {
      backgroundImage: `url(${coverImage})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    } : undefined}>
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="flex items-center justify-center gap-3 m-0">
          <Avatar size="lg">
            <AvatarImage src={avatarSrc} alt={accountname} />
            <AvatarFallback className="bg-primary text-primary-foreground font-bold">
              {accountname.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="UserProfile__account-name">{displayName || accountname}</span>
        </h1>

        <div>
          {about && (
            <p className="UserProfile__bio">{about}</p>
          )}
          <p className="UserProfile__info">
            {location && (
              <span>
                <MapPin className="size-3.5" /> {location}
              </span>
            )}
            {website && (
              <span>
                <LinkIcon className="size-3.5" />{' '}
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {websiteLabel}
                </a>
              </span>
            )}
            {createdDate && joinDateLabel && (
              <span>
                <Calendar className="size-3.5" /> {t('profileJoined')} {joinDateLabel}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

