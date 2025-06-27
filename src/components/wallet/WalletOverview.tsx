import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import WalletCard from "./WalletCard";
import PendingRewards from "./PendingRewards";
import PowerDownStatus from "./PowerDownStatus";
import AccountHistory from "./AccountHistory";
import { WalletData } from "@/hooks/useSteemAccount";
import { FormattedDelegation } from "@/hooks/useDelegations";
import { useIsMobile } from "@/hooks/use-mobile";

interface WalletOverviewProps {
  selectedAccount: string;
  loggedInUser: string | null;
  accountData: any;
  walletData: WalletData;
  outgoingDelegations: FormattedDelegation[];
  onTransferClick: () => void;
  onDelegationClick: () => void;
  onRefetch: () => void;
  viewMode: "grid" | "list";
}

const WalletOverview = ({
  selectedAccount,
  loggedInUser,
  accountData,
  walletData,
  outgoingDelegations,
  onTransferClick,
  onDelegationClick,
  onRefetch,
  viewMode
}: WalletOverviewProps) => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const effectiveViewMode = isMobile ? "grid" : viewMode;
  const showWelcomeMessage = loggedInUser && !selectedAccount;

  return (
    <div className="space-y-6">
      {showWelcomeMessage && (
        <Card className="bg-gradient-to-r from-steemit-500 to-steemit-600 text-white">
          <CardContent className="p-6">
            <h2 className="text-2xl font-bold mb-2">Welcome, @{loggedInUser}!</h2>
            <p className="text-steemit-100 mb-4">
              You're successfully logged in. Click below to view your wallet or search for other accounts.
            </p>
            <Button 
              onClick={() => navigate(`/@${loggedInUser}`)}
              className="bg-white text-steemit-600 hover:bg-gray-100"
            >
              View My Wallet
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Current Prices Display */}
      {selectedAccount && (
        <Card className="bg-gradient-to-r from-blue-50 to-green-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-800">Current Prices</h3>
                <div className="flex gap-4 mt-2">
                  <div className="text-sm">
                    <span className="text-gray-600">STEEM:</span>
                    <span className="font-medium text-gray-900 ml-1">${walletData.steemPrice.toFixed(6)}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-600">SBD:</span>
                    <span className="font-medium text-gray-900 ml-1">${walletData.sbdPrice.toFixed(6)}</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-600">Total USD Value</div>
                <div className="text-2xl font-bold text-green-600">${walletData.usdValue}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Rewards - Show for logged-in user only */}
      {selectedAccount && accountData && (
        <PendingRewards 
          account={accountData} 
          onUpdate={onRefetch} 
        />
      )}

      {/* Quick Transfer Button */}
      {loggedInUser && (
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-800">Quick Transfer</h3>
                <p className="text-sm text-gray-600">Send STEEM, SBD, or manage your assets</p>
              </div>
              <Button 
                onClick={onTransferClick}
                className="text-white"
                style={{ backgroundColor: '#07d7a9' }}
              >
                Transfer Assets
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Wallet Cards */}
      <div className={effectiveViewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" : "space-y-4"}>
        <WalletCard
          title="STEEM"
          description="Tradeable tokens that may be transferred anywhere at anytime."
          amount={walletData.steem}
          currency="STEEM"
          subtitle={`≈ $${(parseFloat(walletData.steem) * walletData.steemPrice).toFixed(2)} USD`}
        />

        <WalletCard
          title="STEEM POWER"
          description="Influence tokens which give you more control over post payouts."
          amount={walletData.steemPower}
          currency="STEEM"
          subtitle={`(+${walletData.received} received) (-${walletData.delegated} delegated) | ≈ $${(parseFloat(walletData.steemPower) * walletData.steemPrice).toFixed(2)} USD`}
          gradient
          actionButton={
            outgoingDelegations && outgoingDelegations.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onDelegationClick}
                className="mt-2 text-steemit-600 border-steemit-600 hover:bg-steemit-50"
              >
                View Delegations ({outgoingDelegations.length})
              </Button>
            ) : undefined
          }
        />

        <WalletCard
          title="STEEM DOLLARS"
          description="Tradeable tokens that may be transferred anywhere at anytime."
          amount={walletData.sbd}
          currency="SBD"
          subtitle={`≈ $${(parseFloat(walletData.sbd) * walletData.sbdPrice).toFixed(2)} USD`}
        />

        <WalletCard
          title="SAVINGS"
          description="Balances subject to 3 day withdraw waiting period."
          amount={walletData.savings.steem}
          currency="STEEM"
          subtitle={`$${walletData.savings.sbd} SBD in savings | ≈ $${((parseFloat(walletData.savings.steem) * walletData.steemPrice) + (parseFloat(walletData.savings.sbd) * walletData.sbdPrice)).toFixed(2)} USD`}
        />

        <Card className={effectiveViewMode === "grid" ? "md:col-span-2" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-steemit-500" />
              Estimated Account Value
            </CardTitle>
            <CardDescription>
              Total account asset valuation based on current market prices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <p className="text-3xl font-bold text-green-600">${walletData.usdValue}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedAccount && accountData && (
        <PowerDownStatus 
          account={accountData} 
          onUpdate={onRefetch} 
        />
      )}

      {/* Transaction History */}
      {selectedAccount ? (
        <AccountHistory account={selectedAccount} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>HISTORY</CardTitle>
            <CardDescription>
              Recent wallet transactions and activities
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <div className="max-w-md mx-auto">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  Select an Account
                </h3>
                <p className="text-gray-500">
                  {loggedInUser ? `Logged in as @${loggedInUser}` : 'Enter a username above to load account data and view transactions'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default WalletOverview;
