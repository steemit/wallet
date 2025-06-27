
import { useQuery } from '@tanstack/react-query';
import { steemApi } from '@/services/steemApi';

export const useMarketData = () => {
  const { data: marketData, isLoading, error } = useQuery({
    queryKey: ['simplifiedMarketData'],
    queryFn: () => steemApi.getSimplifiedMarketData(),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const { data: hourlyHistory } = useQuery({
    queryKey: ['hourlyMarketHistory'],
    queryFn: () => steemApi.getHourlyMarketHistory(),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: dailyHistory } = useQuery({
    queryKey: ['dailyMarketHistory'],  
    queryFn: () => steemApi.getDailyMarketHistory(),
    refetchInterval: 300000,
    staleTime: 120000,
  });

  console.log('Market data hook result:', { marketData, hourlyHistory, dailyHistory, isLoading, error });

  return {
    orderBook: marketData?.orderBook,
    ticker: marketData?.ticker,
    volume: marketData?.volume ? {
      steem_volume: marketData.volume.steem_volume,
      sbd_volume: marketData.volume.sbd_volume
    } : null,
    tradeHistory: marketData?.recentTrades || [],
    hourlyHistory: hourlyHistory || [],
    dailyHistory: dailyHistory || [],
    isLoading,
    error
  };
};
