
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Gift, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import * as dsteem from 'dsteem';
import { steemOperations } from '@/services/steemOperations';
import { getSteemPerMvests, vestsToSteem } from '@/utils/utility';

interface PendingRewardsProps {
  account: any;
  onUpdate?: () => void;
}

const PendingRewards = ({ account, onUpdate }: PendingRewardsProps) => {
  const [isClaiming, setIsClaiming] = useState(false);
  const [rewardSteemPower, setRewardSteemPower] = useState(0);
  const { toast } = useToast();

  if (!account) return null;

  const username = localStorage.getItem('steem_username');
  const rewardSteem = parseFloat(account.reward_steem_balance?.split(' ')[0] || '0');
  const rewardSbd = parseFloat(account.reward_sbd_balance?.split(' ')[0] || '0');
  const rewardVests = parseFloat(account.reward_vesting_balance?.split(' ')[0] || '0');

  // Check if current user is viewing their own account
  const isOwnAccount = username && account.name === username;

  // Check if there are any pending rewards
  const hasPendingRewards = rewardSteem > 0 || rewardSbd > 0 || rewardVests > 0;

  useEffect(() => {
    const convertRewardVestsToSteem = async () => {
      if (rewardVests > 0) {
        try {
          const steemPerMvests = await getSteemPerMvests();
          const steemPowerAmount = vestsToSteem(rewardVests, steemPerMvests);
          setRewardSteemPower(steemPowerAmount);
        } catch (error) {
          console.error('Error converting reward VESTS to STEEM:', error);
          // Fallback calculation
          setRewardSteemPower(rewardVests / 1000000);
        }
      }
    };

    convertRewardVestsToSteem();
  }, [rewardVests]);

  const handleClaimRewards = async () => {
    if (!username || !hasPendingRewards) return;

    const loginMethod = localStorage.getItem('steem_login_method');
    setIsClaiming(true);

    try {
      if (loginMethod === 'keychain') {
        await handleKeychainClaim();
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyClaim();
      }
    } catch (error) {
      console.error('Claim rewards error:', error);
      toast({
        title: "Operation Failed",
        description: "Failed to claim rewards. Please try again.",
        variant: "destructive",
      });
      setIsClaiming(false);
    }
  };

  const handleKeychainClaim = async () => {
    if (!window.steem_keychain) {
      toast({
        title: "Keychain Not Available",
        description: "Steem Keychain not found",
        variant: "destructive",
      });
      setIsClaiming(false);
      return;
    }

    try {
      const rewardSteemBalance = `${rewardSteem.toFixed(3)} STEEM`;
      const rewardSbdBalance = `${rewardSbd.toFixed(3)} SBD`;
      const rewardVestingBalance = `${rewardVests.toFixed(6)} VESTS`;

      // Use Posting key for claim rewards (works for all key types)
      window.steem_keychain.requestBroadcast(
        username!,
        [['claim_reward_balance', { 
          account: username!, 
          reward_steem: rewardSteemBalance,
          reward_sbd: rewardSbdBalance,
          reward_vests: rewardVestingBalance
        }]],
        'Posting',
        (response: any) => {
          if (response.success) {
            toast({
              title: "Rewards Claimed Successfully",
              description: "Your pending rewards have been claimed and added to your wallet",
            });
            // Call onUpdate to refresh data without page reload
            onUpdate?.();
          } else {
            toast({
              title: "Operation Failed",
              description: response.message || "Transaction was rejected",
              variant: "destructive",
            });
          }
          setIsClaiming(false);
        }
      );
    } catch (error: any) {
      toast({
        title: "Operation Failed",
        description: error.message || "Failed to claim rewards",
        variant: "destructive",
      });
      setIsClaiming(false);
    }
  };

  const handlePrivateKeyClaim = async () => {
    // Try different keys in order: posting, active, owner
    const postingKey = localStorage.getItem('steem_posting_key');
    const activeKey = localStorage.getItem('steem_active_key');
    const ownerKey = localStorage.getItem('steem_owner_key');

    let privateKeyString = postingKey || activeKey || ownerKey;
    
    if (!privateKeyString) {
      toast({
        title: "Private Key Not Found",
        description: "Posting, Active, or Owner key required for this operation",
        variant: "destructive",
      });
      setIsClaiming(false);
      return;
    }

    try {
      const privateKey = dsteem.PrivateKey.fromString(privateKeyString);
      
      const rewardSteemBalance = `${rewardSteem.toFixed(3)} STEEM`;
      const rewardSbdBalance = `${rewardSbd.toFixed(3)} SBD`;
      const rewardVestingBalance = `${rewardVests.toFixed(6)} VESTS`;

      await steemOperations.claimRewardBalance(
        username!,
        rewardSteemBalance,
        rewardSbdBalance,
        rewardVestingBalance,
        privateKey
      );
      
      toast({
        title: "Rewards Claimed Successfully",
        description: "Your pending rewards have been claimed and added to your wallet",
      });
      // Call onUpdate to refresh data without page reload
      onUpdate?.();
      setIsClaiming(false);
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
      setIsClaiming(false);
    }
  };

  // Don't show if not own account or no pending rewards
  if (!isOwnAccount || !hasPendingRewards) {
    return null;
  }

  return (
    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3">
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">
          <Gift className="w-3 h-3 mr-1" />
          Pending Rewards
        </Badge>
        
        <div className="flex items-center gap-4 text-sm">
          {rewardSteem > 0 && (
            <div>
              <span className="text-green-700 font-medium">{rewardSteem.toFixed(3)} STEEM</span>
            </div>
          )}
          
          {rewardSbd > 0 && (
            <div>
              <span className="text-green-700 font-medium">{rewardSbd.toFixed(3)} SBD</span>
            </div>
          )}
          
          {rewardVests > 0 && (
            <div>
              <span className="text-green-700 font-medium">{rewardSteemPower.toFixed(3)} SP</span>
            </div>
          )}
        </div>
      </div>

      <Button
        onClick={handleClaimRewards}
        variant="outline"
        size="sm"
        className="border-green-300 text-green-700 hover:bg-green-50 text-xs"
        disabled={isClaiming}
      >
        {isClaiming ? (
          <>
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Claiming...
          </>
        ) : (
          <>
            <Gift className="w-3 h-3 mr-1" />
            Claim
          </>
        )}
      </Button>
    </div>
  );
};

export default PendingRewards;
