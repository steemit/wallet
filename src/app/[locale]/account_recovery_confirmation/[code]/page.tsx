import { RecoverAccountConfirmationPage } from '@/components/wallet/recover-account-confirmation-page';

export default async function AccountRecoveryConfirmationPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <RecoverAccountConfirmationPage code={code} />;
}
