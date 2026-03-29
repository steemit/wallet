'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MapPin, LinkIcon, Calendar, ChevronDown, ExternalLink } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

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

interface TopNavProps {
  accountname: string;
  socialUrl?: string;
  activeSection?: string;
}

export function TopNav({ accountname, socialUrl = 'https://steemit.com', activeSection }: TopNavProps) {
  const isRewardsActive = activeSection === 'curation-rewards' || activeSection === 'author-rewards';
  const isWalletActive = !isRewardsActive;

  return (
    <div className="UserProfile__top-nav">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center py-2">
          <ul className="flex flex-wrap items-center gap-1">
            <li>
              <a
                href={`${socialUrl}/@${accountname}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/80 hover:text-accent-foreground"
              >
                Blog <ExternalLink className="size-3" />
              </a>
            </li>
            <li>
              <a
                href={`/@${accountname}/transfers`}
                className={cn(
                  'inline-block rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isWalletActive
                    ? 'bg-accent font-semibold text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground'
                )}
              >
                Wallet
              </a>
            </li>
            <li>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isRewardsActive
                      ? 'bg-accent font-semibold text-accent-foreground data-[state=open]:bg-accent data-[state=open]:hover:bg-accent/90'
                      : 'text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground data-[state=open]:bg-accent/80 data-[state=open]:text-accent-foreground data-[state=open]:hover:bg-accent'
                  )}
                >
                  Rewards <ChevronDown className="size-3 opacity-70" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem asChild>
                    <a href={`/@${accountname}/curation-rewards`}>Curation Rewards</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`/@${accountname}/author-rewards`}>Author Rewards</a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
