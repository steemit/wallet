
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface MarketDepthChartProps {
  orderBook: {
    bids: Array<{
      order_price: {
        base: { amount: string; precision: number; nai: string };
        quote: { amount: string; precision: number; nai: string };
      };
      real_price: string;
      created: string;
    }>;
    asks: Array<{
      order_price: {
        base: { amount: string; precision: number; nai: string };
        quote: { amount: string; precision: number; nai: string };
      };
      real_price: string;
      created: string;
    }>;
  } | null;
}

const MarketDepthChart = ({ orderBook }: MarketDepthChartProps) => {
  const depthData = useMemo(() => {
    if (!orderBook || !orderBook.bids || !orderBook.asks) return [];

    // Process bids (buy orders) - highest price first
    const bidOrders = orderBook.bids
      .map(order => {
        const price = parseFloat(order.real_price);
        const volume = parseInt(order.order_price.quote.amount) / Math.pow(10, order.order_price.quote.precision);
        return { price, volume };
      })
      .sort((a, b) => b.price - a.price);

    // Process asks (sell orders) - lowest price first  
    const askOrders = orderBook.asks
      .map(order => {
        const price = parseFloat(order.real_price);
        const volume = parseInt(order.order_price.base.amount) / Math.pow(10, order.order_price.base.precision);
        return { price, volume };
      })
      .sort((a, b) => a.price - b.price);

    // Calculate cumulative volumes for bids (from highest to lowest price)
    let cumulativeBidVolume = 0;
    const bidDepthData = bidOrders.map(order => {
      cumulativeBidVolume += order.volume;
      return {
        price: order.price,
        bidDepth: cumulativeBidVolume,
        askDepth: 0
      };
    }).reverse(); // Reverse to show lowest to highest prices

    // Calculate cumulative volumes for asks (from lowest to highest price)
    let cumulativeAskVolume = 0;
    const askDepthData = askOrders.map(order => {
      cumulativeAskVolume += order.volume;
      return {
        price: order.price,
        bidDepth: 0,
        askDepth: cumulativeAskVolume
      };
    });

    // Combine and sort by price
    const combinedData = [...bidDepthData, ...askDepthData]
      .sort((a, b) => a.price - b.price);

    return combinedData;
  }, [orderBook]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const isBid = data.bidDepth > 0;
      const depth = isBid ? data.bidDepth : data.askDepth;
      
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-medium">Price: {parseFloat(label).toFixed(6)} SBD</p>
          <p className={isBid ? "text-green-600" : "text-red-600"}>
            {isBid ? 'Buy' : 'Sell'} Depth: {depth.toFixed(3)} STEEM
          </p>
        </div>
      );
    }
    return null;
  };

  if (!orderBook || depthData.length === 0) {
    return (
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-gray-800 text-lg">Market Depth Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-gray-500 py-8">
            Loading market depth data...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white border border-gray-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-gray-800 text-lg">Market Depth Chart</CardTitle>
        <p className="text-sm text-gray-500">Combined buy and sell order depth</p>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={depthData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis 
                dataKey="price" 
                tickFormatter={(value) => parseFloat(value).toFixed(4)}
                className="text-xs"
              />
              <YAxis 
                tickFormatter={(value) => `${value.toFixed(0)}`}
                className="text-xs"
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="stepAfter"
                dataKey="bidDepth"
                stackId="1"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.3}
                strokeWidth={2}
              />
              <Area
                type="stepAfter"
                dataKey="askDepth"
                stackId="1"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.3}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

export default MarketDepthChart;
