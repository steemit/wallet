import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import * as dsteem from 'dsteem';
import { steemOperations } from '@/services/steemOperations';
import { steemApi } from '@/services/steemApi';

interface WitnessManagementProps {
  loggedInUser: string | null;
}

const WitnessManagement = ({ loggedInUser }: WitnessManagementProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [userProposals, setUserProposals] = useState<any[]>([]);
  const [hasProposals, setHasProposals] = useState(false);
  
  // Proposal form state
  const [proposalForm, setProposalForm] = useState({
    receiver: '',
    startDate: '',
    endDate: '',
    dailyPayAmount: '1000',
    subject: '',
    permlink: ''
  });

  // Remove proposal form state
  const [removeForm, setRemoveForm] = useState({
    proposalIds: ''
  });

  // Witness Set Properties form state
  const [setPropsForm, setSetPropsForm] = useState({
    accountCreationFee: '0.000 STEEM',
    accountSubsidyBudget: '10000',
    accountSubsidyDecay: '330782',
    maximumBlockSize: '65536',
    sbdInterestRate: '0.000 STEEM',
    sbdExchangeRateBase: '0.000 SBD',
    sbdExchangeRateQuote: '0.000 STEEM',
    url: '',
    newSigningKey: ''
  });

  // Witness Update form state
  const [updateForm, setUpdateForm] = useState({
    url: '',
    blockSigningKey: '',
    accountCreationFeeAmount: '100000',
    maximumBlockSize: '131072',
    sbdInterestRate: '1000',
    feeAmount: '0'
  });

  // Check if user has existing proposals
  useEffect(() => {
    const checkUserProposals = async () => {
      if (!loggedInUser) return;
      
      try {
        // Get all proposals and filter by creator
        const allProposals = await steemApi.getProposalsByVotes();
        const userCreatedProposals = allProposals.filter(p => p.creator === loggedInUser);
        setUserProposals(userCreatedProposals);
        setHasProposals(userCreatedProposals.length > 0);
      } catch (error) {
        console.error('Error checking user proposals:', error);
      }
    };

    checkUserProposals();
  }, [loggedInUser]);

  const handleCreateProposal = async () => {
    if (!loggedInUser || !password) {
      toast.error('Please enter your password');
      return;
    }

    if (!proposalForm.receiver || !proposalForm.subject || !proposalForm.permlink) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsLoading(true);
    try {
      const activeKey = dsteem.PrivateKey.fromSeed(`${loggedInUser}active${password}`);
      
      const operation: dsteem.Operation = [
        'create_proposal',
        {
          creator: loggedInUser,
          receiver: proposalForm.receiver,
          start_date: new Date(proposalForm.startDate).toISOString().slice(0, 19),
          end_date: new Date(proposalForm.endDate).toISOString().slice(0, 19),
          daily_pay: {
            amount: proposalForm.dailyPayAmount,
            precision: 3,
            nai: "@@000000013"
          },
          subject: proposalForm.subject,
          permlink: proposalForm.permlink
        }
      ];

      await steemOperations.broadcastOperation([operation], activeKey);
      toast.success('Proposal created successfully!');
      
      // Reset form
      setProposalForm({
        receiver: '',
        startDate: '',
        endDate: '',
        dailyPayAmount: '1000',
        subject: '',
        permlink: ''
      });
      setPassword('');
      
      // Refresh proposals
      const allProposals = await steemApi.getProposalsByVotes();
      const userCreatedProposals = allProposals.filter(p => p.creator === loggedInUser);
      setUserProposals(userCreatedProposals);
      setHasProposals(userCreatedProposals.length > 0);
    } catch (error) {
      console.error('Error creating proposal:', error);
      toast.error('Failed to create proposal');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveProposal = async () => {
    if (!loggedInUser || !password) {
      toast.error('Please enter your password');
      return;
    }

    if (!removeForm.proposalIds) {
      toast.error('Please enter proposal IDs to remove');
      return;
    }

    const ids = removeForm.proposalIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    if (ids.length === 0) {
      toast.error('Please enter valid proposal IDs');
      return;
    }

    setIsLoading(true);
    try {
      const activeKey = dsteem.PrivateKey.fromSeed(`${loggedInUser}active${password}`);
      
      const operation: dsteem.Operation = [
        'remove_proposal',
        {
          creator: loggedInUser,
          proposal_ids: ids
        }
      ];

      await steemOperations.broadcastOperation([operation], activeKey);
      toast.success('Proposal(s) removed successfully!');
      
      // Reset form
      setRemoveForm({
        proposalIds: ''
      });
      setPassword('');
      
      // Refresh proposals
      const allProposals = await steemApi.getProposalsByVotes();
      const userCreatedProposals = allProposals.filter(p => p.creator === loggedInUser);
      setUserProposals(userCreatedProposals);
      setHasProposals(userCreatedProposals.length > 0);
    } catch (error) {
      console.error('Error removing proposal:', error);
      toast.error('Failed to remove proposal');
    } finally {
      setIsLoading(false);
    }
  };

  const handleWitnessSetProperties = async () => {
    if (!loggedInUser || !password) {
      toast.error('Please enter your password');
      return;
    }

    setIsLoading(true);
    try {
      const activeKey = dsteem.PrivateKey.fromSeed(`${loggedInUser}active${password}`);
      
      // Convert URL to hex if provided
      const urlHex = setPropsForm.url ? 
        Buffer.from(setPropsForm.url, 'utf8').toString('hex') : '';

      const operation: dsteem.Operation = [
        'witness_set_properties',
        {
          owner: loggedInUser,
          props: {
            account_creation_fee: setPropsForm.accountCreationFee,
            account_subsidy_budget: parseInt(setPropsForm.accountSubsidyBudget),
            account_subsidy_decay: parseInt(setPropsForm.accountSubsidyDecay),
            maximum_block_size: parseInt(setPropsForm.maximumBlockSize),
            sbd_interest_rate: setPropsForm.sbdInterestRate,
            sbd_exchange_rate: {
              base: setPropsForm.sbdExchangeRateBase,
              quote: setPropsForm.sbdExchangeRateQuote
            },
            url: urlHex,
            new_signing_key: setPropsForm.newSigningKey
          },
          extensions: []
        }
      ];

      await steemOperations.broadcastOperation([operation], activeKey);
      toast.success('Witness properties updated successfully!');
      
      // Reset form
      setSetPropsForm({
        accountCreationFee: '0.000 STEEM',
        accountSubsidyBudget: '10000',
        accountSubsidyDecay: '330782',
        maximumBlockSize: '65536',
        sbdInterestRate: '0.000 STEEM',
        sbdExchangeRateBase: '0.000 SBD',
        sbdExchangeRateQuote: '0.000 STEEM',
        url: '',
        newSigningKey: ''
      });
      setPassword('');
    } catch (error) {
      console.error('Error updating witness properties:', error);
      toast.error('Failed to update witness properties');
    } finally {
      setIsLoading(false);
    }
  };

  const handleWitnessUpdate = async () => {
    if (!loggedInUser || !password) {
      toast.error('Please enter your password');
      return;
    }

    setIsLoading(true);
    try {
      const activeKey = dsteem.PrivateKey.fromSeed(`${loggedInUser}active${password}`);
      
      const operation: dsteem.Operation = [
        'witness_update',
        {
          owner: loggedInUser,
          url: updateForm.url,
          block_signing_key: updateForm.blockSigningKey,
          props: {
            account_creation_fee: {
              amount: updateForm.accountCreationFeeAmount,
              precision: 3,
              nai: "@@000000021"
            },
            maximum_block_size: parseInt(updateForm.maximumBlockSize),
            sbd_interest_rate: parseInt(updateForm.sbdInterestRate)
          },
          fee: {
            amount: updateForm.feeAmount,
            precision: 3,
            nai: "@@000000021"
          }
        }
      ];

      await steemOperations.broadcastOperation([operation], activeKey);
      toast.success('Witness updated successfully!');
      
      // Reset form
      setUpdateForm({
        url: '',
        blockSigningKey: '',
        accountCreationFeeAmount: '100000',
        maximumBlockSize: '131072',
        sbdInterestRate: '1000',
        feeAmount: '0'
      });
      setPassword('');
    } catch (error) {
      console.error('Error updating witness:', error);
      toast.error('Failed to update witness');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisableWitness = () => {
    if (setPropsForm.newSigningKey) {
      setSetPropsForm({
        ...setPropsForm,
        newSigningKey: 'STM1111111111111111111111111111111114T1Anm'
      });
    } else {
      setUpdateForm({
        ...updateForm,
        blockSigningKey: 'STM1111111111111111111111111111111114T1Anm'
      });
    }
    toast.info('Signing key set to disable witness');
  };

  if (!loggedInUser) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Gov Operations</CardTitle>
          <CardDescription>Please log in to manage witness operations</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gov Operations</CardTitle>
        <CardDescription>Manage witness properties, settings, and proposals</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="set-properties" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="set-properties">Set Properties (HF20+)</TabsTrigger>
            <TabsTrigger value="witness-update">Witness Update</TabsTrigger>
            <TabsTrigger value="create-proposal" disabled={hasProposals}>
              {hasProposals ? 'Has Proposals' : 'Create Proposal'}
            </TabsTrigger>
            <TabsTrigger value="remove-proposal" disabled={!hasProposals}>
              Remove Proposal
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="set-properties" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="accountCreationFee">Account Creation Fee</Label>
                <Input
                  id="accountCreationFee"
                  value={setPropsForm.accountCreationFee}
                  onChange={(e) => setSetPropsForm({...setPropsForm, accountCreationFee: e.target.value})}
                  placeholder="0.000 STEEM"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="maximumBlockSize">Maximum Block Size</Label>
                <Input
                  id="maximumBlockSize"
                  type="number"
                  value={setPropsForm.maximumBlockSize}
                  onChange={(e) => setSetPropsForm({...setPropsForm, maximumBlockSize: e.target.value})}
                  placeholder="65536"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="accountSubsidyBudget">Account Subsidy Budget</Label>
                <Input
                  id="accountSubsidyBudget"
                  type="number"
                  value={setPropsForm.accountSubsidyBudget}
                  onChange={(e) => setSetPropsForm({...setPropsForm, accountSubsidyBudget: e.target.value})}
                  placeholder="10000"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="accountSubsidyDecay">Account Subsidy Decay</Label>
                <Input
                  id="accountSubsidyDecay"
                  type="number"
                  value={setPropsForm.accountSubsidyDecay}
                  onChange={(e) => setSetPropsForm({...setPropsForm, accountSubsidyDecay: e.target.value})}
                  placeholder="330782"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sbdExchangeRateBase">SBD Exchange Rate Base</Label>
                <Input
                  id="sbdExchangeRateBase"
                  value={setPropsForm.sbdExchangeRateBase}
                  onChange={(e) => setSetPropsForm({...setPropsForm, sbdExchangeRateBase: e.target.value})}
                  placeholder="0.000 SBD"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sbdExchangeRateQuote">SBD Exchange Rate Quote</Label>
                <Input
                  id="sbdExchangeRateQuote"
                  value={setPropsForm.sbdExchangeRateQuote}
                  onChange={(e) => setSetPropsForm({...setPropsForm, sbdExchangeRateQuote: e.target.value})}
                  placeholder="0.000 STEEM"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="witnessUrl">Witness URL</Label>
              <Input
                id="witnessUrl"
                value={setPropsForm.url}
                onChange={(e) => setSetPropsForm({...setPropsForm, url: e.target.value})}
                placeholder="https://steemit.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="newSigningKey">New Signing Key</Label>
              <Input
                id="newSigningKey"
                value={setPropsForm.newSigningKey}
                onChange={(e) => setSetPropsForm({...setPropsForm, newSigningKey: e.target.value})}
                placeholder="STM..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="setPropsPassword">Active Key Password</Label>
              <Input
                id="setPropsPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={handleWitnessSetProperties} 
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? 'Updating...' : 'Update Properties'}
              </Button>
              <Button 
                onClick={handleDisableWitness} 
                variant="destructive"
              >
                Disable Witness
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="witness-update" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="updateUrl">Witness URL</Label>
                <Input
                  id="updateUrl"
                  value={updateForm.url}
                  onChange={(e) => setUpdateForm({...updateForm, url: e.target.value})}
                  placeholder="witness-category/my-witness"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="blockSigningKey">Block Signing Key</Label>
                <Input
                  id="blockSigningKey"
                  value={updateForm.blockSigningKey}
                  onChange={(e) => setUpdateForm({...updateForm, blockSigningKey: e.target.value})}
                  placeholder="STM8LoQjQqJHvotqBo7HjnqmUbFW9oJ2theyqonzUd9DdJ7YYHsvD"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="updateAccountCreationFee">Account Creation Fee (amount)</Label>
                <Input
                  id="updateAccountCreationFee"
                  value={updateForm.accountCreationFeeAmount}
                  onChange={(e) => setUpdateForm({...updateForm, accountCreationFeeAmount: e.target.value})}
                  placeholder="100000"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="updateMaximumBlockSize">Maximum Block Size</Label>
                <Input
                  id="updateMaximumBlockSize"
                  type="number"
                  value={updateForm.maximumBlockSize}
                  onChange={(e) => setUpdateForm({...updateForm, maximumBlockSize: e.target.value})}
                  placeholder="131072"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="updateSbdInterestRate">SBD Interest Rate</Label>
                <Input
                  id="updateSbdInterestRate"
                  type="number"
                  value={updateForm.sbdInterestRate}
                  onChange={(e) => setUpdateForm({...updateForm, sbdInterestRate: e.target.value})}
                  placeholder="1000"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="updateFeeAmount">Fee Amount</Label>
                <Input
                  id="updateFeeAmount"
                  value={updateForm.feeAmount}
                  onChange={(e) => setUpdateForm({...updateForm, feeAmount: e.target.value})}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="updatePassword">Active Key Password</Label>
              <Input
                id="updatePassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={handleWitnessUpdate} 
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? 'Updating...' : 'Update Witness'}
              </Button>
              <Button 
                onClick={handleDisableWitness} 
                variant="destructive"
              >
                Disable Witness
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="create-proposal" className="space-y-4">
            {hasProposals ? (
              <div className="text-center py-8">
                <p className="text-gray-600 mb-4">You already have active proposals</p>
                <div className="space-y-2">
                  {userProposals.map(proposal => (
                    <div key={proposal.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="font-medium">{proposal.subject}</div>
                      <div className="text-sm text-gray-500">ID: {proposal.proposal_id} | Daily Pay: {proposal.daily_pay}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="receiver">Receiver *</Label>
                    <Input
                      id="receiver"
                      value={proposalForm.receiver}
                      onChange={(e) => setProposalForm({...proposalForm, receiver: e.target.value})}
                      placeholder="username"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="dailyPayAmount">Daily Pay Amount (SBD) *</Label>
                    <Input
                      id="dailyPayAmount"
                      type="number"
                      value={proposalForm.dailyPayAmount}
                      onChange={(e) => setProposalForm({...proposalForm, dailyPayAmount: e.target.value})}
                      placeholder="1000"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="startDate">Start Date *</Label>
                    <Input
                      id="startDate"
                      type="datetime-local"
                      value={proposalForm.startDate}
                      onChange={(e) => setProposalForm({...proposalForm, startDate: e.target.value})}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="endDate">End Date *</Label>
                    <Input
                      id="endDate"
                      type="datetime-local"
                      value={proposalForm.endDate}
                      onChange={(e) => setProposalForm({...proposalForm, endDate: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">Subject *</Label>
                  <Input
                    id="subject"
                    value={proposalForm.subject}
                    onChange={(e) => setProposalForm({...proposalForm, subject: e.target.value})}
                    placeholder="Proposal title"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="permlink">Permlink *</Label>
                  <Input
                    id="permlink"
                    value={proposalForm.permlink}
                    onChange={(e) => setProposalForm({...proposalForm, permlink: e.target.value})}
                    placeholder="my-proposal-permlink"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="proposalPassword">Active Key Password</Label>
                  <Input
                    id="proposalPassword"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                  />
                </div>

                <Button 
                  onClick={handleCreateProposal} 
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? 'Creating...' : 'Create Proposal'}
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="remove-proposal" className="space-y-4">
            {!hasProposals ? (
              <div className="text-center py-8">
                <p className="text-gray-600">You don't have any proposals to remove</p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Your Active Proposals</Label>
                    <div className="space-y-2">
                      {userProposals.map(proposal => (
                        <div key={proposal.id} className="p-3 bg-gray-50 rounded-lg">
                          <div className="font-medium">{proposal.subject}</div>
                          <div className="text-sm text-gray-500">
                            ID: {proposal.proposal_id} | Daily Pay: {proposal.daily_pay} | 
                            Status: {steemApi.getProposalStatus(proposal.start_date, proposal.end_date)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="proposalIds">Proposal IDs to Remove</Label>
                    <Input
                      id="proposalIds"
                      value={removeForm.proposalIds}
                      onChange={(e) => setRemoveForm({...removeForm, proposalIds: e.target.value})}
                      placeholder="1, 2, 3 (comma separated)"
                    />
                    <p className="text-sm text-gray-500">Enter proposal IDs separated by commas</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="removePassword">Active Key Password</Label>
                    <Input
                      id="removePassword"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                    />
                  </div>

                  <Button 
                    onClick={handleRemoveProposal} 
                    disabled={isLoading}
                    variant="destructive"
                    className="w-full"
                  >
                    {isLoading ? 'Removing...' : 'Remove Proposal(s)'}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default WitnessManagement;
