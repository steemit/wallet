import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { steemApi } from '@/services/steemApi';

export interface TransactionFilter {
  operationTypes: string[];
  dateRange?: {
    from: Date;
    to: Date;
  };
}

// Default operations to show - financial and reward operations only (excluding producer_reward)
const DEFAULT_OPERATION_TYPES = [
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
  'proposal_pay',
  'set_withdraw_vesting_route',
  'transfer',
  'transfer_from_savings',
  'transfer_to_savings',
  'transfer_to_vesting',
  'withdraw_vesting'
];

// Operations to exclude completely
const EXCLUDED_OPERATIONS = ['comment', 'custom_json', 'vote'];

// All available operation types for filtering (including producer_reward)
const ALL_AVAILABLE_OPERATIONS = [
  ...DEFAULT_OPERATION_TYPES,
  'producer_reward' // Add producer_reward as available filter option
];

export const useAccountHistory = (account: string, limit: number = 100) => {
  const [filter, setFilter] = useState<TransactionFilter>({
    operationTypes: DEFAULT_OPERATION_TYPES
  });
  const [page, setPage] = useState(1);
  const [allTransactions, setAllTransactions] = useState<any[]>([]);

  const { data: rawTransactions, isLoading, error, refetch } = useQuery({
    queryKey: ['accountHistory', account, limit],
    queryFn: async () => {
      if (!account) return [];
      
      try {
        console.log('Fetching account history for:', account);
        const history = await steemApi.getAccountHistory(account, -1, limit);
        console.log('Raw history received:', history?.length, 'transactions');
        return history || [];
      } catch (error) {
        console.error('Error fetching account history:', error);
        throw error;
      }
    },
    enabled: !!account,
    staleTime: 30000, // 30 seconds
  });

  useEffect(() => {
    if (rawTransactions) {
      console.log('Processing raw transactions:', rawTransactions.length);
      const formatted = rawTransactions
        .map(tx => steemApi.formatTransaction(tx))
        .filter(tx => !EXCLUDED_OPERATIONS.includes(tx.type)) // Filter out excluded operations
        .reverse(); // Reverse to show latest first
      console.log('Formatted transactions after filtering:', formatted.length);
      setAllTransactions(formatted);
    }
  }, [rawTransactions]);

  // Apply filters to all transactions
  const filteredTransactions = allTransactions.filter(transaction => {
    // If no operation types selected, show all (except excluded ones)
    if (filter.operationTypes.length === 0) return true;
    
    // Check if transaction type is in selected operation types
    return filter.operationTypes.includes(transaction.type);
  });

  console.log('Filtered transactions:', filteredTransactions.length, 'from', allTransactions.length, 'total');

  // Apply date filter if specified
  const dateFilteredTransactions = filter.dateRange 
    ? filteredTransactions.filter(tx => {
        const txDate = tx.timestamp;
        return txDate >= filter.dateRange!.from && txDate <= filter.dateRange!.to;
      })
    : filteredTransactions;

  // Pagination
  const itemsPerPage = 20;
  const totalPages = Math.ceil(dateFilteredTransactions.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const paginatedTransactions = dateFilteredTransactions.slice(startIndex, startIndex + itemsPerPage);

  const loadMore = async () => {
    if (rawTransactions && rawTransactions.length > 0) {
      const lastTransaction = rawTransactions[rawTransactions.length - 1];
      const from = lastTransaction[0] - 1;
      
      try {
        console.log('Loading more transactions from index:', from);
        const moreHistory = await steemApi.getAccountHistory(account, from, limit);
        if (moreHistory && moreHistory.length > 0) {
          const formatted = moreHistory
            .map(tx => steemApi.formatTransaction(tx))
            .filter(tx => !EXCLUDED_OPERATIONS.includes(tx.type)) // Filter out excluded operations
            .reverse(); // Reverse to show latest first
          setAllTransactions(prev => [...prev, ...formatted]);
        }
      } catch (error) {
        console.error('Error loading more transactions:', error);
      }
    }
  };

  // Get available operation types excluding the ones we don't want to show
  const availableOperationTypes = ALL_AVAILABLE_OPERATIONS
    .filter(type => !EXCLUDED_OPERATIONS.includes(type));

  return {
    transactions: paginatedTransactions,
    allTransactions: dateFilteredTransactions,
    isLoading,
    error,
    filter,
    setFilter,
    page,
    setPage,
    totalPages,
    itemsPerPage,
    loadMore,
    refetch,
    availableOperationTypes
  };
};
