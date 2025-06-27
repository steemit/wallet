import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDown, X, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import * as dsteem from 'dsteem';
import { steemOperations } from '@/services/steemOperations';
import { getSteemPerMvests, vestsToSteem, getDaysUntilNextWithdrawal } from '@/utils/utility';

interface PowerDownStatusProps {
  account: any;
  onUpdate?: () => void;
}

const PowerDownStatus = ({ account, onUpdate }: PowerDownStatusProps) => {
  const [isCancelling, setIsCancelling] = useState(false);
  const [weeklySteem, setWeeklySteem] = useState(0);
  const { toast } = useToast();

  if (!account) return null;

  const username = localStorage.getItem('steem_username');
  const vestingWithdrawRate = parseFloat(account.vesting_withdraw_rate?.split(' ')[0] || '0');
  const nextWithdrawal = new Date(account.next_vesting_withdrawal);
  const withdrawn = parseFloat(account.withdrawn || '0');
  const toWithdraw = parseFloat(account.to_withdraw || '0');

  // Check if power down is active
  const isPowerDownActive = vestingWithdrawRate > 0 && nextWithdrawal > new Date('1970-01-01');

  // Calculate days until next withdrawal
  const daysUntilNext = getDaysUntilNextWithdrawal(account.next_vesting_withdrawal);

  // Check if current user is viewing their own account
  const isOwnAccount = username && account.name === username;

  useEffect(() => {
    const convertVestsToSteem = async () => {
      if (isPowerDownActive && vestingWithdrawRate > 0) {
        try {
          const steemPerMvests = await getSteemPerMvests();
          const weeklyAmount = vestsToSteem(vestingWithdrawRate, steemPerMvests);
          setWeeklySteem(weeklyAmount);
        } catch (error) {
          console.error('Error converting VESTS to STEEM:', error);
          // Fallback calculation
          setWeeklySteem(vestingWithdrawRate / 1000000);
        }
      }
    };

    convertVestsToSteem();
  }, [isPowerDownActive, vestingWithdrawRate]);

  const handleCancelPowerDown = async () => {
    if (!username || !isPowerDownActive) return;

    const loginMethod = localStorage.getItem('steem_login_method');
    setIsCancelling(true);

    try {
      if (loginMethod === 'keychain') {
        await handleKeychainCancel();
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyCancel();
      }
    } catch (error) {
      console.error('Cancel power down error:', error);
      toast({
        title: "Operation Failed",
        description: "Failed to cancel power down. Please try again.",
        variant: "destructive",
      });
      setIsCancelling(false);
    }
  };

  const handleKeychainCancel = async () => {
    if (!window.steem_keychain) {
      toast({
        title: "Keychain Not Available",
        description: "Steem Keychain not found",
        variant: "destructive",
      });
      setIsCancelling(false);
      return;
    }

    try {
      window.steem_keychain.requestBroadcast(
        username!,
        [['withdraw_vesting', { account: username!, vesting_shares: '0.000000 VESTS' }]],
        'Active',
        (response: any) => {
          if (response.success) {
            toast({
              title: "Power Down Cancelled",
              description: "Your power down has been successfully cancelled",
            });
            onUpdate?.();
          } else {
            toast({
              title: "Operation Failed",
              description: response.message || "Transaction was rejected",
              variant: "destructive",
            });
          }
          setIsCancelling(false);
        }
      );
    } catch (error: any) {
      toast({
        title: "Operation Failed",
        description: error.message || "Failed to cancel power down",
        variant: "destructive",
      });
      setIsCancelling(false);
    }
  };

  const handlePrivateKeyCancel = async () => {
    const privateKeyString = localStorage.getItem('steem_active_key');
    if (!privateKeyString) {
      toast({
        title: "Private Key Not Found",
        description: "Active key required for this operation",
        variant: "destructive",
      });
      setIsCancelling(false);
      return;
    }

    try {
      const privateKey = dsteem.PrivateKey.fromString(privateKeyString);
      await steemOperations.powerDown(username!, '0.000000 VESTS', privateKey);
      
      toast({
        title: "Power Down Cancelled",
        description: "Your power down has been successfully cancelled",
      });
      onUpdate?.();
      setIsCancelling(false);
    } catch (error: any) {
      let errorMessage = "Operation failed";
      if (error.jse_shortmsg) {
        errorMessage = error.jse_shortmsg;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Operation Failed",
        description: errorMessage,
        variant: "destructive",
      });
      setIsCancelling(false);
    }
  };

  if (!isPowerDownActive) {
    return null; // Don't show anything if no active power down
  }

  return (
    <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg p-3">
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="bg-orange-100 text-orange-800 hover:bg-orange-100">
          <ArrowDown className="w-3 h-3 mr-1" />
          Power Down Active
        </Badge>
        
        <div className="flex items-center gap-4 text-sm">
          <div>
            <span className="text-orange-700 font-medium">{weeklySteem.toFixed(3)} STEEM</span>
            <span className="text-orange-600 ml-1">weekly</span>
          </div>
          
          <div>
            <span className="text-orange-700 font-medium">
              {nextWithdrawal.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
            <span className="text-orange-600 ml-1">({daysUntilNext} days)</span>
          </div>
        </div>
      </div>

      {isOwnAccount && (
        <Button
          onClick={handleCancelPowerDown}
          variant="outline"
          size="sm"
          className="border-red-300 text-red-600 hover:bg-red-50 text-xs"
          disabled={isCancelling}
        >
          {isCancelling ? (
            <>
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Cancelling...
            </>
          ) : (
            <>
              <X className="w-3 h-3 mr-1" />
              Cancel
            </>
          )}
        </Button>
      )}
    </div>
  );
};

export default PowerDownStatus;
