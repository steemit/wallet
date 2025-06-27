
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Edit, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { steemOperations } from '@/services/steemOperations';
import * as dsteem from 'dsteem';
import { FormattedDelegation } from '@/hooks/useDelegations';

interface DelegationEditDialogProps {
  delegation: FormattedDelegation;
  onSuccess: () => void;
  steemPerMvests: number;
}

const DelegationEditDialog = ({ delegation, onSuccess, steemPerMvests }: DelegationEditDialogProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [newAmount, setNewAmount] = useState(delegation.steemPower);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleEditDelegation = async () => {
    const username = localStorage.getItem('steem_username');
    const loginMethod = localStorage.getItem('steem_login_method');
    
    if (!username || !loginMethod) {
      toast({
        title: "Authentication Required",
        description: "Please log in to edit delegations",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    try {
      // Convert SP to VESTS
      const steemAmount = parseFloat(newAmount);
      const vestsAmount = (steemAmount * 1000000) / steemPerMvests;
      const vestingShares = `${vestsAmount.toFixed(6)} VESTS`;

      if (loginMethod === 'keychain') {
        await handleKeychainDelegation(username, delegation.delegatee, vestingShares);
      } else {
        await handlePrivateKeyDelegation(username, delegation.delegatee, vestingShares);
      }
    } catch (error) {
      console.error('Edit delegation error:', error);
      toast({
        title: "Operation Failed",
        description: "Failed to update delegation. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeychainDelegation = async (delegator: string, delegatee: string, vestingShares: string) => {
    if (!window.steem_keychain) {
      toast({
        title: "Keychain Not Available",
        description: "Steem Keychain not found",
        variant: "destructive",
      });
      return;
    }

    window.steem_keychain.requestBroadcast(
      delegator,
      [['delegate_vesting_shares', { 
        delegator, 
        delegatee, 
        vesting_shares: vestingShares
      }]],
      'Active',
      (response: any) => {
        if (response.success) {
          toast({
            title: "Delegation Updated",
            description: `Successfully updated delegation to @${delegatee}`,
          });
          setIsOpen(false);
          onSuccess();
        } else {
          toast({
            title: "Operation Failed",
            description: response.message || "Transaction was rejected",
            variant: "destructive",
          });
        }
      }
    );
  };

  const handlePrivateKeyDelegation = async (delegator: string, delegatee: string, vestingShares: string) => {
    const activeKey = localStorage.getItem('steem_active_key');
    const ownerKey = localStorage.getItem('steem_owner_key');
    
    let privateKeyString = activeKey || ownerKey;
    
    if (!privateKeyString) {
      toast({
        title: "Private Key Not Found",
        description: "Active or Owner key required for delegation operations",
        variant: "destructive",
      });
      return;
    }

    const privateKey = dsteem.PrivateKey.fromString(privateKeyString);
    
    await steemOperations.delegateVestingShares({
      delegator,
      delegatee,
      vesting_shares: vestingShares
    }, privateKey);
    
    toast({
      title: "Delegation Updated",
      description: `Successfully updated delegation to @${delegatee}`,
    });
    setIsOpen(false);
    onSuccess();
  };

  const handleRemoveDelegation = async () => {
    const username = localStorage.getItem('steem_username');
    const loginMethod = localStorage.getItem('steem_login_method');
    
    if (!username || !loginMethod) return;

    setIsProcessing(true);

    try {
      if (loginMethod === 'keychain') {
        await handleKeychainDelegation(username, delegation.delegatee, "0.000000 VESTS");
      } else {
        await handlePrivateKeyDelegation(username, delegation.delegatee, "0.000000 VESTS");
      }
    } catch (error) {
      console.error('Remove delegation error:', error);
      toast({
        title: "Operation Failed",
        description: "Failed to remove delegation. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-xs sm:text-sm px-2 sm:px-4">
          <Edit className="w-3 h-3 mr-1" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Delegation to @{delegation.delegatee}</DialogTitle>
          <DialogDescription>
            Update or remove your delegation. Changes take effect immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="amount">New Amount (SP)</Label>
            <Input
              id="amount"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              placeholder="0.000"
              type="number"
              step="0.001"
            />
          </div>
          <div className="text-sm text-gray-500">
            Current delegation: {delegation.steemPower} SP
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleEditDelegation}
            disabled={isProcessing || !newAmount || parseFloat(newAmount) < 0}
            className="flex-1"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              'Update Delegation'
            )}
          </Button>
          <Button
            onClick={handleRemoveDelegation}
            disabled={isProcessing}
            variant="destructive"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Remove'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DelegationEditDialog;
