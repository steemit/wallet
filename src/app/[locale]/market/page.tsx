export default function MarketPlaceholderPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-6 md:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">Market</h1>
      </div>
      <div className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <p className="text-sm text-muted-foreground">
          The market page from the legacy wallet is not fully implemented here yet.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          You can continue to use the legacy market interface at{' '}
          <a
            href="https://wallet.esteem.app/market"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent-foreground hover:underline"
          >
            wallet-legacy /market
          </a>
          .
        </p>
      </div>
    </div>
  );
}

