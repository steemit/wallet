
import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import WalletHeader from "@/components/layout/WalletHeader";
import WalletNavigation from "@/components/layout/WalletNavigation";
import WalletOverview from "@/components/wallet/WalletOverview";
import WalletSkeleton from "@/components/wallet/WalletSkeleton";
import WitnessOperations from "@/components/wallet/WitnessOperations";
import DelegationOperations from "@/components/wallet/DelegationOperations";
import AccountOperations from "@/components/wallet/AccountOperations";
import MarketOperations from "@/components/wallet/MarketOperations";
import GovernanceOperations from "@/components/wallet/GovernanceOperations";
import TransferPopup from "@/components/wallet/TransferPopup";
import { useSteemAccount, formatWalletData, WalletData } from "@/hooks/useSteemAccount";
import { useDelegations } from "@/hooks/useDelegations";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

type ViewMode = "grid" | "list";

const defaultWalletData: WalletData = {
  steem: "0.000",
  steemPower: "0.000",
  sbd: "0.000",
  savings: {
    steem: "0.000",
    sbd: "0.000"
  },
  delegated: "0.000",
  received: "0.000",
  reputation: 25,
  votingPower: 100,
  resourceCredits: 100,
  accountValue: "0.00",
  usdValue: "0.00",
  steemPrice: 0.25,
  sbdPrice: 1.0
};

const Index = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [walletData, setWalletData] = useState<WalletData>(defaultWalletData);
  const [isTransferPopupOpen, setIsTransferPopupOpen] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<string | null>(null);
  const [loginMethod, setLoginMethod] = useState<'keychain' | 'privatekey' | 'masterpassword' | null>(null);

  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  
  let username = '';
  if (location.pathname === '/') {
    username = '';
  } else if (location.pathname.startsWith('/@')) {
    username = location.pathname.slice(2);
  } else if (params.username) {
    username = params.username;
  }
  
  const selectedAccount = username || loggedInUser || '';
  const { toast } = useToast();
  
  const { data: accountData, isLoading, error, refetch } = useSteemAccount(selectedAccount);
  
  // Get delegation data for the selected account
  const { outgoingDelegations } = useDelegations(selectedAccount);

  useEffect(() => {
    const savedUsername = localStorage.getItem('steem_username');
    const savedLoginMethod = localStorage.getItem('steem_login_method') as 'keychain' | 'privatekey' | 'masterpassword' | null;
    
    if (savedUsername && savedLoginMethod) {
      setLoggedInUser(savedUsername);
      setLoginMethod(savedLoginMethod);
    }
  }, []);

  useEffect(() => {
    if (loggedInUser && location.pathname === '/') {
      navigate(`/@${loggedInUser}`);
    }
  }, [loggedInUser, location.pathname, navigate]);

  useEffect(() => {
    const updateWalletData = async () => {
      if (accountData && selectedAccount) {
        try {
          const formattedData = await formatWalletData(accountData);
          setWalletData(formattedData);
        } catch (error) {
          console.error('Error formatting wallet data:', error);
        }
      } else {
        // Reset wallet data when no account is selected
        setWalletData(defaultWalletData);
      }
    };
    updateWalletData();
  }, [accountData, selectedAccount]);

  const handleLoginSuccess = (username: string, method: 'keychain' | 'privatekey' | 'masterpassword') => {
    setLoggedInUser(username);
    setLoginMethod(method);
    
    navigate(`/@${username}`);
    
    toast({
      title: "Login Successful",
      description: `Welcome to your wallet, @${username}!`,
    });
  };

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
  };

  // Force grid mode on mobile
  const effectiveViewMode = isMobile ? "grid" : viewMode;
  const isListMode = effectiveViewMode === "list";

  if (isLoading) {
    return <WalletSkeleton />;
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "witness":
        return <WitnessOperations loggedInUser={loggedInUser} />;
      case "delegation":
        return <DelegationOperations />;
      case "market":
        return <MarketOperations />;
      case "governance":
        return <GovernanceOperations />;
      case "account":
        return <AccountOperations />;
      default:
        return (
          <WalletOverview
            selectedAccount={selectedAccount}
            loggedInUser={loggedInUser}
            accountData={accountData}
            walletData={walletData}
            outgoingDelegations={outgoingDelegations || []}
            onTransferClick={() => setIsTransferPopupOpen(true)}
            onDelegationClick={() => setActiveTab("delegation")}
            onRefetch={refetch}
            viewMode={effectiveViewMode}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <WalletHeader
        selectedAccount={selectedAccount}
        loggedInUser={loggedInUser}
        onLoginSuccess={handleLoginSuccess}
      />

      <div className="container mx-auto px-4 py-8">
        {/* Error State */}
        {error && (
          <Card className="bg-red-50 border-red-200 mb-6">
            <CardContent className="p-4">
              <p className="text-red-800 font-medium">
                Error loading account data: {error.message}
              </p>
            </CardContent>
          </Card>
        )}

        {isListMode && !isMobile ? (
          /* List View - Sidebar Layout for Desktop Only */
          <div className="flex gap-6">
            <WalletNavigation
              activeTab={activeTab}
              onTabChange={setActiveTab}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              isListView={true}
            />

            {/* Main Content */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-6">
                <WalletNavigation
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  viewMode={viewMode}
                  onViewModeChange={handleViewModeChange}
                  isListView={true}
                />
              </div>

              {renderTabContent()}
            </div>
          </div>
        ) : (
          <>
            <WalletNavigation
              activeTab={activeTab}
              onTabChange={setActiveTab}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
            />

            {renderTabContent()}
          </>
        )}
      </div>

      {/* Transfer Popup */}
      <TransferPopup
        isOpen={isTransferPopupOpen}
        onClose={() => setIsTransferPopupOpen(false)}
        username={loggedInUser || ''}
      />
    </div>
  );
};

export default Index;
