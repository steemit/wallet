'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChangePasswordSection } from '@/components/wallet/change-password-section';
import { PermissionsSection } from '@/components/wallet/permissions-section';
import { CommunitiesSection } from '@/components/wallet/communities-section';

const SETTINGS_TABS = ['password', 'permissions', 'communities'] as const;
export type SettingsTabId = (typeof SETTINGS_TABS)[number];

function parseSettingsTab(raw: string | null): SettingsTabId {
  if (raw === 'permissions' || raw === 'communities') return raw;
  return 'password';
}

export interface AccountSettingsSectionProps {
  username: string;
  isMyAccount: boolean;
}

export function AccountSettingsSection({ username, isMyAccount }: AccountSettingsSectionProps) {
  const t = useTranslations('wallet.settingsPage');
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeTab = useMemo(
    () => parseSettingsTab(searchParams.get('tab')),
    [searchParams]
  );

  const settingsPath = `/@${username}/settings`;

  const handleTabChange = useCallback(
    (value: string) => {
      const tab = parseSettingsTab(value);
      router.replace(`${settingsPath}?tab=${tab}`);
    },
    [router, settingsPath]
  );

  return (
    <div className="AccountSettings max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-6">
        <TabsList
          variant="line"
          className="h-auto w-full flex-wrap justify-start gap-1 border border-border p-2"
        >
          <TabsTrigger value="password" className="px-3 py-1.5">
            {t('tabPassword')}
          </TabsTrigger>
          <TabsTrigger value="permissions" className="px-3 py-1.5">
            {t('tabPermissions')}
          </TabsTrigger>
          <TabsTrigger value="communities" className="px-3 py-1.5">
            {t('tabCommunities')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="password" className="mt-0">
          <ChangePasswordSection username={username} isMyAccount={isMyAccount} embedded />
        </TabsContent>
        <TabsContent value="permissions" className="mt-0">
          <PermissionsSection username={username} isMyAccount={isMyAccount} embedded />
        </TabsContent>
        <TabsContent value="communities" className="mt-0">
          <CommunitiesSection username={username} isMyAccount={isMyAccount} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
