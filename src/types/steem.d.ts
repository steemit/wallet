
declare global {
  interface Window {
    steem?: {
      api: {
        getAccountHistory: (
          account: string, 
          from: number, 
          limit: number, 
          callback: (error: any, result: any) => void
        ) => void;
      };
    };
  }
}

export {};
