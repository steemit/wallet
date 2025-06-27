
// Centralized API configuration
export const API_CONFIG = {
  // Primary Steem API endpoints (in order of preference) - steemyy.com prioritized
  STEEM_ENDPOINTS: [
    'https://api.steemyy.com',
    'https://api.steemit.com',
    'https://api.botsteem.com'
  ],
  
  // Default endpoint index
  DEFAULT_ENDPOINT_INDEX: 0,
  
  // Request timeout (in milliseconds)
  REQUEST_TIMEOUT: 10000,
  
  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000
};

// Get the current primary endpoint
export const getPrimaryEndpoint = (): string => {
  return API_CONFIG.STEEM_ENDPOINTS[API_CONFIG.DEFAULT_ENDPOINT_INDEX];
};

// Get all endpoints
export const getAllEndpoints = (): string[] => {
  return [...API_CONFIG.STEEM_ENDPOINTS];
};
