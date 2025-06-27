
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Clock, CheckCircle, XCircle, Users, ExternalLink, DollarSign, Vote, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { steemApi, SteemProposal } from "@/services/steemApi";
import * as dsteem from 'dsteem';
import { steemOperations } from '@/services/steemOperations';
// Import your utility functions
import { getSteemPerMvests, vestsToSteem } from '@/utils/utility';

/**
 * Formats a large number into a human-readable string with a suffix (K, M, B).
 */
const formatSteemPower = (sp: number): string => {
    if (sp >= 1_000_000_000) {
        return `${(sp / 1_000_000_000).toFixed(2)}B`;
    }
    if (sp >= 1_000_000) {
        return `${(sp / 1_000_000).toFixed(2)}M`;
    }
    if (sp >= 1_000) {
        return `${(sp / 1_000).toFixed(1)}K`;
    }
    return sp.toFixed(0);
};

/**
 * A small helper component to display votes converted to Steem Power.
 * It now accurately converts the raw vote string to a VESTS number
 * before using the conversion function.
 */
const VoteDisplay = ({ totalVotes, steemPerMvests }: { totalVotes: string, steemPerMvests: number | null }) => {
  // If the conversion rate isn't loaded, show a fallback
  if (steemPerMvests === null) {
    return <span className="text-gray-500">...</span>;
  }

  try {
    // 1. The raw 'total_votes' is VESTS scaled by 1,000,000.
    // We use BigInt to handle the large string, divide to get the actual
    // VESTS value, then convert it to a standard number.
    const vestsAsNumber = Number(BigInt(totalVotes) / 1_000_000n);

    // 2. Use the known-working vestsToSteem function from the utility file.
    const steemPower = vestsToSteem(vestsAsNumber, steemPerMvests);

    // 3. Format the final, correct SP value for readability.
    const formattedSp = formatSteemPower(steemPower);

    return (
      <>
        <span className="text-green-600 font-medium">
          ~{formattedSp}
        </span>
        <span className="text-gray-500 ml-1">SP</span>
      </>
    );
  } catch (error) {
      console.error("Could not format votes", error);
      return <span className="text-gray-500">N/A</span>
  }
};


const GovernanceOperations = () => {
  const { toast } = useToast();
  const [proposals, setProposals] = useState<SteemProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [returnProposal, setReturnProposal] = useState<SteemProposal | null>(null);
  const [steemPerMvests, setSteemPerMvests] = useState<number | null>(null);
  const [userVotedProposals, setUserVotedProposals] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Check if user is logged in
  const isLoggedIn = localStorage.getItem('steem_username');
  const username = localStorage.getItem('steem_username');

  useEffect(() => {
    const fetchAllData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch proposals and steem per mvests
        const [proposalData, spm] = await Promise.all([
          steemApi.getProposalsByVotes(),
          getSteemPerMvests()
        ]);
        
        setProposals(proposalData);
        setSteemPerMvests(spm);
        const returnProp = proposalData.find(p => p.proposal_id === 0);
        setReturnProposal(returnProp || null);

        // Fetch user votes if logged in
        if (username) {
          const userVotes = await steemApi.getUserProposalVotes(username);
          setUserVotedProposals(userVotes);
          console.log('User voted proposals:', userVotes);
        }
      } catch (err) {
        console.error('Error fetching governance data:', err);
        setError('Failed to fetch governance data');
      } finally {
        setLoading(false);
      }
    };
    fetchAllData();
  }, [username]);

  const handleVoteProposal = async (proposalId: number, approve: boolean) => {
    if (!isLoggedIn) {
      toast({
        title: "Login Required",
        description: "Please login to vote on proposals",
        variant: "destructive",
      });
      return;
    }

    const loginMethod = localStorage.getItem('steem_login_method');
    setIsProcessing(true);

    try {
      const operation = {
        voter: username!,
        proposal_ids: [proposalId],
        approve: approve
      };

      if (loginMethod === 'keychain') {
        await handleKeychainOperation(username!, operation, approve ? 'vote' : 'unvote');
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyOperation(username!, operation, approve ? 'vote' : 'unvote');
      }
    } catch (error) {
      console.error('Proposal vote error:', error);
      setIsProcessing(false);
    }
  };

  const handleKeychainOperation = async (username: string, operation: any, action: string) => {
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
      window.steem_keychain.requestBroadcast(
        username,
        [['update_proposal_votes', operation]],
        'Posting',
        (response: any) => {
          if (response.success) {
            toast({
              title: `Proposal ${action} Successful`,
              description: `Successfully ${action}d on proposal(s) ${operation.proposal_ids.join(', ')}`,
            });
            
            // Update local vote state
            if (operation.approve) {
              setUserVotedProposals(prev => [...prev, ...operation.proposal_ids]);
            } else {
              setUserVotedProposals(prev => prev.filter(id => !operation.proposal_ids.includes(id)));
            }
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
      toast({
        title: "Operation Failed",
        description: error.message || "Failed to process operation",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const handlePrivateKeyOperation = async (username: string, operation: any, action: string) => {
    const privateKeyString = localStorage.getItem('steem_posting_key');
    if (!privateKeyString) {
      toast({
        title: "Private Key Not Found",
        description: "Posting key required for voting",
        variant: "destructive",
      });
      setIsProcessing(false);
      return;
    }

    try {
      const privateKey = dsteem.PrivateKey.fromString(privateKeyString);
      const result = await steemOperations.updateProposalVotes(operation, privateKey);
      
      toast({
        title: `Proposal ${action} Successful`,
        description: `Successfully ${action}d on proposal(s) ${operation.proposal_ids.join(', ')}`,
      });
      
      // Update local vote state
      if (operation.approve) {
        setUserVotedProposals(prev => [...prev, ...operation.proposal_ids]);
      } else {
        setUserVotedProposals(prev => prev.filter(id => !operation.proposal_ids.includes(id)));
      }
      
      setIsProcessing(false);
      
    } catch (error: any) {
      console.error('Operation error:', error);
      
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

  const isProposalFunded = (proposal: SteemProposal): boolean => {
    if (!returnProposal) return false;
    try {
        const proposalVotes = BigInt(proposal.total_votes);
        const returnVotes = BigInt(returnProposal.total_votes);
        return proposalVotes > returnVotes;
    } catch (e) {
        return false;
    }
  };

  const getFundingBadge = (proposal: SteemProposal) => {
    if (proposal.proposal_id === 0) {
      return (
        <Badge variant="outline" className="text-xs text-orange-600 border-orange-400 bg-orange-50">
          <DollarSign className="w-3 h-3 mr-1" />
          Funding Threshold
        </Badge>
      );
    }
    const funded = isProposalFunded(proposal);
    return (
      <Badge variant="outline" className={`text-xs ${funded ? 'text-green-600 border-green-400 bg-green-50' : 'text-gray-600 border-gray-400 bg-gray-50'}`}>
        <DollarSign className="w-3 h-3 mr-1" />
        {funded ? 'Funded' : 'Not Funded'}
      </Badge>
    );
  };

  const getStatusIcon = (proposal: SteemProposal) => {
    const status = steemApi.getProposalStatus(proposal.start_date, proposal.end_date);
    switch (status) {
      case "active": return <Clock className="w-4 h-4 text-blue-500" />;
      case "expired": return <XCircle className="w-4 h-4 text-red-500" />;
      case "pending": return <Clock className="w-4 h-4 text-yellow-500" />;
      default: return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = (proposal: SteemProposal) => {
    const status = steemApi.getProposalStatus(proposal.start_date, proposal.end_date);
    switch (status) {
      case "active": return "text-blue-600 border-blue-400";
      case "expired": return "text-red-600 border-red-400";
      case "pending": return "text-yellow-600 border-yellow-400";
      default: return "text-gray-600 border-gray-400";
    }
  };

  const getCategoryColor = (dailyPay: string) => {
    const amount = parseFloat(dailyPay);
    if (amount >= 1000) return "text-red-600 border-red-400 bg-red-50";
    if (amount >= 100) return "text-orange-600 border-orange-400 bg-orange-50";
    return "text-green-600 border-green-400 bg-green-50";
  };

  const hasUserVoted = (proposalId: number) => {
    return userVotedProposals.includes(proposalId);
  };
  
  const activeProposals = proposals.filter(p => steemApi.getProposalStatus(p.start_date, p.end_date) === 'active');
  const fundedProposals = proposals.filter(p => isProposalFunded(p) && p.proposal_id !== 0);
  const completedProposals = proposals.filter(p => steemApi.getProposalStatus(p.start_date, p.end_date) !== 'active');


  if (loading) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-4 border-[#07d7a9] border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading DAO proposals...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <Card className="bg-white border border-red-200 shadow-sm">
          <CardContent className="p-4">
            <div className="text-center text-red-600">
              <p>Error loading proposals: {error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Tabs defaultValue="active" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-white shadow-sm border border-gray-200">
          <TabsTrigger value="active" className="data-[state=active]:text-white data-[state=active]:bg-[#07d7a9] text-sm sm:text-base">
            <Clock className="w-4 h-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Active ({activeProposals.length})</span>
            <span className="sm:hidden">Live</span>
          </TabsTrigger>
          <TabsTrigger value="completed" className="data-[state=active]:text-white data-[state=active]:bg-[#07d7a9] text-sm sm:text-base">
            <CheckCircle className="w-4 h-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">All ({proposals.length})</span>
            <span className="sm:hidden">All</span>
          </TabsTrigger>
          <TabsTrigger value="stats" className="data-[state=active]:text-white data-[state=active]:bg-[#07d7a9] text-sm sm:text-base">
            <Users className="w-4 h-4 mr-1 sm:mr-2" />
            Stats
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-4">
          <Card className="bg-white border border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-gray-800 flex items-center gap-2 text-lg sm:text-xl">
                <FileText className="w-5 h-5" style={{ color: '#07d7a9' }} />
                Active DAO Proposals
              </CardTitle>
              <CardDescription className="text-gray-500 text-sm sm:text-base">
                Vote on proposals that shape the future of Steem
                {isLoggedIn && (
                  <span className="block text-xs text-green-600 mt-1">
                    Logged in as @{username} - Your votes are tracked
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activeProposals.map((proposal) => (
                  <div key={proposal.id} className="border border-gray-200 rounded-lg p-3 sm:p-4">
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold text-gray-900 text-sm sm:text-base">{proposal.subject}</h3>
                            <Badge variant="outline" className={`text-xs ${getCategoryColor(proposal.daily_pay)}`}>
                              {steemApi.formatDailyPay(proposal.daily_pay)} SBD/day
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mb-2">
                            <span>by @{proposal.creator}</span>
                            <span className="hidden sm:inline">•</span>
                            <span>to @{proposal.receiver}</span>
                            <span className="hidden sm:inline">•</span>
                            <span>ID #{proposal.proposal_id}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>Ends {new Date(proposal.end_date).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(proposal)}
                          <Badge variant="outline" className={`text-xs ${getStatusColor(proposal)}`}>
                            {steemApi.getProposalStatus(proposal.start_date, proposal.end_date)}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {getFundingBadge(proposal)}
                        {hasUserVoted(proposal.proposal_id) && (
                          <Badge variant="default" className="text-xs bg-green-600 text-white">
                            <Vote className="w-3 h-3 mr-1" />
                            You Voted
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-4 text-xs sm:text-sm">
                          <div className="flex items-center gap-1">
                            <VoteDisplay totalVotes={proposal.total_votes} steemPerMvests={steemPerMvests} />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {hasUserVoted(proposal.proposal_id) ? (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleVoteProposal(proposal.proposal_id, false)}
                              disabled={!isLoggedIn || isProcessing}
                              className="bg-red-50 border-red-600 text-red-600 hover:bg-red-100 text-xs sm:text-sm px-3 sm:px-4"
                            >
                              <X className="w-3 h-3 sm:mr-1" />
                              <span className="hidden sm:inline">Unvote</span>
                            </Button>
                          ) : (
                            <Button 
                              size="sm" 
                              onClick={() => handleVoteProposal(proposal.proposal_id, true)}
                              disabled={!isLoggedIn || isProcessing}
                              className="bg-green-600 hover:bg-green-700 text-white text-xs sm:text-sm px-3 sm:px-4"
                            >
                              <Vote className="w-3 h-3 sm:mr-1" />
                              <span className="hidden sm:inline">Vote For</span>
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="text-xs sm:text-sm px-2 sm:px-3" onClick={() => window.open(`https://steemit.com/@${proposal.creator}/${proposal.permlink}`, '_blank')}>
                            <ExternalLink className="w-3 h-3 sm:mr-1" />
                            <span className="hidden sm:inline">View</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {activeProposals.length === 0 && (
                  <div className="text-center text-gray-500 py-8">No active proposals found</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          <Card className="bg-white border border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-gray-800 text-lg sm:text-xl">All Proposals</CardTitle>
              <CardDescription className="text-gray-500 text-sm sm:text-base">
                Review all DAO proposals ordered by total votes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {proposals.slice(0, 20).map((proposal, index) => (
                  <div key={proposal.id} className="border border-gray-200 rounded-lg p-3 sm:p-4">
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-medium text-gray-400">#{index + 1}</span>
                            <h3 className="font-semibold text-gray-900 text-sm sm:text-base">{proposal.subject}</h3>
                            <Badge variant="outline" className={`text-xs ${getCategoryColor(proposal.daily_pay)}`}>
                              {steemApi.formatDailyPay(proposal.daily_pay)} SBD/day
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mb-2">
                            <span>by @{proposal.creator}</span>
                            <span className="hidden sm:inline">•</span>
                            <span>to @{proposal.receiver}</span>
                            <span className="hidden sm:inline">•</span>
                            <span>ID #{proposal.proposal_id}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(proposal)}
                          <Badge variant="outline" className={`text-xs ${getStatusColor(proposal)}`}>
                            {steemApi.getProposalStatus(proposal.start_date, proposal.end_date)}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {getFundingBadge(proposal)}
                        {hasUserVoted(proposal.proposal_id) && (
                          <Badge variant="default" className="text-xs bg-green-600 text-white">
                            <Vote className="w-3 h-3 mr-1" />
                            You Voted
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-xs sm:text-sm">
                          <VoteDisplay totalVotes={proposal.total_votes} steemPerMvests={steemPerMvests} />
                        </div>
                        <Button size="sm" variant="outline" className="text-xs sm:text-sm px-2 sm:px-3" onClick={() => window.open(`https://steemit.com/@${proposal.creator}/${proposal.permlink}`, '_blank')}>
                          <ExternalLink className="w-3 h-3 sm:mr-1" />
                          <span className="hidden sm:inline">View Post</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
             <Card className="bg-white border border-gray-200 shadow-sm">
               <CardContent className="p-4">
                 <div className="text-center">
                   <p className="text-lg sm:text-2xl font-bold" style={{ color: '#07d7a9' }}>{proposals.length}</p>
                   <p className="text-xs sm:text-sm text-gray-500">Total Proposals</p>
                 </div>
               </CardContent>
             </Card>
             <Card className="bg-white border border-gray-200 shadow-sm">
               <CardContent className="p-4">
                 <div className="text-center">
                   <p className="text-lg sm:text-2xl font-bold text-green-600">{activeProposals.length}</p>
                   <p className="text-xs sm:text-sm text-gray-500">Active</p>
                 </div>
               </CardContent>
             </Card>
             <Card className="bg-white border border-gray-200 shadow-sm">
               <CardContent className="p-4">
                 <div className="text-center">
                   <p className="text-lg sm:text-2xl font-bold text-blue-600">{fundedProposals.length}</p>
                   <p className="text-xs sm:text-sm text-gray-500">Funded</p>
                 </div>
               </CardContent>
             </Card>
             <Card className="bg-white border border-gray-200 shadow-sm">
               <CardContent className="p-4">
                 <div className="text-center">
                   <p className="text-lg sm:text-2xl font-bold text-yellow-600">
                     {proposals.filter(p => steemApi.getProposalStatus(p.start_date, p.end_date) === 'pending').length}
                   </p>
                   <p className="text-xs sm:text-sm text-gray-500">Pending</p>
                 </div>
               </CardContent>
             </Card>
           </div>
          <Card className="bg-white border border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-gray-800 text-lg sm:text-xl">Top Funded Proposals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {proposals.slice(0, 5).map((proposal, index) => (
                  <div key={proposal.id} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-400">#{index + 1}</span>
                      <span className="text-gray-900 text-sm truncate max-w-xs">{proposal.subject}</span>
                      {getFundingBadge(proposal)}
                      {hasUserVoted(proposal.proposal_id) && (
                        <Badge variant="default" className="text-xs bg-green-600 text-white">
                          <Vote className="w-3 h-3 mr-1" />
                          Voted
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm">
                      <VoteDisplay totalVotes={proposal.total_votes} steemPerMvests={steemPerMvests} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default GovernanceOperations;
