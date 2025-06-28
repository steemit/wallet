
import { Button } from "@/components/ui/button";
import { Grid3X3, List } from "lucide-react";
import { MobileTabs, MobileTabsList, MobileTabsTrigger } from "@/components/ui/mobile-tabs";
import { Card, CardContent } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";

type ViewMode = "grid" | "list";

interface WalletNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isListView?: boolean;
}

const WalletNavigation = ({
  activeTab,
  onTabChange,
  viewMode,
  onViewModeChange,
  isListView = false
}: WalletNavigationProps) => {
  const isMobile = useIsMobile();
  const isGridMode = viewMode === "grid";
  const isListMode = viewMode === "list";

  if (isListView && !isMobile) {
    // Sidebar Navigation for List View on Desktop
    return (
      <div className="w-64 flex-shrink-0">
        <Card className="h-fit">
          <CardContent className="p-4">
            <nav className="space-y-2">
              <button
                onClick={() => onTabChange("overview")}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                  activeTab === "overview"
                    ? "bg-steemit-100 text-steemit-800"
                    : "hover:bg-gray-100"
                }`}
              >
                Wallet
              </button>
              <button
                onClick={() => onTabChange("witness")}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                  activeTab === "witness"
                    ? "bg-steemit-100 text-steemit-800"
                    : "hover:bg-gray-100"
                }`}
              >
                Witness
              </button>
              <button
                onClick={() => onTabChange("delegation")}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                  activeTab === "delegation"
                    ? "bg-steemit-100 text-steemit-800"
                    : "hover:bg-gray-100"
                }`}
              >
                Delegation
              </button>
              <button
                onClick={() => onTabChange("market")}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                  activeTab === "market"
                    ? "bg-steemit-100 text-steemit-800"
                    : "hover:bg-gray-100"
                }`}
              >
                Market
              </button>
              <button
                onClick={() => onTabChange("governance")}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                  activeTab === "governance"
                    ? "bg-steemit-100 text-steemit-800"
                    : "hover:bg-gray-100"
                }`}
              >
                Governance
              </button>
              <button
                onClick={() => onTabChange("account")}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                  activeTab === "account"
                    ? "bg-steemit-100 text-steemit-800"
                    : "hover:bg-gray-100"
                }`}
              >
                Account
              </button>
            </nav>
            
            {/* View Mode Toggle in Sidebar */}
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Button
                  variant={isGridMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => onViewModeChange("grid")}
                  className="flex-1"
                >
                  <Grid3X3 className="w-4 h-4" />
                </Button>
                <Button
                  variant={isListMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => onViewModeChange("list")}
                  className="flex-1"
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Mobile/Grid View Navigation
  return (
    <div className="flex items-center justify-between mb-6 gap-4">
      <div className="flex-1 min-w-0">
        <MobileTabs value={activeTab} onValueChange={onTabChange}>
          <MobileTabsList>
            <MobileTabsTrigger value="overview">Wallet</MobileTabsTrigger>
            <MobileTabsTrigger value="witness">Witness</MobileTabsTrigger>
            <MobileTabsTrigger value="delegation">Delegation</MobileTabsTrigger>
            <MobileTabsTrigger value="market">Market</MobileTabsTrigger>
            <MobileTabsTrigger value="governance">Governance</MobileTabsTrigger>
            <MobileTabsTrigger value="account">Account</MobileTabsTrigger>
          </MobileTabsList>
        </MobileTabs>
      </div>
      
      {/* View Mode Toggle - Hidden on Mobile */}
      {!isMobile && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant={isGridMode ? "default" : "outline"}
            size="sm"
            onClick={() => onViewModeChange("grid")}
          >
            <Grid3X3 className="w-4 h-4" />
          </Button>
          <Button
            variant={isListMode ? "default" : "outline"}
            size="sm"
            onClick={() => onViewModeChange("list")}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default WalletNavigation;
