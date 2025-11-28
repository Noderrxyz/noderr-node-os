export interface SorFlags {
  useProduction: boolean;
  enabledVenues: string[];
  maxRetries: number;
  quoteCacheMs: number;
  failOnHighImpact: boolean;
}

export function loadSorFlags(): SorFlags {
  const enabledCsv = process.env.SOR_ENABLED_VENUES || 'uniswap_v3,sushiswap,0x_api';
  return {
    useProduction: (process.env.SOR_USE_PRODUCTION || 'false').toLowerCase() === 'true',
    enabledVenues: enabledCsv.split(',').map(s => s.trim()).filter(Boolean),
    maxRetries: parseInt(process.env.SOR_MAX_RETRIES || '2', 10),
    quoteCacheMs: parseInt(process.env.SOR_QUOTE_CACHE_MS || '3000', 10),
    failOnHighImpact: (process.env.SOR_FAIL_ON_HIGH_IMPACT || 'true').toLowerCase() === 'true',
  };
}


