'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useActiveSigningKey } from '@/hooks/use-auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import {
  COMMUNITY_CREATE_FEE,
  COMMUNITY_DESCRIPTION_MAX_LENGTH,
  COMMUNITY_TITLE_MAX_LENGTH,
  DEFAULT_SOCIAL_URL,
  buildCommunitySetupOperations,
  buildCommunitySubscribeOperation,
  communityActiveWif,
  communityTitleStartsWithLetter,
  communityTrendingUrl,
  generateCommunityOwnerName,
  generateCommunityOwnerPassword,
  sleep,
} from '@/lib/wallet/community';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

export interface CommunitiesSectionProps {
  username: string;
  isMyAccount: boolean;
  socialUrl?: string;
}

type CreatePhase = 'form' | 'account_created' | 'success';

export function CommunitiesSection({
  username,
  isMyAccount,
  socialUrl = DEFAULT_SOCIAL_URL,
}: CommunitiesSectionProps) {
  const t = useTranslations('wallet.communitiesPage');
  const activeKey = useActiveSigningKey();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [phase, setPhase] = useState<CreatePhase>('form');
  const [pending, setPending] = useState(false);
  const [accountError, setAccountError] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [genericError, setGenericError] = useState(false);

  const hasCredentials = ownerPassword.length > 0;
  const titleError = useMemo(() => {
    if (!title && !hasCredentials) return null;
    return communityTitleStartsWithLetter(title) ? null : t('titleMustStartWithLetter');
  }, [title, hasCredentials, t]);

  const resetErrors = () => {
    setAccountError(false);
    setSettingsError(false);
    setGenericError(false);
  };

  const generateCredentials = () => {
    resetErrors();
    setOwnerName(generateCommunityOwnerName());
    setOwnerPassword(generateCommunityOwnerPassword());
    setSavedConfirmed(false);
  };

  const broadcastCommunitySetup = async (): Promise<boolean> => {
    if (!ownerName || !ownerPassword) return false;

    await sleep(3000);

    const setupOps = buildCommunitySetupOperations(
      username,
      ownerName,
      title.trim(),
      description.trim()
    );
    const communityActiveKey = communityActiveWif(ownerName, ownerPassword);
    const signedSetup = await SteemSigner.signOperations(setupOps, [communityActiveKey]);
    const setupResult = await apiClient.broadcastCustomJson(signedSetup, ownerName);
    if (!setupResult.success) {
      setSettingsError(true);
      return false;
    }

    if (!activeKey) {
      setGenericError(true);
      return false;
    }

    const subscribeOp = buildCommunitySubscribeOperation(username, ownerName);
    const signedSubscribe = await SteemSigner.signOperations([subscribeOp], [activeKey]);
    const subscribeResult = await apiClient.broadcastCustomJson(signedSubscribe, username);
    if (!subscribeResult.success) {
      setSettingsError(true);
      return false;
    }

    await sleep(6000);
    return true;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    resetErrors();

    if (!isMyAccount) return;
    if (titleError || !hasCredentials || !savedConfirmed) return;

    if (!activeKey) {
      setGenericError(true);
      return;
    }

    setPending(true);

    try {
      if (phase === 'form') {
        const confirmed = window.confirm(t('confirmCreate', { fee: COMMUNITY_CREATE_FEE }));
        if (!confirmed) {
          setPending(false);
          return;
        }

        const signedCreate = await SteemSigner.signAccountCreate(
          username,
          ownerName,
          ownerPassword,
          activeKey
        );
        const createResult = await apiClient.broadcastAccountCreate(signedCreate, username);
        if (!createResult.success) {
          setAccountError(true);
          setPending(false);
          return;
        }

        setPhase('account_created');
        const setupOk = await broadcastCommunitySetup();
        if (!setupOk) {
          setPending(false);
          return;
        }

        setPhase('success');
        setPending(false);
        return;
      }

      if (phase === 'account_created') {
        const setupOk = await broadcastCommunitySetup();
        if (!setupOk) {
          setPending(false);
          return;
        }
        setPhase('success');
      }
    } catch (error) {
      console.error('Create community error:', error);
      setGenericError(true);
    } finally {
      setPending(false);
    }
  };

  if (!isMyAccount) {
    return (
      <div className="UserWallet max-w-xl">
        <p className="text-muted-foreground text-sm">{t('viewOnly')}</p>
      </div>
    );
  }

  if (!activeKey) {
    return (
      <div className="UserWallet max-w-xl space-y-4">
        <h2 className="text-lg font-semibold tracking-wide uppercase">{t('createHeading')}</h2>
        <p className="text-muted-foreground text-sm">{t('activeKeyRequired')}</p>
      </div>
    );
  }

  if (phase === 'success') {
    const url = communityTrendingUrl(socialUrl, ownerName);
    return (
      <div className="UserWallet max-w-xl space-y-3">
        <p>{t('createdSuccess')}</p>
        <p className="font-semibold">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            {t('getStarted')}
          </a>
        </p>
      </div>
    );
  }

  const showForm = !pending;

  return (
    <div className="UserWallet max-w-xl space-y-4">
      {accountError && (
        <p className="text-destructive text-sm">{t('accountCreateFailed')}</p>
      )}
      {settingsError && (
        <p className="text-destructive text-sm">{t('settingsFailed')}</p>
      )}
      {genericError && (
        <p className="text-destructive text-sm">{t('genericFailed')}</p>
      )}
      {phase === 'account_created' && (
        <p className="text-muted-foreground text-sm">{t('settingAdmin', { username })}</p>
      )}

      {pending ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <span>{t('creating')}</span>
        </div>
      ) : null}

      {showForm ? (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <h2 className="text-lg font-semibold tracking-wide uppercase">{t('createHeading')}</h2>

          <div className="space-y-2">
            <Label htmlFor="community_title">{t('titleLabel')}</Label>
            <Input
              id="community_title"
              type="text"
              minLength={3}
              maxLength={20}
              value={title}
              onChange={(event) => {
                const value = event.target.value;
                if (value.length <= COMMUNITY_TITLE_MAX_LENGTH) setTitle(value);
              }}
              required
            />
            {titleError ? <p className="text-destructive text-sm">{titleError}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="community_description">{t('aboutLabel')}</Label>
            <Input
              id="community_description"
              type="text"
              maxLength={COMMUNITY_DESCRIPTION_MAX_LENGTH}
              value={description}
              onChange={(event) => {
                const value = event.target.value;
                if (value.length <= COMMUNITY_DESCRIPTION_MAX_LENGTH) setDescription(value);
              }}
            />
          </div>

          {!hasCredentials ? (
            <Button type="button" onClick={generateCredentials}>
              {t('next')}
            </Button>
          ) : (
            <>
              <div className="space-y-2">
                <Label>{t('ownerCredentials')}</Label>
                <code className="block break-all rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-rose-700">
                  {ownerName}
                  <br />
                  {ownerPassword}
                </code>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="community_saved"
                  checked={savedConfirmed}
                  onCheckedChange={(checked) => setSavedConfirmed(checked === true)}
                  required
                />
                <Label htmlFor="community_saved" className="font-normal leading-snug">
                  {t('savedConfirm')}
                </Label>
              </div>

              <Button type="submit" disabled={!!titleError || !savedConfirmed}>
                {t('createButton')}
              </Button>
            </>
          )}
        </form>
      ) : null}
    </div>
  );
}
