
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ArrowRight, Lock, Trash2, Info, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as dsteem from 'dsteem';
import { steemOperations } from '@/services/steemOperations';
import { steemApi } from '@/services/steemApi';

const WithdrawRouteOperations = () => {
  const [recipient, setRecipient] = useState("");
  const [percentage, setPercentage] = useState(0);
  const [autoVest, setAutoVest] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentRoutes, setCurrentRoutes] = useState<any[]>([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  
  const { toast } = useToast();

  // Check if user is logged in
  const isLoggedIn = localStorage.getItem('steem_username');
  const username = localStorage.getItem('steem_username');

  // Load current withdraw routes
  useEffect(() => {
    if (isLoggedIn && username) {
      loadWithdrawRoutes();
    }
  }, [isLoggedIn, username]);

  const loadWithdrawRoutes = async () => {
    if (!username) return;
    
    setIsLoadingRoutes(true);
    try {
      const routes = await steemApi.getWithdrawVestingRoutes(username);
      setCurrentRoutes(routes);
    } catch (error) {
      console.error('Error loading withdraw routes:', error);
      // Continue with empty routes instead of showing error
      setCurrentRoutes([]);
    } finally {
      setIsLoadingRoutes(false);
    }
  };

  const handleSetWithdrawRoute = async () => {
    if (!isLoggedIn) {
      toast({
        title: "Login Required",
        description: "Please login to perform this operation",
        variant: "destructive",
      });
      return;
    }

    if (!recipient.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter recipient account",
        variant: "destructive",
      });
      return;
    }

    if (percentage < 0 || percentage > 100) {
      toast({
        title: "Invalid Percentage",
        description: "Percentage must be between 0 and 100",
        variant: "destructive",
      });
      return;
    }

    const loginMethod = localStorage.getItem('steem_login_method');
    
    setIsProcessing(true);

    try {
      // Convert percentage to basis points (Steem uses 0-10000, where 10000 = 100%)
      const basisPoints = Math.round(percentage * 100);
      
      const operation = {
        from_account: username!,
        to_account: recipient.trim(),
        percent: basisPoints,
        auto_vest: autoVest
      };

      console.log('Setting withdraw route with operation:', operation);

      if (loginMethod === 'keychain') {
        await handleKeychainOperation(username!, operation);
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyOperation(username!, operation);
      }
    } catch (error) {
      console.error('Withdraw route error:', error);
      toast({
        title: "Operation Failed",
        description: "Failed to set withdraw route. Please try again.",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const handleRemoveRoute = async (toAccount: string) => {
    if (!isLoggedIn || !username) return;

    const loginMethod = localStorage.getItem('steem_login_method');
    
    setIsProcessing(true);

    try {
      const operation = {
        from_account: username,
        to_account: toAccount,
        percent: 0, // Set to 0 to remove route
        auto_vest: false
      };

      console.log('Removing withdraw route with operation:', operation);

      if (loginMethod === 'keychain') {
        await handleKeychainOperation(username, operation);
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyOperation(username, operation);
      }
    } catch (error) {
      console.error('Remove route error:', error);
      toast({
        title: "Operation Failed",
        description: "Failed to remove withdraw route. Please try again.",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const handleKeychainOperation = async (username: string, operation: any) => {
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
      console.log('Sending withdraw route operation to Keychain:', operation);

      window.steem_keychain.requestBroadcast(
        username,
        [['set_withdraw_vesting_route', operation]],
        'Active',
        (response: any) => {
          console.log('Keychain withdraw route response:', response);
          
          if (response.success) {
            if (operation.percent === 0) {
              toast({
                title: "Route Removed",
                description: `Withdraw route to @${operation.to_account} has been removed`,
              });
            } else {
              toast({
                title: "Withdraw Route Set",
                description: `${(operation.percent / 100).toFixed(1)}% of power down will go to @${operation.to_account}${operation.auto_vest ? ' (auto-vested)' : ''}`,
              });
            }
            
            // Reset form and reload routes
            setRecipient("");
            setPercentage(0);
            setAutoVest(false);
            setTimeout(() => loadWithdrawRoutes(), 2000); // Reload after 2 seconds
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
      console.error('Keychain withdraw route error:', error);
      toast({
        title: "Operation Failed",
        description: error.message || "Failed to process operation",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const handlePrivateKeyOperation = async (username: string, operation: any) => {
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
      console.log('Executing withdraw route operation with private key:', operation);
      
      const result = await steemOperations.setWithdrawVestingRoute(operation, privateKey);
      console.log('Withdraw route operation result:', result);
      
      if (operation.percent === 0) {
        toast({
          title: "Route Removed",
          description: `Withdraw route to @${operation.to_account} has been removed`,
        });
      } else {
        toast({
          title: "Withdraw Route Set",
          description: `${(operation.percent / 100).toFixed(1)}% of power down will go to @${operation.to_account}${operation.auto_vest ? ' (auto-vested)' : ''}`,
        });
      }
      
      // Reset form and reload routes
      setRecipient("");
      setPercentage(0);
      setAutoVest(false);
      setTimeout(() => loadWithdrawRoutes(), 2000); // Reload after 2 seconds
      setIsProcessing(false);
      
    } catch (error: any) {
      console.error('Private key withdraw route error:', error);
      
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
                  You must be logged in to manage withdraw vesting routes.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Routes */}
      {isLoggedIn && (
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-gray-800">Current Withdraw Routes</CardTitle>
            <CardDescription className="text-gray-600">
              Your active power down routing configurations
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingRoutes ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-gray-600">Loading routes...</span>
              </div>
            ) : currentRoutes.length > 0 ? (
              <div className="space-y-3">
                {currentRoutes.map((route, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">@{route.to_account}</span>
                        {route.auto_vest && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                            Auto Vest
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{(route.percent / 100).toFixed(1)}% of power down</p>
                    </div>
                    <Button
                      onClick={() => handleRemoveRoute(route.to_account)}
                      variant="outline"
                      size="sm"
                      className="border-red-300 text-red-600 hover:bg-red-50"
                      disabled={isProcessing}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">No active withdraw routes</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Set New Route */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ArrowRight className="w-5 h-5" style={{ color: '#07d7a9' }} />
            <div>
              <CardTitle className="text-gray-800">Set Withdraw Vesting Route</CardTitle>
              <CardDescription className="text-gray-600">
                Route your power down payments to another account
                {!isLoggedIn && <span className="text-blue-600"> (Login required)</span>}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recipient" className="text-gray-700">Recipient Account</Label>
            <Input
              id="recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="username (without @)"
              className="bg-white border-gray-300"
              disabled={!isLoggedIn || isProcessing}
            />
          </div>
          
          <div className="space-y-3">
            <Label className="text-gray-700">Percentage (%)</Label>
            <div className="px-3">
              <Slider
                value={[percentage]}
                onValueChange={(value) => setPercentage(value[0])}
                max={100}
                min={0}
                step={0.1}
                className="w-full"
                disabled={!isLoggedIn || isProcessing}
              />
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>0%</span>
              <span className="font-medium text-gray-700">{percentage.toFixed(1)}%</span>
              <span>100%</span>
            </div>
            <Input
              type="number"
              value={percentage}
              onChange={(e) => setPercentage(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
              placeholder="0-100"
              min="0"
              max="100"
              step="0.1"
              className="bg-white border-gray-300"
              disabled={!isLoggedIn || isProcessing}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="auto-vest"
              checked={autoVest}
              onCheckedChange={setAutoVest}
              disabled={!isLoggedIn || isProcessing}
            />
            <Label htmlFor="auto-vest" className="text-gray-700">
              Auto Vest (Convert to STEEM Power automatically)
            </Label>
          </div>

          <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-800 mb-2">How it works:</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• {percentage.toFixed(1)}% = {Math.round(percentage * 100)} basis points</li>
                  <li>• Steem uses basis points (0-10,000 where 10,000 = 100%)</li>
                  <li>• Set to 0% to remove an existing route</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-200">
            <h4 className="font-medium text-yellow-800 mb-2">⚠️ Important Notes:</h4>
            <ul className="text-sm text-yellow-700 space-y-1">
              <li>• Routes percentage of weekly power down to recipient</li>
              <li>• Remaining percentage comes to your account</li>
              <li>• Multiple routes can be set (total ≤ 100%)</li>
              <li>• Auto vest converts routed amount to STEEM Power</li>
              <li>• Routes persist until manually changed or removed</li>
              <li>• Requires active authority to set routes</li>
            </ul>
          </div>

          <div className="p-4 rounded-lg" style={{ backgroundColor: '#f5f4f5' }}>
            <h4 className="font-medium text-gray-800 mb-2">Route Preview:</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">To:</span>
                <span className="text-gray-800">@{recipient || '...'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Percentage:</span>
                <span className="text-gray-800">{percentage.toFixed(1)}% ({Math.round(percentage * 100)} basis points)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Auto Vest:</span>
                <span className="text-gray-800">{autoVest ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Remaining to you:</span>
                <span className="text-gray-800">{(100 - percentage).toFixed(1)}%</span>
              </div>
            </div>
          </div>

          <Button 
            onClick={handleSetWithdrawRoute}
            className="w-full text-white"
            style={{ backgroundColor: isLoggedIn ? '#07d7a9' : '#6b7280' }}
            disabled={!isLoggedIn || !recipient.trim() || isProcessing}
          >
            {!isLoggedIn ? (
              <>
                <Lock className="w-4 h-4 mr-2" />
                Login Required
              </>
            ) : isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : percentage === 0 ? (
              'Remove Route'
            ) : (
              'Set Withdraw Route'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default WithdrawRouteOperations;
