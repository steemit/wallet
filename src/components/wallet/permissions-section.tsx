'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import { useSteemAccount } from '@/hooks/use-steem-account';
import { useAuthRoleKeys } from '@/hooks/use-auth-role-keys';
import {
  getPublicKeysForAuth,
  type AccountAuthType,
  type AuthRoleKeys,
} from '@/lib/wallet/account-keys';
import type { SteemAccount } from '@/lib/steem/types';
import { AccountKeyRow } from '@/components/wallet/account-key-row';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const KEY_TAB_IDS = ['posting', 'active', 'owner', 'memo', 'public'] as const;
type KeyTabId = (typeof KEY_TAB_IDS)[number];

const PRIVATE_TITLE_KEYS: Record<AccountAuthType, string> = {
  posting: 'postingPrivateTitle',
  active: 'activePrivateTitle',
  owner: 'ownerPrivateTitle',
  memo: 'memoPrivateTitle',
};

function PermissionsKeyPanel({
  authType,
  account,
  accountName,
  roleKeys,
  onAnyWifVisible,
}: {
  authType: AccountAuthType;
  account: SteemAccount;
  accountName: string;
  roleKeys: AuthRoleKeys;
  onAnyWifVisible: (visible: boolean) => void;
}) {
  const t = useTranslations('wallet.permissions');

  const pubkeys = useMemo(() => getPublicKeysForAuth(account, authType), [account, authType]);

  const permissionItems = t.raw(`${authType}PermissionItems`) as string[];

  const descKeys =
    authType === 'posting' || authType === 'active' ? (['desc1', 'desc2'] as const) : (['desc'] as const);

  return (
    <div className="key rounded-lg border border-border bg-card">
      <div className="flex flex-col lg:flex-row">
        <div className="flex-1 space-y-4 p-4 lg:p-6">
          {descKeys.map((dk) => (
            <p key={dk} className="text-muted-foreground text-sm leading-relaxed">
              {t(`${authType}.${dk}`)}
            </p>
          ))}
          {pubkeys.map((pubkey) => (
            <AccountKeyRow
              key={pubkey}
              pubkey={pubkey}
              authType={authType}
              accountName={accountName}
              roleKeys={roleKeys}
              privateTitleKey={PRIVATE_TITLE_KEYS[authType]}
              onWifVisibleChange={onAnyWifVisible}
            />
          ))}
        </div>
        <aside
          className={cn(
            'border-t border-border p-4 lg:w-[360px] lg:shrink-0 lg:border-t-0 lg:border-l',
            'bg-muted/20'
          )}
        >
          <h5 className="mb-3 text-base font-semibold">{t(`${authType}PermissionsTitle`)}</h5>
          <p className="text-muted-foreground mb-3 text-sm">{t(`${authType}PermissionsIntro`)}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {Array.isArray(permissionItems) &&
              permissionItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

export function PermissionsSection({
  username,
  isMyAccount,
}: {
  username: string;
  isMyAccount: boolean;
}) {
  const t = useTranslations('wallet.permissions');
  const { data: account, loading, error } = useSteemAccount(username);
  const roleKeys = useAuthRoleKeys();
  const [wifVisible, setWifVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<KeyTabId>('posting');

  const sessionMatchesAccount =
    isMyAccount && roleKeys.username?.toLowerCase() === username.toLowerCase();

  const effectiveRoleKeys: AuthRoleKeys = sessionMatchesAccount
    ? {
        ownerKey: roleKeys.ownerKey,
        activeKey: roleKeys.activeKey,
        postingKey: roleKeys.postingKey,
        memoKey: roleKeys.memoKey,
      }
    : { ownerKey: null, activeKey: null, postingKey: null, memoKey: null };

  const handleWifVisible = useCallback((visible: boolean) => {
    if (visible) setWifVisible(true);
  }, []);

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !account) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {error || t('loadError')}
      </p>
    );
  }

  if (!account.vesting_shares) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="UserKeys max-w-6xl print:block">
      {wifVisible && (
        <div className="no-print mb-4 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-2 size-4" />
            {t('print')}
          </Button>
        </div>
      )}

      <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:justify-between">
        <div className="max-w-3xl space-y-4">
          <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
          <p className="text-muted-foreground text-base leading-relaxed">{t('intro1')}</p>
          <p className="text-muted-foreground text-base leading-relaxed">{t('intro2')}</p>
          <div>
            <h5 className="mb-1 text-sm font-semibold">{t('learnMore')}</h5>
            <a
              href="https://steemit.com/steem/@steemitblog/steem-basics-understanding-private-keys-part-1"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-primary hover:underline"
            >
              {t('learnMoreLink')}
            </a>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as KeyTabId)} className="gap-4">
        <TabsList
          variant="line"
          className="no-print h-auto w-full flex-wrap justify-start gap-1 border border-border p-2"
        >
          {KEY_TAB_IDS.map((tabId) => (
            <TabsTrigger key={tabId} value={tabId} className="px-3 py-1.5">
              {t(`${tabId}Tab`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {(['posting', 'active', 'owner', 'memo'] as const).map((authType) => (
          <TabsContent key={authType} value={authType} className="mt-0">
            <PermissionsKeyPanel
              authType={authType}
              account={account}
              accountName={username}
              roleKeys={effectiveRoleKeys}
              onAnyWifVisible={handleWifVisible}
            />
          </TabsContent>
        ))}

        <TabsContent value="public" className="mt-0">
          <div className="rounded-lg border border-border bg-muted/30 p-6">
            <p className="text-muted-foreground mb-4 text-sm leading-relaxed">{t('public.desc1')}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t('public.desc2')}{' '}
              <a
                href={`https://steemdb.io/@${account.name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-primary hover:underline"
              >
                SteemDB
              </a>
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
