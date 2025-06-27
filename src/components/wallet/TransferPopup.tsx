
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, TrendingUp, PiggyBank, ArrowDown, Route } from "lucide-react";
import { useSteemAccount } from "@/hooks/useSteemAccount";
import TransferConfirmDialog from "./TransferConfirmDialog";

export type OperationType = 'transfer' | 'powerup' | 'powerdown' | 'savings' | 'withdraw_savings' | 'withdraw_route';

interface TransferPopupProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
}

const TransferPopup = ({ isOpen, onClose, username }: TransferPopupProps) => {
  const [operationType, setOperationType] = useState<OperationType>('transfer');
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("STEEM");
  const [memo, setMemo] = useState("");
  const [percent, setPercent] = useState("");
  const [autoVest, setAutoVest] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: account } = useSteemAccount(username);

  // Reset form when popup opens/closes
  useEffect(() => {
    if (!isOpen) {
      setOperationType('transfer');
      setRecipient("");
      setAmount("");
      setCurrency("STEEM");
      setMemo("");
      setPercent("");
      setAutoVest(false);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    setShowConfirm(true);
  };

  const handleSuccess = () => {
    setShowConfirm(false);
    onClose();
  };

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
      default: return 'Transfer';
    }
  };

  const getOperationDescription = (type: OperationType) => {
    switch (type) {
      case 'transfer': return 'Send STEEM or SBD to another account';
      case 'powerup': return 'Convert STEEM to STEEM Power (SP)';
      case 'powerdown': return 'Convert STEEM Power to STEEM over 4 weeks';
      case 'savings': return 'Move funds to savings account';
      case 'withdraw_savings': return 'Move funds from savings to balance';
      case 'withdraw_route': return 'Route future power down payments to another account';
      default: return '';
    }
  };

  const getCurrencyOptions = (type: OperationType) => {
    switch (type) {
      case 'powerup':
      case 'powerdown':
        return ['STEEM'];
      case 'transfer':
      case 'savings':
        return ['STEEM', 'SBD'];
      case 'withdraw_savings':
        return ['STEEM', 'SBD'];
      case 'withdraw_route':
        return ['STEEM'];
      default:
        return ['STEEM', 'SBD'];
    }
  };

  const showRecipientField = () => {
    return operationType === 'transfer' || operationType === 'powerup' || operationType === 'savings' || operationType === 'withdraw_route';
  };

  const showAmountField = () => {
    return operationType !== 'withdraw_route';
  };

  const showPercentField = () => {
    return operationType === 'withdraw_route';
  };

  const showMemoField = () => {
    return operationType === 'transfer' || operationType === 'savings' || operationType === 'withdraw_savings';
  };

  const showAutoVestField = () => {
    return operationType === 'withdraw_route';
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="bg-white max-w-md" hideCloseButton>
          <DialogHeader>
            <DialogTitle className="text-gray-800">Transfer Assets</DialogTitle>
            <DialogDescription className="text-gray-600">
              Choose an operation and enter the details
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Operation Type Selection */}
            <div className="space-y-2">
              <Label className="text-gray-700">Operation Type</Label>
              <Select 
                value={operationType} 
                onValueChange={(value: OperationType) => {
                  setOperationType(value);
                  // Reset currency when changing operation
                  const currencies = getCurrencyOptions(value);
                  if (!currencies.includes(currency)) {
                    setCurrency(currencies[0]);
                  }
                }}
              >
                <SelectTrigger className="bg-white border-gray-300">
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      {getOperationIcon(operationType)}
                      <span>{getOperationTitle(operationType)}</span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-200">
                  <SelectItem value="transfer">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="w-4 h-4" style={{ color: '#07d7a9' }} />
                      <span>Transfer</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="powerup">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" style={{ color: '#07d7a9' }} />
                      <span>Power Up</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="powerdown">
                    <div className="flex items-center gap-2">
                      <ArrowDown className="w-4 h-4" style={{ color: '#07d7a9' }} />
                      <span>Power Down</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="savings">
                    <div className="flex items-center gap-2">
                      <PiggyBank className="w-4 h-4" style={{ color: '#07d7a9' }} />
                      <span>Transfer to Savings</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="withdraw_savings">
                    <div className="flex items-center gap-2">
                      <PiggyBank className="w-4 h-4" style={{ color: '#07d7a9' }} />
                      <span>Withdraw from Savings</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="withdraw_route">
                    <div className="flex items-center gap-2">
                      <Route className="w-4 h-4" style={{ color: '#07d7a9' }} />
                      <span>Set Withdraw Route</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-gray-500">{getOperationDescription(operationType)}</p>
            </div>

            {/* Recipient Field */}
            {showRecipientField() && (
              <div className="space-y-2">
                <Label htmlFor="recipient" className="text-gray-700">
                  {operationType === 'powerup' ? 'Power Up To (optional)' : 
                   operationType === 'withdraw_route' ? 'Route To Account' : 'Recipient'}
                </Label>
                <Input
                  id="recipient"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder={
                    operationType === 'powerup' ? "username (leave empty to power up to yourself)" : 
                    operationType === 'withdraw_route' ? "Account to receive power down payments" : "username"
                  }
                  className="bg-white border-gray-300"
                />
              </div>
            )}

            {/* Amount and Currency */}
            {showAmountField() && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="amount" className="text-gray-700">
                    Amount {operationType === 'powerdown' ? '(SP)' : ''}
                  </Label>
                  <Input
                    id="amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.000"
                    step="0.001"
                    className="bg-white border-gray-300"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="bg-white border-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-gray-200">
                      {getCurrencyOptions(operationType).map((curr) => (
                        <SelectItem key={curr} value={curr}>{curr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Percent Field for Withdraw Route */}
            {showPercentField() && (
              <div className="space-y-2">
                <Label htmlFor="percent" className="text-gray-700">Percentage (0-100%)</Label>
                <Input
                  id="percent"
                  type="number"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder="100"
                  min="0"
                  max="100"
                  className="bg-white border-gray-300"
                />
                <p className="text-xs text-gray-500">Percentage of power down payments to route to the specified account</p>
              </div>
            )}

            {/* Auto Vest Toggle for Withdraw Route */}
            {showAutoVestField() && (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="autoVest"
                    checked={autoVest}
                    onChange={(e) => setAutoVest(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <Label htmlFor="autoVest" className="text-gray-700">Auto Vest</Label>
                </div>
                <p className="text-xs text-gray-500">
                  When enabled, funds will be automatically converted to STEEM Power in the recipient account
                </p>
              </div>
            )}

            {/* Memo Field */}
            {showMemoField() && (
              <div className="space-y-2">
                <Label htmlFor="memo" className="text-gray-700">Memo (optional)</Label>
                <Textarea
                  id="memo"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Enter memo..."
                  className="bg-white border-gray-300 min-h-[80px]"
                />
              </div>
            )}

            {/* Power Down Information */}
            {operationType === 'powerdown' && (
              <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                <h4 className="font-medium text-blue-800 mb-2">⚠️ Power Down Information:</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• Power down takes 4 weeks to complete</li>
                  <li>• You'll receive 1/4 of the amount each week</li>
                  <li>• You can cancel power down anytime</li>
                  <li>• Reduces your voting influence immediately</li>
                </ul>
              </div>
            )}

            {/* Withdraw Route Information */}
            {operationType === 'withdraw_route' && (
              <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-200">
                <h4 className="font-medium text-yellow-800 mb-2">ℹ️ Withdraw Route Information:</h4>
                <ul className="text-sm text-yellow-700 space-y-1">
                  <li>• This only sets up routing rules for future power downs</li>
                  <li>• You must still initiate power down separately</li>
                  <li>• 100% routes all future power down payments</li>
                  <li>• Auto-vest converts payments directly to STEEM Power</li>
                </ul>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button 
                variant="outline" 
                onClick={onClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleConfirm}
                className="flex-1 text-white"
                style={{ backgroundColor: '#07d7a9' }}
                disabled={
                  (showAmountField() && !amount) || 
                  (showRecipientField() && operationType !== 'powerup' && !recipient) ||
                  (showPercentField() && !percent)
                }
              >
                Continue
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TransferConfirmDialog
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        recipient={recipient}
        amount={amount}
        currency={currency}
        memo={memo}
        operationType={operationType}
        percent={percent}
        autoVest={autoVest}
        onSuccess={handleSuccess}
      />
    </>
  );
};

export default TransferPopup;
