
import { useQuery } from '@tanstack/react-query';
import { steemApi, SteemAccount } from '@/services/steemApi';
import { priceApi } from '@/services/priceApi';
import { getSteemPerMvests, vestsToSteem } from '@/utils/utility';

export interface WalletData {
  steem: string;
  steemPower: string;
  sbd: string;
  savings: {
    steem: string;
    sbd: string;
  };
  delegated: string;
  received: string;
  reputation: number;
  votingPower: number;
  resourceCredits: number;
  accountValue: string;
  usdValue: string;
  steemPrice: number;
  sbdPrice: number;
}

export const useSteemAccount = (username: string) => {
  return useQuery({
    queryKey: ['steemAccount', username],
    queryFn: () => steemApi.getAccount(username),
    enabled: !!username,
    refetchInterval: 30000, // Refetch every 30 seconds
    staleTime: 10000, // Consider data stale after 10 seconds
  });
};

export const formatWalletData = async (account: SteemAccount): Promise<WalletData> => {
  const steem = steemApi.parseAmount(account.balance);
  const sbd = steemApi.parseAmount(account.sbd_balance);
  const savingsSteem = steemApi.parseAmount(account.savings_balance);
  const savingsSbd = steemApi.parseAmount(account.savings_sbd_balance);
  const delegatedVests = steemApi.parseAmount(account.delegated_vesting_shares);
  const receivedVests = steemApi.parseAmount(account.received_vesting_shares);
  const vestingShares = steemApi.parseAmount(account.vesting_shares);
  
  try {
    // Get current STEEM per Mvests conversion rate and USD prices
    const [steemPerMvests, prices] = await Promise.all([
      getSteemPerMvests(),
      priceApi.getCurrentPrices()
    ]);
    
    // Convert Vests to STEEM Power using the utility functions
    const steemPower = vestsToSteem(vestingShares, steemPerMvests);
    const delegatedSP = vestsToSteem(delegatedVests, steemPerMvests);
    const receivedSP = vestsToSteem(receivedVests, steemPerMvests);
    
    const reputation = steemApi.formatReputation(account.reputation);
    const votingPower = account.voting_power / 100; // Convert from basis points to percentage
    
    // Calculate USD values
    const steemValueUsd = (steem + steemPower + savingsSteem) * prices.steemPrice;
    const sbdValueUsd = (sbd + savingsSbd) * prices.sbdPrice;
    const totalUsdValue = steemValueUsd + sbdValueUsd;
    
    // Simple account value calculation (STEEM + SBD + STEEM Power)
    const accountValue = steem + sbd + steemPower + savingsSteem + savingsSbd;

    return {
      steem: steem.toFixed(3),
      steemPower: steemPower.toFixed(3),
      sbd: sbd.toFixed(3),
      savings: {
        steem: savingsSteem.toFixed(3),
        sbd: savingsSbd.toFixed(3),
      },
      delegated: delegatedSP.toFixed(3),
      received: receivedSP.toFixed(3),
      reputation,
      votingPower,
      resourceCredits: 85, // Placeholder - would need separate API call
      accountValue: accountValue.toFixed(2),
      usdValue: totalUsdValue.toFixed(2),
      steemPrice: prices.steemPrice,
      sbdPrice: prices.sbdPrice,
    };
  } catch (error) {
    console.error('Error converting Vests to STEEM Power or fetching prices:', error);
    
    // Fallback to rough approximation if API call fails
    const steemPower = vestingShares / 1000000; // Rough approximation
    const delegatedSP = delegatedVests / 1000000;
    const receivedSP = receivedVests / 1000000;
    
    const reputation = steemApi.formatReputation(account.reputation);
    const votingPower = account.voting_power / 100;
    const accountValue = steem + sbd + steemPower + savingsSteem + savingsSbd;
    
    // Fallback USD calculation with default prices
    const totalUsdValue = ((steem + steemPower + savingsSteem) * 0.25) + ((sbd + savingsSbd) * 1.0);

    return {
      steem: steem.toFixed(3),
      steemPower: steemPower.toFixed(3),
      sbd: sbd.toFixed(3),
      savings: {
        steem: savingsSteem.toFixed(3),
        sbd: savingsSbd.toFixed(3),
      },
      delegated: delegatedSP.toFixed(3),
      received: receivedSP.toFixed(3),
      reputation,
      votingPower,
      resourceCredits: 85,
      accountValue: accountValue.toFixed(2),
      usdValue: totalUsdValue.toFixed(2),
      steemPrice: 0.25,
      sbdPrice: 1.0,
    };
  }
};
