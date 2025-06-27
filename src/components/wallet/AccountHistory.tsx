import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronLeft, ChevronRight, Filter, Download, RefreshCw } from 'lucide-react';
import { useAccountHistory } from '@/hooks/useAccountHistory';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getSteemPerMvests, vestsToSteem } from '@/utils/utility';

interface AccountHistoryProps {
  account: string;
}

const AccountHistory: React.FC<AccountHistoryProps> = ({ account }) => {
  const [showFilters, setShowFilters] = useState(false);
  const [steemPerMvests, setSteemPerMvests] = useState<number>(0);
  const {
    transactions,
    isLoading,
    error,
    filter,
    setFilter,
    page,
    setPage,
    totalPages,
    loadMore,
    refetch,
    availableOperationTypes
  } = useAccountHistory(account, 100);

  // Fetch Steem per Mvests on component mount
  useEffect(() => {
    const fetchSteemPerMvests = async () => {
      try {
        const value = await getSteemPerMvests();
        setSteemPerMvests(value);
      } catch (error) {
        console.error('Error fetching Steem per Mvests:', error);
      }
    };
    fetchSteemPerMvests();
  }, []);

  const handleOperationTypeToggle = (opType: string, checked: boolean) => {
    setFilter(prev => ({
      ...prev,
      operationTypes: checked
        ? [...prev.operationTypes, opType]
        : prev.operationTypes.filter(type => type !== opType)
    }));
    setPage(1); // Reset to first page when filtering
  };

  const clearFilters = () => {
    setFilter({ operationTypes: [] });
    setPage(1);
  };

  const selectAllFinancialOps = () => {
    const financialOps = [
      'author_reward',
      'cancel_transfer_from_savings',
      'claim_reward_balance',
      'comment_benefactor_reward',
      'curation_reward',
      'escrow_approve',
      'escrow_dispute',
      'escrow_release',
      'escrow_transfer',
      'fill_convert_request',
      'fill_transfer_from_savings',
      'fill_vesting_withdraw',
      'limit_order_cancel',
      'limit_order_create',
      'limit_order_create2',
      'producer_reward',
      'proposal_pay',
      'set_withdraw_vesting_route',
      'transfer',
      'transfer_from_savings',
      'transfer_to_savings',
      'transfer_to_vesting',
      'withdraw_vesting'
    ];
    setFilter(prev => ({ ...prev, operationTypes: financialOps }));
    setPage(1);
  };

  const getOperationColor = (type: string): string => {
    const colorMap: { [key: string]: string } = {
      'transfer': 'bg-blue-100 text-blue-800',
      'transfer_to_vesting': 'bg-green-100 text-green-800',
      'withdraw_vesting': 'bg-orange-100 text-orange-800',
      'delegate_vesting_shares': 'bg-purple-100 text-purple-800',
      'claim_reward_balance': 'bg-yellow-100 text-yellow-800',
      'author_reward': 'bg-emerald-100 text-emerald-800',
      'curation_reward': 'bg-teal-100 text-teal-800',
      'producer_reward': 'bg-violet-100 text-violet-800',
    };
    return colorMap[type] || 'bg-gray-100 text-gray-800';
  };

  const formatVestsToSP = (vestsString: string): string => {
    if (!vestsString || steemPerMvests === 0) return vestsString;
    
    const vestsValue = parseFloat(vestsString.split(' ')[0]);
    if (isNaN(vestsValue)) return vestsString;
    
    const spValue = vestsToSteem(vestsValue, steemPerMvests);
    return `${spValue.toFixed(3)} SP`;
  };

  const formatCurrency = (amountString: string): string => {
    if (!amountString) return '0';
    
    // If it already contains the currency, just return the value part
    const parts = amountString.split(' ');
    if (parts.length >= 2) {
      return parts[0];
    }
    return amountString;
  };

  const formatRewardAmounts = (steemAmount: string, sbdAmount: string, vestsAmount: string): string => {
    const amounts = [];
    
    const steem = parseFloat(formatCurrency(steemAmount || '0'));
    const sbd = parseFloat(formatCurrency(sbdAmount || '0'));
    
    if (steem > 0) {
      amounts.push(`${steem.toFixed(3)} STEEM`);
    }
    
    if (sbd > 0) {
      amounts.push(`${sbd.toFixed(3)} SBD`);
    }
    
    const spFormatted = formatVestsToSP(vestsAmount || '0');
    const spValue = parseFloat(spFormatted.split(' ')[0]);
    if (spValue > 0) {
      amounts.push(spFormatted);
    }
    
    return amounts.length > 0 ? amounts.join(', ') : 'No rewards';
  };

  const formatOperationData = (type: string, data: any) => {
    switch (type) {
      case 'transfer':
        const memo = data.memo || 'No memo';
        return (
          <>
            {data.from} → {data.to}: {data.amount} 
            {memo !== 'No memo' && (
              <span className="text-blue-600 font-medium"> ({memo})</span>
            )}
            {memo === 'No memo' && (
              <span className="text-gray-400"> ({memo})</span>
            )}
          </>
        );
      case 'transfer_to_vesting':
        return `${data.from} → ${data.to}: ${data.amount}`;
      case 'withdraw_vesting':
        return `Withdraw: ${formatVestsToSP(data.vesting_shares)}`;
      case 'delegate_vesting_shares':
        return `${data.delegator} → ${data.delegatee}: ${formatVestsToSP(data.vesting_shares)}`;
      case 'claim_reward_balance':
        const claimedRewards = formatRewardAmounts(data.reward_steem, data.reward_sbd, data.reward_vests);
        return `Claimed: ${claimedRewards}`;
      case 'author_reward':
        const authorRewards = formatRewardAmounts(data.steem_payout, data.sbd_payout, data.vesting_payout);
        return `Author reward: ${authorRewards}`;
      case 'curation_reward':
        return `Curation reward: ${formatVestsToSP(data.reward)}`;
      case 'producer_reward':
        return `Producer reward: ${formatVestsToSP(data.vesting_shares)}`;
      default:
        return JSON.stringify(data, null, 2);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>Loading account history...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>Error loading transaction history</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-red-600">Failed to load transaction history: {error.message}</p>
          <Button onClick={() => refetch()} className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>
              Financial transactions for @{account}
              {filter.operationTypes.length > 0 && (
                <span className="ml-2">
                  ({filter.operationTypes.length} operation type{filter.operationTypes.length !== 1 ? 's' : ''} selected)
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="w-4 h-4 mr-2" />
              Filters
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        <Collapsible open={showFilters} onOpenChange={setShowFilters}>
          <CollapsibleContent className="mt-4 p-4 border rounded-lg bg-gray-50">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Filter by Operation Type</h4>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAllFinancialOps}>
                    Select Financial
                  </Button>
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear All
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {availableOperationTypes.map(opType => (
                  <div key={opType} className="flex items-center space-x-2">
                    <Checkbox
                      id={opType}
                      checked={filter.operationTypes.includes(opType)}
                      onCheckedChange={(checked) => handleOperationTypeToggle(opType, checked as boolean)}
                    />
                    <label htmlFor={opType} className="text-sm font-medium cursor-pointer">
                      {opType.replace(/_/g, ' ')}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardHeader>

      <CardContent>
        {transactions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">
              {filter.operationTypes.length > 0 
                ? 'No transactions found matching the selected filters.'
                : 'No transaction history available.'
              }
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {transactions.map((transaction, index) => (
                <div 
                  key={`${transaction.index}-${index}`}
                  className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className={getOperationColor(transaction.type)}>
                          {transaction.type.replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-sm text-gray-500">
                          #{transaction.index}
                        </span>
                      </div>
                      <p className="text-sm mb-2">
                        {formatOperationData(transaction.type, transaction.data)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {transaction.formattedTimestamp}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
                <span className="text-sm text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
              >
                Load More History
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AccountHistory;
