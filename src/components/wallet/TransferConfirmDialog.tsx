import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, TrendingUp, PiggyBank, ArrowDown, Route, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as dsteem from 'dsteem';
import { steemOperations } from '@/services/steemOperations';
import { OperationType } from './TransferPopup';

interface TransferConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  recipient: string;
  amount: string;
  currency: string;
  memo: string;
  operationType: OperationType;
  percent?: string;
  autoVest?: boolean;
  onSuccess: () => void;
}

const TransferConfirmDialog = ({ 
  isOpen, 
  onClose, 
  recipient, 
  amount, 
  currency, 
  memo, 
  operationType,
  percent = "",
  autoVest = false,
  onSuccess
}: TransferConfirmDialogProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const username = localStorage.getItem('steem_username');

  const getOperationIcon = (type: OperationType) => {
    switch (type) {
      case 'transfer': return <ArrowRight className="w-5 h-5" style={{ color: '#07d7a9' }} />;
      case 'powerup': return <TrendingUp className="w-5 h-5" style={{ color: '#07d7a9' }} />;
      case 'powerdown': return <ArrowDown className="w-5 h-5" style={{ color: '#07d7a9' }} />;
      case 'savings': 
      case 'withdraw_savings': return <PiggyBank className="w-5 h-5" style={{ color: '#07d7a9' }} />;
      case 'withdraw_route': return <Route className="w-5 h-5" style={{ color: '#07d7a9' }} />;
      default: return <ArrowRight className="w-5 h-5" style={{ color: '#07d7a9' }} />;
    }
  };

  const getOperationTitle = (type: OperationType) => {
    switch (type) {
      case 'transfer': return 'Transfer';
      case 'powerup': return 'Power Up';
      case 'powerdown': return 'Power Down';
      case 'savings': return 'Transfer to Savings';
      case 'withdraw_savings': return 'Withdraw from Savings';
      case 'withdraw_route': return 'Set Withdraw Route';
      default: return 'Operation';
    }
  };

  const handleConfirm = async () => {
    if (!username) return;

    const loginMethod = localStorage.getItem('steem_login_method');
    
    setIsProcessing(true);

    try {
      if (loginMethod === 'keychain') {
        await handleKeychainOperation();
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyOperation();
      }
    } catch (error) {
      console.error('Operation error:', error);
      toast({
        title: "Operation Failed",
        description: "Transaction failed. Please try again.",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const handleKeychainOperation = async () => {
    if (!window.steem_keychain) {
      toast({
        title: "Keychain Not Available",
        description: "Steem Keychain not found",
        variant: "destructive",
      });
      setIsProcessing(false);
      return;
    }

    try {
      let operations: any[] = [];

      switch (operationType) {
        case 'transfer':
          operations.push([
            'transfer',
            {
              from: username!,
              to: recipient,
              amount: `${amount} ${currency}`,
              memo: memo
            }
          ]);
          break;

        case 'powerup':
          operations.push([
            'transfer_to_vesting',
            {
              from: username!,
              to: recipient || username!,
              amount: `${amount} ${currency}`
            }
          ]);
          break;

        case 'powerdown':
          const vestsAmount = await steemOperations.convertSteemToVests(`${amount} STEEM`);
          operations.push([
            'withdraw_vesting',
            {
              account: username!,
              vesting_shares: vestsAmount
            }
          ]);
          break;

        case 'savings':
          operations.push([
            'transfer_to_savings',
            {
              from: username!,
              to: recipient,
              amount: `${amount} ${currency}`,
              memo: memo
            }
          ]);
          break;

        case 'withdraw_savings':
          operations.push([
            'transfer_from_savings',
            {
              from: username!,
              to: username!,
              amount: `${amount} ${currency}`,
              memo: memo,
              request_id: Date.now()
            }
          ]);
          break;

        case 'withdraw_route':
          operations.push([
            'set_withdraw_vesting_route',
            {
              from_account: username!,
              to_account: recipient,
              percent: Math.round(parseFloat(percent) * 100), // Convert percentage to basis points
              auto_vest: autoVest
            }
          ]);
          break;
      }

      console.log('Sending operations to Keychain:', operations);

      window.steem_keychain.requestBroadcast(
        username!,
        operations,
        'Active',
        (response: any) => {
          console.log('Keychain response:', response);
          
          if (response.success) {
            onSuccess();
          } else {
            toast({
              title: "Operation Failed",
              description: response.message || "Transaction was rejected",
              variant: "destructive",
            });
          }
          setIsProcessing(false);
        }
      );
    } catch (error: any) {
      console.error('Keychain operation error:', error);
      toast({
        title: "Operation Failed",
        description: error.message || "Failed to process operation",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const handlePrivateKeyOperation = async () => {
    const privateKeyString = localStorage.getItem('steem_active_key');
    if (!privateKeyString) {
      toast({
        title: "Private Key Not Found",
        description: "Active key required for this operation",
        variant: "destructive",
      });
      setIsProcessing(false);
      return;
    }

    try {
      const privateKey = dsteem.PrivateKey.fromString(privateKeyString);

      switch (operationType) {
        case 'transfer':
          const transferOp = {
            from: username!,
            to: recipient,
            amount: `${amount} ${currency}`,
            memo: memo
          };
          console.log('Executing transfer:', transferOp);
          await steemOperations.transfer(transferOp, privateKey);
          break;

        case 'powerup':
          const powerUpOp = {
            from: username!,
            to: recipient || username!,
            amount: `${amount} ${currency}`
          };
          console.log('Executing power up:', powerUpOp);
          await steemOperations.powerUp(powerUpOp, privateKey);
          break;

        case 'powerdown':
          const vestsAmount = await steemOperations.convertSteemToVests(`${amount} STEEM`);
          console.log('Executing power down with vests:', vestsAmount);
          await steemOperations.powerDown(username!, vestsAmount, privateKey);
          break;

        case 'savings':
          const savingsOp = {
            from: username!,
            to: recipient,
            amount: `${amount} ${currency}`,
            memo: memo
          };
          console.log('Executing transfer to savings:', savingsOp);
          await steemOperations.transferToSavings(savingsOp, privateKey);
          break;

        case 'withdraw_savings':
          const withdrawOp = {
            from: username!,
            to: username!,
            amount: `${amount} ${currency}`,
            memo: memo,
            request_id: Date.now()
          };
          console.log('Executing withdraw from savings:', withdrawOp);
          await steemOperations.transferFromSavings(withdrawOp, privateKey);
          break;

        case 'withdraw_route':
          const withdrawRouteOp = {
            from_account: username!,
            to_account: recipient,
            percent: Math.round(parseFloat(percent) * 100), // Convert percentage to basis points
            auto_vest: autoVest
          };
          console.log('Executing set withdraw route:', withdrawRouteOp);
          await steemOperations.setWithdrawVestingRoute(withdrawRouteOp, privateKey);
          break;
      }
      
      onSuccess();
      setIsProcessing(false);
      
    } catch (error: any) {
      console.error('Private key operation error:', error);
      
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
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-white max-w-md" hideCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: '#07d7a9' }}>
            {getOperationIcon(operationType)}
            Confirm {getOperationTitle(operationType)}
          </DialogTitle>
          <DialogDescription>
            Please review the details below before confirming
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Operation:</span>
                <span className="font-medium text-gray-800">{getOperationTitle(operationType)}</span>
              </div>
              
              {operationType !== 'withdraw_route' && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Amount:</span>
                  <span className="font-medium text-gray-800">
                    {amount} {operationType === 'powerdown' ? 'SP' : currency}
                  </span>
                </div>
              )}

              {operationType === 'withdraw_route' && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Percentage:</span>
                    <span className="font-medium text-gray-800">{percent}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Auto Vest:</span>
                    <span className="font-medium text-gray-800">{autoVest ? 'Yes' : 'No'}</span>
                  </div>
                </>
              )}
              
              {recipient && (
                <div className="flex justify-between">
                  <span className="text-gray-600">
                    {operationType === 'powerup' ? 'Power Up To:' : 
                     operationType === 'withdraw_route' ? 'Route To:' : 'To:'}
                  </span>
                  <span className="font-medium text-gray-800">@{recipient}</span>
                </div>
              )}
              
              {memo && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Memo:</span>
                  <span className="font-medium text-gray-800 break-all">{memo}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <Button 
            variant="outline" 
            onClick={onClose}
            className="flex-1"
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm}
            className="flex-1 text-white"
            style={{ backgroundColor: '#07d7a9' }}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              'Confirm'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TransferConfirmDialog;
