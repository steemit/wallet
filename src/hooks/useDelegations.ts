
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { steemApi, VestingDelegation } from '@/services/steemApi';
import { getSteemPerMvests } from '@/utils/utility';

export interface FormattedDelegation extends VestingDelegation {
  steemPower: string;
  vestsAmount: number;
  formattedDate: string;
}

export const useDelegations = (username: string | null) => {
  const [steemPerMvests, setSteemPerMvests] = useState<number>(0);

  // Fetch Steem per Mvests conversion rate
  useEffect(() => {
    const fetchSteemPerMvests = async () => {
      try {
        const rate = await getSteemPerMvests();
        setSteemPerMvests(rate);
      } catch (error) {
        console.error('Error fetching Steem per Mvests:', error);
        setSteemPerMvests(500); // Fallback value
      }
    };

    fetchSteemPerMvests();
  }, []);

  // Fetch outgoing delegations
  const {
    data: outgoingDelegations = [],
    isLoading: outgoingLoading,
    error: outgoingError,
    refetch: refetchOutgoing
  } = useQuery({
    queryKey: ['outgoing-delegations', username],
    queryFn: async () => {
      if (!username) return [];
      const delegations = await steemApi.getVestingDelegations(username);
      return delegations
        .filter(d => parseFloat(d.vesting_shares.split(' ')[0]) > 0)
        .map(d => steemApi.formatDelegation(d, steemPerMvests));
    },
    enabled: !!username && steemPerMvests > 0,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Fetch incoming delegations
  const {
    data: incomingDelegations = [],
    isLoading: incomingLoading,
    error: incomingError,
    refetch: refetchIncoming
  } = useQuery({
    queryKey: ['incoming-delegations', username],
    queryFn: async () => {
      if (!username) return [];
      const delegations = await steemApi.getIncomingDelegations(username);
      return delegations.map(d => steemApi.formatDelegation(d, steemPerMvests));
    },
    enabled: !!username && steemPerMvests > 0,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Calculate totals
  const totalDelegatedOut = outgoingDelegations.reduce((sum, d) => sum + parseFloat(d.steemPower), 0);
  const totalDelegatedIn = incomingDelegations.reduce((sum, d) => sum + parseFloat(d.steemPower), 0);

  const refetchAll = () => {
    refetchOutgoing();
    refetchIncoming();
  };

  return {
    outgoingDelegations: outgoingDelegations as FormattedDelegation[],
    incomingDelegations: incomingDelegations as FormattedDelegation[],
    isLoading: outgoingLoading || incomingLoading,
    error: outgoingError || incomingError,
    totalDelegatedOut,
    totalDelegatedIn,
    steemPerMvests,
    refetchAll
  };
};
