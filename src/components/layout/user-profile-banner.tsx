'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MapPin, LinkIcon, Calendar, ChevronDown, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserProfileBannerProps {
  accountname: string;
  displayName?: string;
  about?: string;
  location?: string;
  website?: string;
  createdDate?: string;
  coverImage?: string;
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
}: UserProfileBannerProps) {
  const websiteLabel = website
    ? website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
    : null;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
    });
  };

  return (
    <div className="UserProfile__banner" style={coverImage ? {
      backgroundImage: `url(${coverImage})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    } : undefined}>
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="flex items-center gap-3 text-2xl font-bold m-0">
          <Avatar size="lg">
            <AvatarImage
              src={`https://steemitimages.com/u/${accountname}/avatar`}
              alt={accountname}
            />
            <AvatarFallback className="bg-primary text-primary-foreground font-bold">
              {accountname.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {displayName || accountname}
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
                  className="text-primary hover:underline"
                >
                  {websiteLabel}
                </a>
              </span>
            )}
            {createdDate && (
              <span>
                <Calendar className="size-3.5" /> {formatDate(createdDate)}
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
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Blog <ExternalLink className="size-3" />
              </a>
            </li>
            <li>
              <a
                href={`/@${accountname}/transfers`}
                className={cn(
                  'inline-block px-3 py-2 text-sm font-medium transition-colors',
                  isWalletActive
                    ? 'font-bold text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Wallet
              </a>
            </li>
            <li>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    'inline-flex items-center gap-1 px-3 py-2 text-sm font-medium transition-colors',
                    isRewardsActive
                      ? 'font-bold text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
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
