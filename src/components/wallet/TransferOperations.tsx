import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRight, TrendingUp, PiggyBank, ArrowDown, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import TransferConfirmDialog from "./TransferConfirmDialog";

export type OperationType = 'transfer' | 'powerup' | 'powerdown' | 'savings' | 'withdraw_savings';

const TransferOperations = () => {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("STEEM");
  const [memo, setMemo] = useState("");
  const [operationType, setOperationType] = useState<OperationType>('transfer');
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  
  const { toast } = useToast();

  // Check if user is logged in
  const isLoggedIn = localStorage.getItem('steem_username');

  const handleOperation = () => {
    // Check if user is logged in first
    if (!isLoggedIn) {
      toast({
        title: "Login Required",
        description: "Please login to perform blockchain operations. You can view wallet information without logging in.",
        variant: "destructive",
      });
      return;
    }

    if (!amount) {
      toast({
        title: "Amount Required",
        description: "Please enter an amount",
        variant: "destructive",
      });
      return;
    }

    if ((operationType === 'transfer' || operationType === 'powerup' || operationType === 'savings') && !recipient) {
      toast({
        title: "Recipient Required", 
        description: "Please enter a recipient username",
        variant: "destructive",
      });
      return;
    }

    setIsConfirmDialogOpen(true);
  };

  const handleSuccess = () => {
    setRecipient("");
    setAmount("");
    setMemo("");
    toast({
      title: "Operation Successful",
      description: `${operationType.charAt(0).toUpperCase() + operationType.slice(1)} completed successfully`,
    });
  };

  const getOperationTitle = () => {
    switch (operationType) {
      case 'transfer': return 'Transfer Assets';
      case 'powerup': return 'Power Up';
      case 'powerdown': return 'Power Down';
      case 'savings': return 'Transfer to Savings';
      case 'withdraw_savings': return 'Withdraw from Savings';
      default: return 'Transfer Assets';
    }
  };

  const getOperationDescription = () => {
    switch (operationType) {
      case 'transfer': return 'Send STEEM or SBD to other accounts instantly';
      case 'powerup': return 'Convert STEEM to STEEM Power for increased voting influence';
      case 'powerdown': return 'Start the 13-week power down process';
      case 'savings': return 'Move assets to savings with 3-day withdrawal period';
      case 'withdraw_savings': return 'Withdraw assets from savings (3-day delay)';
      default: return 'Send STEEM or SBD to other accounts instantly';
    }
  };

  const getIcon = () => {
    switch (operationType) {
      case 'transfer': return <ArrowRight className="w-5 h-5" style={{ color: '#07d7a9' }} />;
      case 'powerup': return <TrendingUp className="w-5 h-5" style={{ color: '#07d7a9' }} />;
      case 'powerdown': return <ArrowDown className="w-5 h-5" style={{ color: '#07d7a9' }} />;
      case 'savings': 
      case 'withdraw_savings': return <PiggyBank className="w-5 h-5" style={{ color: '#07d7a9' }} />;
      default: return <ArrowRight className="w-5 h-5" style={{ color: '#07d7a9' }} />;
    }
  };

  const showRecipientField = operationType === 'transfer' || operationType === 'powerup' || operationType === 'savings';
  const showCurrencySelect = operationType === 'transfer' || operationType === 'savings' || operationType === 'withdraw_savings';

  return (
    <div className="space-y-6">
      {/* Login requirement notice */}
      {!isLoggedIn && (
        <Card className="bg-blue-50 border border-blue-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-blue-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-800">Login Required for Operations</p>
                <p className="text-xs text-blue-700">
                  You can view wallet information without logging in, but blockchain operations require authentication for security.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            {getIcon()}
            <div>
              <CardTitle className="text-gray-800">{getOperationTitle()}</CardTitle>
              <CardDescription className="text-gray-600">
                {getOperationDescription()}
                {!isLoggedIn && <span className="text-blue-600"> (Login required to execute)</span>}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={operationType} onValueChange={(value) => setOperationType(value as OperationType)}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="transfer" className="text-xs">Transfer</TabsTrigger>
              <TabsTrigger value="powerup" className="text-xs">Power Up</TabsTrigger>
              <TabsTrigger value="powerdown" className="text-xs">Power Down</TabsTrigger>
              <TabsTrigger value="savings" className="text-xs">To Savings</TabsTrigger>
              <TabsTrigger value="withdraw_savings" className="text-xs">From Savings</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {showRecipientField && (
              <div className="space-y-2">
                <Label htmlFor="recipient" className="text-gray-700">
                  {operationType === 'powerup' ? 'Power Up For (optional)' : 'Recipient Username'}
                </Label>
                <Input
                  id="recipient"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder={operationType === 'powerup' ? "leave empty for self" : "username (without @)"}
                  className="bg-white border-gray-300"
                  disabled={!isLoggedIn}
                />
              </div>
            )}
            
            {showCurrencySelect && (
              <div className="space-y-2">
                <Label htmlFor="currency" className="text-gray-700">Currency</Label>
                <Select value={currency} onValueChange={setCurrency} disabled={!isLoggedIn}>
                  <SelectTrigger className="bg-white border-gray-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-gray-300">
                    <SelectItem value="STEEM">STEEM</SelectItem>
                    <SelectItem value="SBD">SBD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount" className="text-gray-700">
              Amount {operationType === 'powerup' ? '(STEEM)' : operationType === 'powerdown' ? '(STEEM Power)' : ''}
            </Label>
            <Input
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.000"
              className="bg-white border-gray-300"
              disabled={!isLoggedIn}
            />
            <p className="text-sm text-gray-500">
              {isLoggedIn ? (
                operationType === 'powerdown' ? 
                  "Available: 1,250.000 STEEM Power" :
                  `Available: ${currency === "STEEM" ? "1,250.000 STEEM" : "425.750 SBD"}`
              ) : (
                "Login to see your available balance"
              )}
            </p>
          </div>

          {(operationType === 'transfer' || operationType === 'savings' || operationType === 'withdraw_savings') && (
            <div className="space-y-2">
              <Label htmlFor="memo" className="text-gray-700">Memo (Optional)</Label>
              <Textarea
                id="memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Add a note with your transfer..."
                className="bg-white border-gray-300 resize-none"
                rows={3}
                disabled={!isLoggedIn}
              />
            </div>
          )}

          {operationType === 'powerdown' && (
            <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-200">
              <h4 className="font-medium text-yellow-800 mb-2">⚠️ Power Down Information:</h4>
              <ul className="text-sm text-yellow-700 space-y-1">
                <li>• Power down takes 13 weeks to complete</li>
                <li>• You'll receive 1/13 of the amount each week</li>
                <li>• You can cancel power down anytime</li>
                <li>• Reduces your voting influence immediately</li>
              </ul>
            </div>
          )}

          {(operationType === 'savings' || operationType === 'withdraw_savings') && (
            <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
              <h4 className="font-medium text-blue-800 mb-2">💡 Savings Information:</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Savings have a 3-day withdrawal period</li>
                <li>• Extra security for your funds</li>
                <li>• Cannot be transferred instantly</li>
                <li>• Perfect for long-term storage</li>
              </ul>
            </div>
          )}

          <div className="p-4 rounded-lg" style={{ backgroundColor: '#f5f4f5' }}>
            <h4 className="font-medium text-gray-800 mb-2">Operation Summary:</h4>
            <div className="space-y-1 text-sm">
              {showRecipientField && (
                <div className="flex justify-between">
                  <span className="text-gray-600">
                    {operationType === 'powerup' ? 'Power up for:' : 'To:'}
                  </span>
                  <span className="text-gray-800">
                    @{recipient || (operationType === 'powerup' ? 'self' : '...')}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Amount:</span>
                <span className="text-gray-800">
                  {amount || "0.000"} {operationType === 'powerdown' ? 'SP' : currency}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Fee:</span>
                <span style={{ color: '#07d7a9' }}>Free</span>
              </div>
            </div>
          </div>

          <Button 
            onClick={handleOperation} 
            className="w-full text-white"
            style={{ backgroundColor: isLoggedIn ? '#07d7a9' : '#6b7280' }}
            disabled={!amount || (showRecipientField && operationType !== 'powerup' && !recipient)}
          >
            {!isLoggedIn ? (
              <>
                <Lock className="w-4 h-4 mr-2" />
                Login Required - {getOperationTitle()}
              </>
            ) : (
              getOperationTitle()
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-gray-800">Recent Operations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-lg" style={{ backgroundColor: '#f5f4f5' }}>
              <div>
                <p className="text-gray-800 font-medium">Powered up to @self</p>
                <p className="text-sm text-gray-500">2 hours ago</p>
              </div>
              <div className="text-right">
                <p className="text-blue-500 font-medium">+50.000 SP</p>
                <p className="text-sm text-gray-500">Confirmed</p>
              </div>
            </div>
            
            <div className="flex justify-between items-center p-3 rounded-lg" style={{ backgroundColor: '#f5f4f5' }}>
              <div>
                <p className="text-gray-800 font-medium">Sent to @alice</p>
                <p className="text-sm text-gray-500">1 day ago</p>
              </div>
              <div className="text-right">
                <p className="text-red-500 font-medium">-100.000 STEEM</p>
                <p className="text-sm text-gray-500">Confirmed</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <TransferConfirmDialog
        isOpen={isConfirmDialogOpen}
        onClose={() => setIsConfirmDialogOpen(false)}
        recipient={recipient}
        amount={amount}
        currency={currency}
        memo={memo}
        operationType={operationType}
        onSuccess={handleSuccess}
      />
    </div>
  );
};

export default TransferOperations;
