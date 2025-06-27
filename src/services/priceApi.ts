
export interface PriceData {
  symbol: string;
  price_usd: number;
}

export class PriceApiService {
  private readonly STEEM_PRICE_URL = 'https://price.blazeapps.org/steemusd';
  private readonly SBD_PRICE_URL = 'https://price.blazeapps.org/sbdusd';

  async getSteemPrice(): Promise<number> {
    try {
      const response = await fetch(this.STEEM_PRICE_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: PriceData = await response.json();
      return data.price_usd;
    } catch (error) {
      console.error('Error fetching STEEM price:', error);
      return 0.25; // Fallback price
    }
  }

  async getSbdPrice(): Promise<number> {
    try {
      const response = await fetch(this.SBD_PRICE_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: PriceData = await response.json();
      return data.price_usd;
    } catch (error) {
      console.error('Error fetching SBD price:', error);
      return 1.0; // Fallback price
    }
  }

  async getCurrentPrices(): Promise<{ steemPrice: number; sbdPrice: number }> {
    try {
      const [steemPrice, sbdPrice] = await Promise.all([
        this.getSteemPrice(),
        this.getSbdPrice()
      ]);
      
      return { steemPrice, sbdPrice };
    } catch (error) {
      console.error('Error fetching current prices:', error);
      return { steemPrice: 0.25, sbdPrice: 1.0 };
    }
  }
}

export const priceApi = new PriceApiService();
