
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Users, TrendingUp, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDelegations } from "@/hooks/useDelegations";
import { steemOperations } from '@/services/steemOperations';
import * as dsteem from 'dsteem';
import DelegationEditDialog from "./DelegationEditDialog";

const DelegationOperations = () => {
  const { username: urlUsername } = useParams();
  const [delegateAmount, setDelegateAmount] = useState("");
  const [delegateRecipient, setDelegateRecipient] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  // Get the account to display (from URL or localStorage)
  const displayUsername = urlUsername?.replace('@', '') || localStorage.getItem('steem_username');
  const loggedInUsername = localStorage.getItem('steem_username');
  const isOwnAccount = loggedInUsername && displayUsername === loggedInUsername;

  const {
    outgoingDelegations,
    isLoading,
    error,
    totalDelegatedOut,
    steemPerMvests,
    refetchAll
  } = useDelegations(displayUsername);

  const handleDelegate = async () => {
    if (!delegateRecipient || !delegateAmount || !loggedInUsername || !isOwnAccount) return;

    const loginMethod = localStorage.getItem('steem_login_method');
    setIsProcessing(true);

    try {
      // Convert SP to VESTS
      const steemAmount = parseFloat(delegateAmount);
      const vestsAmount = (steemAmount * 1000000) / steemPerMvests;
      const vestingShares = `${vestsAmount.toFixed(6)} VESTS`;

      if (loginMethod === 'keychain') {
        await handleKeychainDelegation(loggedInUsername, delegateRecipient, vestingShares);
      } else {
        await handlePrivateKeyDelegation(loggedInUsername, delegateRecipient, vestingShares);
      }
    } catch (error) {
      console.error('Delegation error:', error);
      toast({
        title: "Operation Failed",
        description: "Failed to delegate STEEM Power. Please try again.",
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
            title: "Delegation Successful",
            description: `Delegated ${delegateAmount} SP to @${delegatee}`,
          });
          setDelegateRecipient("");
          setDelegateAmount("");
          refetchAll();
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
      title: "Delegation Successful",
      description: `Delegated ${delegateAmount} SP to @${delegatee}`,
    });
    setDelegateRecipient("");
    setDelegateAmount("");
    refetchAll();
  };

  if (error) {
    return (
      <Card className="bg-red-50 border-red-200">
        <CardContent className="p-4">
          <p className="text-red-800">Error loading delegation data: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-white shadow-sm border border-gray-200">
          <TabsTrigger 
            value="overview" 
            className="data-[state=active]:text-white data-[state=active]:bg-[#07d7a9] text-xs sm:text-sm"
          >
            <TrendingUp className="w-4 h-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Overview</span>
            <span className="sm:hidden">Stats</span>
          </TabsTrigger>
          <TabsTrigger 
            value="outgoing" 
            className="data-[state=active]:text-white data-[state=active]:bg-[#07d7a9] text-xs sm:text-sm"
          >
            <ArrowRight className="w-4 h-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">My Delegations</span>
            <span className="sm:hidden">My Del.</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-gray-800 text-lg">Total Delegated Out</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="animate-pulse">
                    <div className="h-8 bg-gray-200 rounded mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded"></div>
                  </div>
                ) : (
                  <>
                    <p className="text-xl sm:text-2xl font-bold" style={{ color: '#07d7a9' }}>
                      {totalDelegatedOut.toFixed(3)} SP
                    </p>
                    <p className="text-xs sm:text-sm text-gray-500">To {outgoingDelegations.length} accounts</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-gray-800 text-lg">Available to Delegate</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl sm:text-2xl font-bold" style={{ color: '#07d7a9' }}>
                  Check Wallet
                </p>
                <p className="text-xs sm:text-sm text-gray-500">Your current STEEM Power</p>
              </CardContent>
            </Card>
          </div>

          {/* Only show delegation form for logged-in users on their own account */}
          {isOwnAccount && (
            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-gray-800 flex items-center gap-2 text-lg sm:text-xl">
                  <Users className="w-5 h-5" style={{ color: '#07d7a9' }} />
                  New Delegation
                </CardTitle>
                <CardDescription className="text-gray-500 text-sm sm:text-base">
                  Delegate STEEM Power to support content creators and curators
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="delegate-recipient" className="text-gray-700">Recipient Username</Label>
                    <Input
                      id="delegate-recipient"
                      value={delegateRecipient}
                      onChange={(e) => setDelegateRecipient(e.target.value)}
                      placeholder="username"
                      className="border-gray-300"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="delegate-amount" className="text-gray-700">Amount (SP)</Label>
                    <Input
                      id="delegate-amount"
                      value={delegateAmount}
                      onChange={(e) => setDelegateAmount(e.target.value)}
                      placeholder="0.000"
                      type="number"
                      step="0.001"
                      className="border-gray-300"
                    />
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 p-3 sm:p-4 rounded-lg">
                  <h4 className="font-medium text-blue-800 mb-2 text-sm sm:text-base">💡 Delegation Benefits:</h4>
                  <ul className="text-xs sm:text-sm text-blue-700 space-y-1">
                    <li>• Help others with voting power</li>
                    <li>• Support content creators and curators</li>
                    <li>• Can be removed anytime (7-day return period)</li>
                    <li>• You maintain ownership of your SP</li>
                  </ul>
                </div>

                <Button 
                  onClick={handleDelegate} 
                  className="w-full text-white text-sm sm:text-base"
                  style={{ backgroundColor: '#07d7a9' }}
                  disabled={!delegateRecipient || !delegateAmount || isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Delegating...
                    </>
                  ) : (
                    'Delegate STEEM Power'
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="outgoing" className="space-y-4">
          <Card className="bg-white border border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-gray-800 text-lg sm:text-xl">
                My Delegations
                {displayUsername && (
                  <span className="text-sm font-normal text-gray-500 ml-2">by @{displayUsername}</span>
                )}
              </CardTitle>
              <CardDescription className="text-gray-500 text-sm sm:text-base">
                STEEM Power delegated to others
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-3 sm:p-4 animate-pulse">
                      <div className="flex justify-between items-center">
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-200 rounded w-24"></div>
                          <div className="h-3 bg-gray-200 rounded w-32"></div>
                        </div>
                        <div className="h-8 bg-gray-200 rounded w-16"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : outgoingDelegations.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">No delegations found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {outgoingDelegations.map((delegation, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-3 sm:p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900 truncate text-sm sm:text-base">@{delegation.delegatee}</span>
                            <Badge variant="outline" className="text-[#07d7a9] border-[#07d7a9] text-xs">
                              Active
                            </Badge>
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs sm:text-sm text-gray-500">
                            <span className="font-medium">{delegation.steemPower} SP</span>
                            <span className="hidden sm:inline">•</span>
                            <span>Since {delegation.formattedDate}</span>
                          </div>
                        </div>
                        {/* Only show edit button for own account */}
                        {isOwnAccount && (
                          <div className="flex gap-2">
                            <DelegationEditDialog 
                              delegation={delegation} 
                              onSuccess={refetchAll}
                              steemPerMvests={steemPerMvests}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DelegationOperations;
