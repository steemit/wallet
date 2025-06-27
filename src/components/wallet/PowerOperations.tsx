import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import * as dsteem from 'dsteem';
import { steemOperations } from '@/services/steemOperations';
import { Lock, Loader2, ArrowDown } from "lucide-react";
import { useSteemAccount } from "@/hooks/useSteemAccount";
import PowerDownStatus from './PowerDownStatus';

const PowerOperations = () => {
  const [powerUpRecipient, setPowerUpRecipient] = useState("");
  const [powerUpAmount, setPowerUpAmount] = useState("");
  const [powerDownAmount, setPowerDownAmount] = useState("");
  const [isProcessingPowerUp, setIsProcessingPowerUp] = useState(false);
  const [isProcessingPowerDown, setIsProcessingPowerDown] = useState(false);
  const { toast } = useToast();

  // Check if user is logged in
  const isLoggedIn = localStorage.getItem('steem_username');
  const username = localStorage.getItem('steem_username');

  const { data: account, refetch } = useSteemAccount(username || '');

  // Check if power down is active
  const isPowerDownActive = account && 
    parseFloat(account.vesting_withdraw_rate?.split(' ')[0] || '0') > 0 && 
    new Date(account.next_vesting_withdrawal) > new Date('1970-01-01');

  const handlePowerUp = async () => {
    if (!isLoggedIn) {
      toast({
        title: "Login Required",
        description: "Please login to perform this operation",
        variant: "destructive",
      });
      return;
    }

    if (!powerUpAmount) {
      toast({
        title: "Missing Information",
        description: "Please enter amount to power up",
        variant: "destructive",
      });
      return;
    }

    const loginMethod = localStorage.getItem('steem_login_method');
    
    setIsProcessingPowerUp(true);

    try {
      const operation = {
        from: username!,
        to: powerUpRecipient || username!,
        amount: `${powerUpAmount} STEEM`
      };

      if (loginMethod === 'keychain') {
        await handleKeychainPowerUp(username!, operation);
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyPowerUp(operation);
      }
    } catch (error) {
      console.error('Power up error:', error);
      toast({
        title: "Operation Failed",
        description: "Failed to power up. Please try again.",
        variant: "destructive",
      });
      setIsProcessingPowerUp(false);
    }
  };

  const handlePowerDown = async () => {
    if (!isLoggedIn) {
      toast({
        title: "Login Required",
        description: "Please login to perform this operation",
        variant: "destructive",
      });
      return;
    }

    if (isPowerDownActive) {
      toast({
        title: "Power Down Already Active",
        description: "You already have an active power down. Cancel it first to start a new one.",
        variant: "destructive",
      });
      return;
    }

    if (!powerDownAmount) {
      toast({
        title: "Missing Information",
        description: "Please enter amount to power down",
        variant: "destructive",
      });
      return;
    }

    const loginMethod = localStorage.getItem('steem_login_method');
    
    setIsProcessingPowerDown(true);

    try {
      const vestsAmount = await steemOperations.convertSteemToVests(`${powerDownAmount} STEEM`);

      if (loginMethod === 'keychain') {
        await handleKeychainPowerDown(username!, vestsAmount);
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyPowerDown(username!, vestsAmount);
      }
    } catch (error) {
      console.error('Power down error:', error);
      toast({
        title: "Operation Failed",
        description: "Failed to power down. Please try again.",
        variant: "destructive",
      });
      setIsProcessingPowerDown(false);
    }
  };

  const handleKeychainPowerUp = async (username: string, operation: any) => {
    if (!window.steem_keychain) {
      toast({
        title: "Keychain Not Available",
        description: "Steem Keychain not found",
        variant: "destructive",
      });
      setIsProcessingPowerUp(false);
      return;
    }

    try {
      window.steem_keychain.requestBroadcast(
        username,
        [['transfer_to_vesting', operation]],
        'Active',
        (response: any) => {
          if (response.success) {
            toast({
              title: "Power Up Successful",
              description: `${powerUpAmount} STEEM has been powered up`,
            });
            setPowerUpAmount("");
            setPowerUpRecipient("");
            refetch();
          } else {
            toast({
              title: "Operation Failed",
              description: response.message || "Transaction was rejected",
              variant: "destructive",
            });
          }
          setIsProcessingPowerUp(false);
        }
      );
    } catch (error: any) {
      toast({
        title: "Operation Failed",
        description: error.message || "Failed to process operation",
        variant: "destructive",
      });
      setIsProcessingPowerUp(false);
    }
  };

  const handleKeychainPowerDown = async (username: string, vestsAmount: string) => {
    if (!window.steem_keychain) {
      toast({
        title: "Keychain Not Available",
        description: "Steem Keychain not found",
        variant: "destructive",
      });
      setIsProcessingPowerDown(false);
      return;
    }

    try {
      window.steem_keychain.requestBroadcast(
        username,
        [['withdraw_vesting', { account: username, vesting_shares: vestsAmount }]],
        'Active',
        (response: any) => {
          if (response.success) {
            toast({
              title: "Power Down Initiated",
              description: `${powerDownAmount} STEEM power down started`,
            });
            setPowerDownAmount("");
            refetch();
          } else {
            toast({
              title: "Operation Failed",
              description: response.message || "Transaction was rejected",
            });
          }
          setIsProcessingPowerDown(false);
        }
      );
    } catch (error: any) {
      toast({
        title: "Operation Failed",
        description: error.message || "Failed to process operation",
      });
      setIsProcessingPowerDown(false);
    }
  };

  const handlePrivateKeyPowerUp = async (operation: any) => {
    const privateKeyString = localStorage.getItem('steem_active_key');
    if (!privateKeyString) {
      toast({
        title: "Private Key Not Found",
        description: "Active key required for this operation",
        variant: "destructive",
      });
      setIsProcessingPowerUp(false);
      return;
    }

    try {
      const privateKey = dsteem.PrivateKey.fromString(privateKeyString);
      await steemOperations.powerUp(operation, privateKey);
      
      toast({
        title: "Power Up Successful",
        description: `${powerUpAmount} STEEM has been powered up`,
      });
      setPowerUpAmount("");
      setPowerUpRecipient("");
      refetch();
      setIsProcessingPowerUp(false);
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
      setIsProcessingPowerUp(false);
    }
  };

  const handlePrivateKeyPowerDown = async (username: string, vestsAmount: string) => {
    const privateKeyString = localStorage.getItem('steem_active_key');
    if (!privateKeyString) {
      toast({
        title: "Private Key Not Found",
        description: "Active key required for this operation",
        variant: "destructive",
      });
      setIsProcessingPowerDown(false);
      return;
    }

    try {
      const privateKey = dsteem.PrivateKey.fromString(privateKeyString);
      await steemOperations.powerDown(username, vestsAmount, privateKey);
      
      toast({
        title: "Power Down Initiated",
        description: `${powerDownAmount} STEEM power down started`,
      });
      setPowerDownAmount("");
      refetch();
      setIsProcessingPowerDown(false);
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
      setIsProcessingPowerDown(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Login requirement notice */}
      {!isLoggedIn && (
        <Card className="bg-blue-50 border border-blue-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-blue-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-800">Login Required</p>
                <p className="text-xs text-blue-700">
                  You must be logged in to perform power operations.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Power Down Status */}
      {isLoggedIn && account && (
        <PowerDownStatus 
          account={account} 
          onUpdate={() => {
            refetch();
          }} 
        />
      )}

      {/* Power Up Operations */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-gray-800">Power Up</CardTitle>
          <CardDescription className="text-gray-600">
            Convert STEEM to STEEM Power
            {!isLoggedIn && <span className="text-blue-600"> (Login required)</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="power-up-recipient" className="text-gray-700">Recipient (optional)</Label>
            <Input
              id="power-up-recipient"
              value={powerUpRecipient}
              onChange={(e) => setPowerUpRecipient(e.target.value)}
              placeholder="username (leave empty to power up to yourself)"
              className="bg-white border-gray-300"
              disabled={!isLoggedIn || isProcessingPowerUp}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="power-up-amount" className="text-gray-700">Amount (STEEM)</Label>
            <Input
              id="power-up-amount"
              type="number"
              value={powerUpAmount}
              onChange={(e) => setPowerUpAmount(e.target.value)}
              placeholder="0.000"
              step="0.001"
              className="bg-white border-gray-300"
              disabled={!isLoggedIn || isProcessingPowerUp}
            />
          </div>
          <Button 
            onClick={handlePowerUp}
            className="w-full text-white"
            style={{ backgroundColor: isLoggedIn ? '#07d7a9' : '#6b7280' }}
            disabled={!isLoggedIn || !powerUpAmount || isProcessingPowerUp}
          >
            {!isLoggedIn ? (
              <>
                <Lock className="w-4 h-4 mr-2" />
                Login Required
              </>
            ) : isProcessingPowerUp ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              'Power Up'
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Power Down Operations */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-gray-800">Power Down</CardTitle>
          <CardDescription className="text-gray-600">
            Convert STEEM Power to STEEM
            {!isLoggedIn && <span className="text-blue-600"> (Login required)</span>}
            {isPowerDownActive && <span className="text-orange-600"> (Already active - cancel first)</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="power-down-amount" className="text-gray-700">Amount (SP)</Label>
            <Input
              id="power-down-amount"
              type="number"
              value={powerDownAmount}
              onChange={(e) => setPowerDownAmount(e.target.value)}
              placeholder="0.000"
              step="0.001"
              className="bg-white border-gray-300"
              disabled={!isLoggedIn || isProcessingPowerDown || isPowerDownActive}
            />
          </div>
          <Button
            onClick={handlePowerDown}
            className="w-full text-white"
            style={{ backgroundColor: isLoggedIn && !isPowerDownActive ? '#07d7a9' : '#6b7280' }}
            disabled={!isLoggedIn || !powerDownAmount || isProcessingPowerDown || isPowerDownActive}
          >
            {!isLoggedIn ? (
              <>
                <Lock className="w-4 h-4 mr-2" />
                Login Required
              </>
            ) : isPowerDownActive ? (
              <>
                <ArrowDown className="w-4 h-4 mr-2" />
                Power Down Active
              </>
            ) : isProcessingPowerDown ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              'Power Down'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default PowerOperations;
