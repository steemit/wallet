
// src/utils/Utility.tsx
import { steemApi } from '@/services/steemApi';

// Define the structure of the dynamic global properties we need
interface DynamicGlobalProperties {
  total_vesting_fund_steem: string;
  total_vesting_shares: string;
}

/**
 * Fetches the current Steem per MegaVests (1,000,000 Vests) value.
 *
 * @returns {Promise<number>} A promise that resolves to the current Steem per Mvests value.
 */
export const getSteemPerMvests = async (): Promise<number> => {
  try {
    const properties = await steemApi.getDynamicGlobalProperties();
    const totalVestingFundSteem = parseFloat(properties.total_vesting_fund_steem.split(' ')[0]);
    const totalVestingShares = parseFloat(properties.total_vesting_shares.split(' ')[0]);

    if (totalVestingShares === 0) {
      return 0;
    }

    const steemPerVest = totalVestingFundSteem / totalVestingShares;
    return steemPerVest * 1_000_000; // Steem per MegaVests
  } catch (error) {
    console.error('Error fetching Steem per Mvests:', error);
    throw new Error('Could not fetch Steem per Mvests. Please check the API endpoint and your network connection.');
  }
};

/**
 * Converts Vests to Steem.
 *
 * @param {number} vests The amount of Vests to convert.
 * @param {number} steemPerMvests The current Steem per Mvests value.
 * @returns {number} The equivalent amount of Steem.
 */
export const vestsToSteem = (vests: number, steemPerMvests: number): number => {
  if (steemPerMvests === 0) {
    return 0;
  }
  return (vests / 1_000_000) * steemPerMvests;
};

/**
 * Calculates days until next withdrawal
 *
 * @param {string} nextWithdrawalDate The next withdrawal date string
 * @returns {number} Days until next withdrawal
 */
export const getDaysUntilNextWithdrawal = (nextWithdrawalDate: string): number => {
  const nextDate = new Date(nextWithdrawalDate);
  const now = new Date();
  const diffTime = nextDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};
