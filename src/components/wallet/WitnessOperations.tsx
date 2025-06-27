import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Users, Vote, UserCheck, Settings, ExternalLink, AlertCircle, Info, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWitnessData } from "@/hooks/useWitnesses";
import { useSteemAccount } from '@/hooks/useSteemAccount';
import { steemOperations } from '@/services/steemOperations';
import { useQueryClient } from '@tanstack/react-query';
import * as dsteem from 'dsteem';

interface WitnessOperationsProps {
  loggedInUser?: string | null;
}

const WitnessOperations = ({ loggedInUser }: WitnessOperationsProps) => {
  const [proxyAccount, setProxyAccount] = useState("");
  const [filterVotes, setFilterVotes] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingWitness, setProcessingWitness] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { witnesses, isLoading, error, userVoteCount } = useWitnessData(loggedInUser);
  const { data: userAccountData } = useSteemAccount(loggedInUser || '');

  const currentProxy = userAccountData?.proxy || '';
  const filteredWitnesses = filterVotes ? witnesses.filter(w => w.voted) : witnesses;

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['witnesses'] });
    queryClient.invalidateQueries({ queryKey: ['userWitnessVotes', loggedInUser] });
    queryClient.invalidateQueries({ queryKey: ['account', loggedInUser] });
  };

  const handleVote = async (witnessName: string, isVoting: boolean) => {
    if (!loggedInUser) {
      toast({
        title: "Login Required",
        description: "Please log in to vote for witnesses",
        variant: "destructive",
      });
      return;
    }

    setProcessingWitness(witnessName);
    const loginMethod = localStorage.getItem('steem_login_method');

    try {
      if (loginMethod === 'keychain') {
        await handleKeychainWitnessVote(loggedInUser, witnessName, isVoting);
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyWitnessVote(loggedInUser, witnessName, isVoting);
      }
    } catch (error) {
      console.error('Witness vote error:', error);
    } finally {
      setProcessingWitness(null);
    }
  };

  const handleKeychainWitnessVote = async (account: string, witness: string, approve: boolean) => {
    if (!window.steem_keychain) {
      toast({
        title: "Keychain Not Available",
        description: "Steem Keychain not found",
        variant: "destructive",
      });
      return;
    }

    window.steem_keychain.requestBroadcast(
      account,
      [['account_witness_vote', { account, witness, approve }]],
      'Active',
      (response: any) => {
        if (response.success) {
          toast({
            title: "Vote Successful",
            description: `${approve ? "Voted for" : "Removed vote from"} witness @${witness}`,
          });
          // Invalidate queries to refresh data
          setTimeout(() => {
            invalidateQueries();
          }, 1000);
        } else {
          toast({
            title: "Vote Failed",
            description: response.message || "Transaction was rejected",
            variant: "destructive",
          });
        }
      }
    );
  };

  const handlePrivateKeyWitnessVote = async (account: string, witness: string, approve: boolean) => {
    const privateKeyString = localStorage.getItem('steem_active_key');
    if (!privateKeyString) {
      toast({
        title: "Private Key Not Found",
        description: "Private key not found",
        variant: "destructive",
      });
      return;
    }

    try {
      const privateKey = dsteem.PrivateKey.fromString(privateKeyString);
      await steemOperations.voteWitness(account, witness, approve, privateKey);
      
      toast({
        title: "Vote Successful",
        description: `${approve ? "Voted for" : "Removed vote from"} witness @${witness}`,
      });
      
      // Invalidate queries to refresh data
      setTimeout(() => {
        invalidateQueries();
      }, 1000);
    } catch (error: any) {
      console.error('Witness vote error:', error);
      toast({
        title: "Vote Failed",
        description: error.message || "Failed to vote for witness",
        variant: "destructive",
      });
    }
  };

  const handleSetProxy = async () => {
    if (!proxyAccount) return;
    if (!loggedInUser) {
      toast({
        title: "Login Required",
        description: "Please log in to set a witness proxy",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    const loginMethod = localStorage.getItem('steem_login_method');

    try {
      if (loginMethod === 'keychain') {
        await handleKeychainProxy(loggedInUser, proxyAccount);
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyProxy(loggedInUser, proxyAccount);
      }
    } catch (error) {
      console.error('Proxy set error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveProxy = async () => {
    if (!loggedInUser || !currentProxy) return;

    setIsProcessing(true);
    const loginMethod = localStorage.getItem('steem_login_method');

    try {
      if (loginMethod === 'keychain') {
        await handleKeychainProxy(loggedInUser, '');
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyProxy(loggedInUser, '');
      }
    } catch (error) {
      console.error('Proxy remove error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeychainProxy = async (account: string, proxy: string) => {
    if (!window.steem_keychain) {
      toast({
        title: "Keychain Not Available",
        description: "Steem Keychain not found",
        variant: "destructive",
      });
      return;
    }

    window.steem_keychain.requestBroadcast(
      account,
      [['account_witness_proxy', { account, proxy }]],
      'Active',
      (response: any) => {
        if (response.success) {
          toast({
            title: "Proxy Updated",
            description: proxy ? `Set @${proxy} as your witness proxy` : "Removed witness proxy",
          });
          if (proxy) setProxyAccount("");
          
          // Invalidate queries to refresh data
          setTimeout(() => {
            invalidateQueries();
          }, 1000);
        } else {
          toast({
            title: "Proxy Update Failed",
            description: response.message || "Transaction was rejected",
            variant: "destructive",
          });
        }
      }
    );
  };

  const handlePrivateKeyProxy = async (account: string, proxy: string) => {
    const privateKeyString = localStorage.getItem('steem_active_key');
    if (!privateKeyString) {
      toast({
        title: "Private Key Not Found",
        description: "Private key not found",
        variant: "destructive",
      });
      return;
    }

    try {
      const privateKey = dsteem.PrivateKey.fromString(privateKeyString);
      
      if (proxy) {
        await steemOperations.setWitnessProxy(account, proxy, privateKey);
      } else {
        await steemOperations.removeWitnessProxy(account, privateKey);
      }
      
      toast({
        title: "Proxy Updated",
        description: proxy ? `Set @${proxy} as your witness proxy` : "Removed witness proxy",
      });
      
      if (proxy) setProxyAccount("");
      
      // Invalidate queries to refresh data
      setTimeout(() => {
        invalidateQueries();
      }, 1000);
    } catch (error: any) {
      console.error('Proxy update error:', error);
      toast({
        title: "Proxy Update Failed",
        description: error.message || "Failed to update proxy",
        variant: "destructive",
      });
    }
  };

  const handleWitnessInfo = (witnessUrl: string, witnessName: string) => {
    if (witnessUrl && witnessUrl !== '') {
      window.open(witnessUrl, '_blank');
    } else {
      toast({
        title: "No Information Available",
        description: `@${witnessName} has not provided a witness information URL`,
      });
    }
  };

  if (error) {
    return (
      <Card className="bg-red-50 border-red-200">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-red-800">
            <AlertCircle className="w-5 h-5" />
            <p className="font-medium">Error loading witness data: {error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4 sm:space-y-6">
        <Tabs defaultValue="witnesses" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-white shadow-sm border border-gray-200">
            <TabsTrigger 
              value="witnesses" 
              className="data-[state=active]:text-white data-[state=active]:bg-[#07d7a9] text-sm sm:text-base"
            >
              <Users className="w-4 h-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Witnesses</span>
              <span className="sm:hidden">Vote</span>
            </TabsTrigger>
            <TabsTrigger 
              value="proxy" 
              className="data-[state=active]:text-white data-[state=active]:bg-[#07d7a9] text-sm sm:text-base"
            >
              <Settings className="w-4 h-4 mr-1 sm:mr-2" />
              Proxy
            </TabsTrigger>
          </TabsList>

          <TabsContent value="witnesses" className="space-y-4">
            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-gray-800 flex items-center gap-2 text-lg sm:text-xl">
                  <Vote className="w-5 h-5" style={{ color: '#07d7a9' }} />
                  Witness Voting
                </CardTitle>
                <CardDescription className="text-gray-500 text-sm sm:text-base">
                  Vote for up to 30 witnesses to secure the Steem blockchain
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 sm:items-center">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="filter-votes"
                      checked={filterVotes}
                      onCheckedChange={setFilterVotes}
                    />
                    <Label htmlFor="filter-votes" className="text-sm">Show only my votes</Label>
                  </div>
                  <div className="text-sm text-gray-500">
                    {loggedInUser ? `Voted: ${userVoteCount}/30` : 'Login to see your votes'}
                  </div>
                </div>

                {/* Show proxy warning if user has a proxy set */}
                {currentProxy && (
                  <div className="bg-orange-50 border border-orange-200 p-3 rounded-lg">
                    <div className="flex items-center gap-2 text-orange-800">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        Proxy Active: @{currentProxy} is voting for you
                      </span>
                    </div>
                  </div>
                )}

                {isLoading ? (
                  <div className="space-y-3">
                    {[...Array(10)].map((_, i) => (
                      <div key={i} className="border border-gray-200 rounded-lg p-3 sm:p-4 animate-pulse">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                          </div>
                          <div className="flex gap-2">
                            <div className="h-8 w-16 bg-gray-200 rounded"></div>
                            <div className="h-8 w-12 bg-gray-200 rounded"></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2 sm:space-y-3">
                    {filteredWitnesses.map((witness) => {
                      return (
                        <div key={witness.name} className={`border border-gray-200 rounded-lg p-3 sm:p-4 ${witness.isDisabled ? 'opacity-60' : ''}`}>
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 sm:mb-2">
                                <span className={`font-medium text-gray-800 text-sm sm:text-base ${witness.isDisabled ? 'line-through' : ''}`}>#{witness.rank}</span>
                                <span className={`font-semibold text-gray-900 truncate text-sm sm:text-base ${witness.isDisabled ? 'line-through' : ''}`}>@{witness.name}</span>
                                {witness.voted && (
                                  <Badge className="bg-[#07d7a9] text-white text-xs">
                                    <UserCheck className="w-3 h-3 mr-1" />
                                    Voted
                                  </Badge>
                                )}
                                {witness.isDisabledByKey && (
                                  <Badge variant="outline" className="text-red-500 border-red-300 text-xs">
                                    Disabled
                                  </Badge>
                                )}
                                {witness.hasInvalidVersion && (
                                  <>
                                    <Badge variant="outline" className="text-orange-500 border-orange-300 text-xs">
                                      Invalid Version
                                    </Badge>
                                    <Badge variant="outline" className="text-red-500 border-red-300 text-xs">
                                      Rejected
                                    </Badge>
                                  </>
                                )}
                              </div>
                              <div className={`flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs sm:text-sm text-gray-500 ${witness.isDisabled ? 'line-through' : ''}`}>
                                <div className="flex items-center gap-1">
                                  <span>Votes: {witness.votes}</span>
                                </div>
                                <span className="hidden sm:inline">•</span>
                                <span>Version: {witness.version}</span>
                                <span className="hidden sm:inline">•</span>
                                <span>Missed: {witness.missedBlocks}</span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant={witness.voted ? "destructive" : "default"}
                                onClick={() => handleVote(witness.name, !witness.voted)}
                                className={`text-xs sm:text-sm px-2 sm:px-4 ${
                                  !witness.voted 
                                    ? 'text-white' 
                                    : ''
                                }`}
                                style={!witness.voted ? { backgroundColor: '#07d7a9' } : {}}
                                disabled={!loggedInUser || !!currentProxy || processingWitness === witness.name}
                              >
                                {processingWitness === witness.name ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  witness.voted ? "Unvote" : "Vote"
                                )}
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="text-xs sm:text-sm px-2 sm:px-3"
                                onClick={() => handleWitnessInfo(witness.url, witness.name)}
                              >
                                <ExternalLink className="w-3 h-3 mr-1" />
                                Info
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="proxy" className="space-y-4">
            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-gray-800 flex items-center gap-2 text-lg sm:text-xl">
                  <Settings className="w-5 h-5" style={{ color: '#07d7a9' }} />
                  Witness Voting Proxy
                </CardTitle>
                <CardDescription className="text-gray-500 text-sm sm:text-base">
                  Delegate your witness voting power to a trusted account
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="proxy-account" className="text-gray-700">Proxy Account</Label>
                  <Input
                    id="proxy-account"
                    value={proxyAccount}
                    onChange={(e) => setProxyAccount(e.target.value)}
                    placeholder="username"
                    className="border-gray-300"
                    disabled={isProcessing}
                  />
                </div>

                <div className="bg-blue-50 border border-blue-200 p-3 sm:p-4 rounded-lg">
                  <h4 className="font-medium text-blue-800 mb-2 text-sm sm:text-base">ℹ️ About Proxy Voting:</h4>
                  <ul className="text-xs sm:text-sm text-blue-700 space-y-1">
                    <li>• Your proxy will vote for witnesses on your behalf</li>
                    <li>• You can change or remove your proxy anytime</li>
                    <li>• Setting a proxy removes all your individual votes</li>
                    <li>• Choose someone you trust with voting decisions</li>
                  </ul>
                </div>

                <div className="bg-gray-50 border border-gray-200 p-3 sm:p-4 rounded-lg">
                  <h4 className="font-medium text-gray-800 mb-2 text-sm sm:text-base">Current Proxy:</h4>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 text-sm">Set to:</span>
                    <Badge variant={currentProxy ? "default" : "outline"} className={currentProxy ? "bg-[#07d7a9] text-white" : "text-gray-500 border-gray-400"}>
                      {currentProxy || "None"}
                    </Badge>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button 
                    onClick={handleSetProxy} 
                    className="flex-1 text-white text-sm sm:text-base"
                    style={{ backgroundColor: '#07d7a9' }}
                    disabled={!proxyAccount || !loggedInUser || isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Setting...
                      </>
                    ) : (
                      'Set Proxy'
                    )}
                  </Button>
                  
                  {currentProxy && (
                    <Button 
                      onClick={handleRemoveProxy}
                      variant="outline"
                      className="flex-1 text-sm sm:text-base"
                      disabled={!loggedInUser || isProcessing}
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Removing...
                        </>
                      ) : (
                        'Remove Proxy'
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
};

export default WitnessOperations;
