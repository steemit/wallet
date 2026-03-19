export default function ProposalsPlaceholderPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-6 md:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">Proposals</h1>
      </div>
      <div className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <p className="text-sm text-muted-foreground">
          The proposals page from the legacy wallet is not fully implemented here yet.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          You can continue to use the legacy proposals interface at{' '}
          <a
            href="https://wallet.esteem.app/proposals"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline"
          >
            wallet-legacy /proposals
          </a>
          .
        </p>
      </div>
    </div>
  );
}

