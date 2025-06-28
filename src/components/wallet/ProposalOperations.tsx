
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Vote, X, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as dsteem from 'dsteem';
import { steemOperations } from '@/services/steemOperations';

const ProposalOperations = () => {
  const [proposalIds, setProposalIds] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [userVotes, setUserVotes] = useState<number[]>([]);
  
  const { toast } = useToast();

  // Check if user is logged in
  const isLoggedIn = localStorage.getItem('steem_username');
  const username = localStorage.getItem('steem_username');

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

  const handleBulkVote = async (approve: boolean) => {
    if (!isLoggedIn) {
      toast({
        title: "Login Required",
        description: "Please login to vote on proposals",
        variant: "destructive",
      });
      return;
    }

    if (!proposalIds) {
      toast({
        title: "Missing Proposal IDs",
        description: "Please enter proposal IDs",
        variant: "destructive",
      });
      return;
    }

    const ids = proposalIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    if (ids.length === 0) {
      toast({
        title: "Invalid Proposal IDs",
        description: "Please enter valid proposal IDs separated by commas",
        variant: "destructive",
      });
      return;
    }

    const loginMethod = localStorage.getItem('steem_login_method');
    setIsProcessing(true);

    try {
      const operation = {
        voter: username!,
        proposal_ids: ids,
        approve: approve
      };

      if (loginMethod === 'keychain') {
        await handleKeychainOperation(username!, operation, approve ? 'vote' : 'unvote');
      } else if (loginMethod === 'privatekey' || loginMethod === 'masterpassword') {
        await handlePrivateKeyOperation(username!, operation, approve ? 'vote' : 'unvote');
      }
    } catch (error) {
      console.error('Bulk proposal vote error:', error);
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
              setUserVotes(prev => [...prev, ...operation.proposal_ids]);
            } else {
              setUserVotes(prev => prev.filter(id => !operation.proposal_ids.includes(id)));
            }
            
            setProposalIds("");
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
        setUserVotes(prev => [...prev, ...operation.proposal_ids]);
      } else {
        setUserVotes(prev => prev.filter(id => !operation.proposal_ids.includes(id)));
      }
      
      setProposalIds("");
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
                  You must be logged in to vote on proposals.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bulk Vote Operations */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Vote className="w-5 h-5" style={{ color: '#07d7a9' }} />
            <div>
              <CardTitle className="text-gray-800">Proposal Voting</CardTitle>
              <CardDescription className="text-gray-600">
                Vote on proposals by ID - fetch proposal data from the blockchain
                {!isLoggedIn && <span className="text-blue-600"> (Login required)</span>}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proposal-ids" className="text-gray-700">Proposal IDs</Label>
            <Input
              id="proposal-ids"
              value={proposalIds}
              onChange={(e) => setProposalIds(e.target.value)}
              placeholder="1, 2, 3 (comma separated)"
              className="bg-white border-gray-300"
              disabled={!isLoggedIn}
            />
            <p className="text-sm text-gray-500">Enter proposal IDs separated by commas to vote on blockchain proposals</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button 
              onClick={() => handleBulkVote(true)}
              className="text-white"
              style={{ backgroundColor: isLoggedIn ? '#07d7a9' : '#6b7280' }}
              disabled={!isLoggedIn || !proposalIds || isProcessing}
            >
              {!isLoggedIn ? (
                <>
                  <Lock className="w-4 h-4 mr-2" />
                  Login Required
                </>
              ) : (
                <>
                  <Vote className="w-4 h-4 mr-2" />
                  Vote For
                </>
              )}
            </Button>
            
            <Button 
              onClick={() => handleBulkVote(false)}
              variant="outline"
              className="border-red-600 text-red-600 hover:bg-red-50"
              disabled={!isLoggedIn || !proposalIds || isProcessing}
            >
              {!isLoggedIn ? (
                <>
                  <Lock className="w-4 h-4 mr-2" />
                  Login Required
                </>
              ) : (
                <>
                  <X className="w-4 h-4 mr-2" />
                  Remove Vote
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Proposal Information */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-gray-800">Proposal Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-500">Enter proposal IDs above to vote</p>
            <p className="text-sm text-gray-400 mt-2">Proposal data will be fetched from the Steem blockchain</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProposalOperations;
