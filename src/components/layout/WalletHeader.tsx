
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import LoginDialog from "@/components/wallet/LoginDialog";
import { useToast } from "@/hooks/use-toast";

interface WalletHeaderProps {
  selectedAccount: string;
  loggedInUser: string | null;
  onLoginSuccess: (username: string, method: 'keychain' | 'privatekey' | 'masterpassword') => void;
}

const WalletHeader = ({ selectedAccount, loggedInUser, onLoginSuccess }: WalletHeaderProps) => {
  const [searchUsername, setSearchUsername] = useState("");
  const navigate = useNavigate();

  const handleLogoClick = () => {
    if (loggedInUser) {
      navigate(`/@${loggedInUser}`);
    } else {
      navigate('/');
    }
  };

  const handleSearch = () => {
    if (searchUsername.trim()) {
      navigate(`/@${searchUsername.trim()}`);
    }
  };

  return (
    <div className="bg-white shadow-sm border-b border-gray-200">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-4">
          <div 
            className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
            onClick={handleLogoClick}
          >
            <img src="/steemit.svg" alt="Steemit" className="w-8 h-8 sm:w-10 sm:h-10 flex-shrink-0" />
            <div className="hidden sm:block">
              <h1 className="text-2xl font-bold text-gray-900">
                Steemit Wallet
              </h1>
              {selectedAccount && (
                <p className="text-sm text-gray-600">@{selectedAccount}</p>
              )}
            </div>
            <div className="sm:hidden">
              <h1 className="text-lg font-bold text-gray-900">
                Steemit
              </h1>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3 flex-1 justify-end max-w-lg">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search username..."
                value={searchUsername}
                onChange={(e) => setSearchUsername(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="pl-10 w-full text-sm"
              />
            </div>
            
            <LoginDialog onLoginSuccess={onLoginSuccess}>
              <Button 
                className={`${loggedInUser ? "bg-steemit-500 hover:bg-steemit-600" : ""} text-xs sm:text-sm px-2 sm:px-3 py-2 whitespace-nowrap flex-shrink-0`}
                size="sm"
              >
                {loggedInUser ? `@${loggedInUser}` : 'LOGIN'}
              </Button>
            </LoginDialog>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WalletHeader;
