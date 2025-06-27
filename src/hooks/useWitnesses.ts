
import { useQuery } from '@tanstack/react-query';
import { steemApi } from '@/services/steemApi';

export const useWitnesses = () => {
  return useQuery({
    queryKey: ['witnesses'],
    queryFn: () => steemApi.getWitnessesByVote(null, 150),
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000, // Consider data stale after 30 seconds
  });
};

// Helper function to format votes in millions
const formatVotesInMillions = (rawVests: string): string => {
  const vests = parseFloat(rawVests);
  const millions = vests / 1000000000000000; // Convert to millions (15 zeros)
  return `${millions.toFixed(1)}M`;
};

// Helper function to check if witness is disabled due to signing key
const isWitnessDisabledByKey = (witness: any): boolean => {
  return witness.signing_key && witness.signing_key.startsWith('STM1111111111');
};

// Helper function to check if witness has invalid version
const hasInvalidVersion = (witness: any): boolean => {
  return witness.running_version !== '0.23.1';
};

export const useWitnessData = (loggedInUser: string | null) => {
  const { data: witnesses, isLoading: witnessesLoading, error: witnessesError } = useWitnesses();
  const { data: userData, isLoading: userLoading } = useQuery({
    queryKey: ['userWitnessVotes', loggedInUser],
    queryFn: () => loggedInUser ? steemApi.getAccount(loggedInUser) : null,
    enabled: !!loggedInUser,
  });

  const userWitnessVotes = userData?.witness_votes || [];

  const formattedWitnesses = witnesses?.map((witness, index) => {
    const isDisabledByKey = isWitnessDisabledByKey(witness);
    const hasInvalidVer = hasInvalidVersion(witness);
    
    return {
      name: witness.owner,
      votes: formatVotesInMillions(witness.votes),
      voted: userWitnessVotes.includes(witness.owner),
      rank: index + 1,
      version: witness.running_version,
      url: witness.url,
      missedBlocks: witness.total_missed,
      lastBlock: witness.last_confirmed_block_num,
      signing_key: witness.signing_key,
      isDisabledByKey,
      hasInvalidVersion: hasInvalidVer,
      isDisabled: isDisabledByKey || hasInvalidVer,
    };
  }) || [];

  return {
    witnesses: formattedWitnesses,
    isLoading: witnessesLoading || userLoading,
    error: witnessesError,
    userVoteCount: userWitnessVotes.length,
  };
};
