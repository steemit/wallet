
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, BarChart3, DollarSign, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMarketData } from "@/hooks/useMarketData";
import { steemApi } from "@/services/steemApi";
import MarketDepthChart from "./MarketDepthChart";
import MarketCharts from "./MarketCharts";

const MarketOperations = () => {
  const [tradeType, setTradeType] = useState("buy");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const { toast } = useToast();
  const { orderBook, ticker, volume, tradeHistory, hourlyHistory, isLoading, error } = useMarketData();

  console.log('MarketOperations data:', { orderBook, ticker, volume, tradeHistory, hourlyHistory, isLoading, error });

  const handleTradeOrder = () => {
    if (!amount || !price) return;
    
    const action = tradeType === "buy" ? "Buying" : "Selling";
    const fromTo = tradeType === "buy" ? "at" : "for";
    
    toast({
      title: `${tradeType === "buy" ? "Buy" : "Sell"} Order Placed`,
      description: `${action} ${amount} STEEM ${fromTo} ${price} SBD each`,
    });
    setAmount("");
    setPrice("");
  };

  // Helper function to format time ago
  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  // Calculate current market stats
  const currentPrice = ticker?.latest ? parseFloat(ticker.latest) : 0;
  const percentChange = ticker?.percent_change ? parseFloat(ticker.percent_change) : 0;
  const steemVolume = volume?.steem_volume || "0";
  const sbdVolume = volume?.sbd_volume || "0";

  if (isLoading) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="bg-white border border-gray-200 shadow-sm">
              <CardContent className="p-4">
                <div className="animate-pulse space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-20"></div>
                  <div className="h-8 bg-gray-200 rounded w-16"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <Card className="bg-white border border-red-200 shadow-sm">
          <CardContent className="p-4">
            <div className="text-center text-red-600">
              <p>Error loading market data</p>
              <p className="text-sm text-gray-500 mt-2">Please check console for details</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Market Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm font-medium text-gray-500">STEEM Price</p>
                <p className="text-lg sm:text-2xl font-bold" style={{ color: '#07d7a9' }}>
                  {steemApi.formatMarketPrice(ticker?.latest || "0")} SBD
                </p>
              </div>
              {percentChange >= 0 ? (
                <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-green-500" />
              ) : (
                <TrendingDown className="w-6 h-6 sm:w-8 sm:h-8 text-red-500" />
              )}
            </div>
            <p className={`text-xs mt-1 ${percentChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {percentChange >= 0 ? '+' : ''}{(percentChange * 100).toFixed(2)}% (24h)
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm font-medium text-gray-500">Spread</p>
                <p className="text-lg sm:text-2xl font-bold text-gray-800">
                  {ticker ? ((parseFloat(ticker.lowest_ask) - parseFloat(ticker.highest_bid)) * 100 / parseFloat(ticker.highest_bid)).toFixed(2) : '0.00'}%
                </p>
              </div>
              <DollarSign className="w-6 h-6 sm:w-8 sm:h-8" style={{ color: '#07d7a9' }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Bid: {steemApi.formatMarketPrice(ticker?.highest_bid || "0")} SBD
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm font-medium text-gray-500">24h Volume</p>
                <p className="text-lg sm:text-2xl font-bold text-gray-800">{steemVolume} STEEM</p>
              </div>
              <BarChart3 className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
            </div>
            <p className="text-xs text-gray-500 mt-1">{sbdVolume} SBD</p>
          </CardContent>
        </Card>

        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm font-medium text-gray-500">Ask Price</p>
                <p className="text-lg sm:text-2xl font-bold text-red-600">
                  {steemApi.formatMarketPrice(ticker?.lowest_ask || "0")} SBD
                </p>
              </div>
              <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-red-500" />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Lowest sell order
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Market Charts */}
      <MarketCharts hourlyHistory={hourlyHistory} ticker={ticker} />

      {/* Market Depth Chart */}
      <MarketDepthChart orderBook={orderBook} />

      <Tabs defaultValue="trade" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-white shadow-sm border border-gray-200">
          <TabsTrigger 
            value="trade" 
            className="data-[state=active]:text-white data-[state=active]:bg-[#07d7a9] text-sm sm:text-base"
          >
            Trade
          </TabsTrigger>
          <TabsTrigger 
            value="orderbook" 
            className="data-[state=active]:text-white data-[state=active]:bg-[#07d7a9] text-sm sm:text-base"
          >
            Order Book
          </TabsTrigger>
          <TabsTrigger 
            value="history" 
            className="data-[state=active]:text-white data-[state=active]:bg-[#07d7a9] text-sm sm:text-base"
          >
            Trade History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trade" className="space-y-4 relative">
          {/* Blurred Trade Content */}
          <div className="blur-sm pointer-events-none">
            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-gray-800 text-lg sm:text-xl">Trade STEEM</CardTitle>
                <CardDescription className="text-gray-500 text-sm sm:text-base">
                  Buy or sell STEEM with SBD
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                  <Button
                    variant={tradeType === "buy" ? "default" : "ghost"}
                    onClick={() => setTradeType("buy")}
                    className={`flex-1 ${tradeType === "buy" 
                      ? "bg-green-600 hover:bg-green-700 text-white" 
                      : "hover:bg-gray-200 text-gray-600"
                    }`}
                  >
                    Buy
                  </Button>
                  <Button
                    variant={tradeType === "sell" ? "default" : "ghost"}
                    onClick={() => setTradeType("sell")}
                    className={`flex-1 ${tradeType === "sell" 
                      ? "bg-red-600 hover:bg-red-700 text-white" 
                      : "hover:bg-gray-200 text-gray-600"
                    }`}
                  >
                    Sell
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trade-amount" className="text-gray-700">Amount (STEEM)</Label>
                  <Input
                    id="trade-amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.000"
                    className="border-gray-300"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="trade-price" className="text-gray-700">Price (SBD per STEEM)</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPrice(ticker?.latest || "0")}
                      className="text-xs text-[#07d7a9] hover:text-[#06c49a]"
                    >
                      Use Market Price
                    </Button>
                  </div>
                  <Input
                    id="trade-price"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.000000"
                    className="border-gray-300"
                  />
                </div>

                <div className="p-3 sm:p-4 rounded-lg" style={{ backgroundColor: '#f5f4f5' }}>
                  <div className="space-y-1 text-xs sm:text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">
                        {tradeType === "buy" ? "Total Cost:" : "Total Receive:"}
                      </span>
                      <span className="text-gray-800">
                        {amount && price ? (parseFloat(amount) * parseFloat(price)).toFixed(3) : "0.000"} SBD
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Market Price:</span>
                      <span style={{ color: '#07d7a9' }}>
                        {steemApi.formatMarketPrice(ticker?.latest || "0")} SBD
                      </span>
                    </div>
                  </div>
                </div>

                <Button 
                  onClick={handleTradeOrder} 
                  className={`w-full text-white text-sm sm:text-base ${
                    tradeType === "buy" 
                      ? "bg-green-600 hover:bg-green-700" 
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                  disabled={!amount || !price}
                >
                  Place {tradeType === "buy" ? "Buy" : "Sell"} Order
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Coming Soon Overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-20 rounded-lg">
            <div className="bg-white px-8 py-6 rounded-lg shadow-lg text-center">
              <h3 className="text-2xl font-bold text-gray-800 mb-2">Coming Soon</h3>
              <p className="text-gray-600">Trading functionality will be available soon</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="orderbook" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-gray-800 text-green-600 text-lg sm:text-xl">Buy Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm font-medium text-gray-500 pb-2 border-b">
                    <span>Price (SBD)</span>
                    <span className="text-right">STEEM</span>
                    <span className="text-right">SBD</span>
                  </div>
                  {orderBook?.bids?.slice(0, 15).map((order, index) => {
                    const formatted = steemApi.formatOrderBookEntry(order);
                    return (
                      <div key={index} className="grid grid-cols-3 gap-2 text-xs sm:text-sm py-1 hover:bg-gray-50 rounded">
                        <span className="text-green-600 font-medium">
                          {formatted.price}
                        </span>
                        <span className="text-right text-gray-800">{formatted.steem}</span>
                        <span className="text-right text-gray-600">{formatted.sbd}</span>
                      </div>
                    );
                  }) || (
                    <div className="text-center text-gray-500 py-4">Loading buy orders...</div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-gray-800 text-red-600 text-lg sm:text-xl">Sell Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm font-medium text-gray-500 pb-2 border-b">
                    <span>Price (SBD)</span>
                    <span className="text-right">STEEM</span>
                    <span className="text-right">SBD</span>
                  </div>
                  {orderBook?.asks?.slice(0, 15).map((order, index) => {
                    const formatted = steemApi.formatOrderBookEntry(order);
                    return (
                      <div key={index} className="grid grid-cols-3 gap-2 text-xs sm:text-sm py-1 hover:bg-gray-50 rounded">
                        <span className="text-red-600 font-medium">
                          {formatted.price}
                        </span>
                        <span className="text-right text-gray-800">{formatted.steem}</span>
                        <span className="text-right text-gray-600">{formatted.sbd}</span>
                      </div>
                    );
                  }) || (
                    <div className="text-center text-gray-500 py-4">Loading sell orders...</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card className="bg-white border border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-gray-800 text-lg sm:text-xl flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Recent Trades
              </CardTitle>
              <CardDescription className="text-gray-500 text-sm sm:text-base">
                Latest STEEM/SBD market trades
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs sm:text-sm">Time</TableHead>
                      <TableHead className="text-xs sm:text-sm text-right">Price (SBD)</TableHead>
                      <TableHead className="text-xs sm:text-sm text-right">STEEM</TableHead>
                      <TableHead className="text-xs sm:text-sm text-right">Total (SBD)</TableHead>
                      <TableHead className="text-xs sm:text-sm text-center">Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tradeHistory.slice(0, 20).map((trade, index) => (
                      <TableRow key={index} className="hover:bg-gray-50">
                        <TableCell className="text-xs sm:text-sm text-gray-600">
                          {formatTimeAgo(trade.date)}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm text-right font-medium">
                          {trade.price.toFixed(3)}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm text-right">
                          {trade.steemAmount.toFixed(3)}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm text-right">
                          {trade.sbdAmount.toFixed(3)}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            trade.type === 'sell' 
                              ? 'bg-red-100 text-red-700' 
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {trade.type.toUpperCase()}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {tradeHistory.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-gray-500 py-4">
                          Loading trade history...
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MarketOperations;
