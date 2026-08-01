/**
 * TRY Rate Scraper Service
 * Scrapes XRP/TRY exchange rates from Turkish crypto exchanges and P2P platforms
 * No API keys required
 */

const axios = require('axios');
const logger = require('../utils/logger');

// Rate cache
let rateCache = {
  rate: null,
  sources: [],
  lastUpdated: null,
  nextUpdate: null
};

// Cache TTL honors RATE_CACHE_TTL_SECONDS (default 300s)
const CACHE_TTL_MS = (parseInt(process.env.RATE_CACHE_TTL_SECONDS, 10) || 300) * 1000;

/**
 * Fetch XRP/TRY rate from CoinGecko (Free, no key required)
 */
async function fetchFromCoinGecko() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'ripple',
        vs_currencies: 'try',
        include_24hr_change: true
      },
      timeout: 5000
    });

    if (response.data && response.data.ripple && response.data.ripple.try) {
      return {
        source: 'CoinGecko',
        rate: response.data.ripple.try,
        change24h: response.data.ripple.try_24h_change || 0,
        timestamp: new Date().toISOString()
      };
    }

    throw new Error('Invalid response from CoinGecko');
  } catch (error) {
    logger.warn('CoinGecko scrape error', { error: error.message });
    return null;
  }
}

/**
 * Fetch XRP/TRY rate from Binance (Public API, no key required)
 */
async function fetchFromBinance() {
  try {
    // Get XRP/USDT from Binance
    const xrpUsdtResponse = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      params: { symbol: 'XRPUSDT' },
      timeout: 5000
    });

    // Get USDT/TRY from Binance
    const usdtTryResponse = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      params: { symbol: 'USDTTRY' },
      timeout: 5000
    });

    if (xrpUsdtResponse.data && usdtTryResponse.data) {
      const xrpUsdt = parseFloat(xrpUsdtResponse.data.lastPrice);
      const usdtTry = parseFloat(usdtTryResponse.data.lastPrice);
      const xrpTry = xrpUsdt * usdtTry;

      const change24h = parseFloat(xrpUsdtResponse.data.priceChangePercent);

      return {
        source: 'Binance',
        rate: xrpTry,
        change24h: change24h,
        timestamp: new Date().toISOString()
      };
    }

    throw new Error('Invalid response from Binance');
  } catch (error) {
    logger.warn('Binance scrape error', { error: error.message });
    return null;
  }
}

/**
 * Fetch XRP/TRY rate from BTCTurk (Turkish exchange, public API)
 */
async function fetchFromBTCTurk() {
  try {
    const response = await axios.get('https://api.btcturk.com/api/v2/ticker', {
      timeout: 5000
    });

    if (response.data && response.data.data) {
      const xrpTryPair = response.data.data.find(pair =>
        pair.pair === 'XRPTRY' || pair.pairSymbol === 'XRPTRY'
      );

      if (xrpTryPair) {
        const rate = parseFloat(xrpTryPair.last || xrpTryPair.lastPrice);
        const change24h = parseFloat(xrpTryPair.dailyChangePercent || 0);

        return {
          source: 'BTCTurk',
          rate: rate,
          change24h: change24h,
          timestamp: new Date().toISOString()
        };
      }
    }

    throw new Error('XRP/TRY pair not found on BTCTurk');
  } catch (error) {
    logger.warn('BTCTurk scrape error', { error: error.message });
    return null;
  }
}

/**
 * Fetch XRP/TRY rate from Paribu (Turkish exchange, public API)
 */
async function fetchFromParibu() {
  try {
    const response = await axios.get('https://www.paribu.com/ticker', {
      timeout: 5000
    });

    if (response.data && response.data.XRP_TL) {
      const xrpData = response.data.XRP_TL;
      const rate = parseFloat(xrpData.last || xrpData.lastPrice);
      const change24h = parseFloat(xrpData.percentChange || 0);

      return {
        source: 'Paribu',
        rate: rate,
        change24h: change24h,
        timestamp: new Date().toISOString()
      };
    }

    throw new Error('XRP/TRY pair not found on Paribu');
  } catch (error) {
    logger.warn('Paribu scrape error', { error: error.message });
    return null;
  }
}

/**
 * Calculate average rate from P2P orders
 */
function calculateP2PRate(p2pOrders) {
  if (!p2pOrders || p2pOrders.length === 0) {
    return null;
  }

  // Filter recent completed orders (DB rows use snake_case field names)
  const recentOrders = p2pOrders.filter(order => {
    if (order.status !== 'completed') return false;

    const completedAt = order.completed_at || order.completedAt;
    if (!completedAt) return false;

    const orderTime = new Date(completedAt);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return orderTime > oneDayAgo;
  });

  if (recentOrders.length === 0) {
    // Use open orders if no recent completed
    const openOrders = p2pOrders.filter(o => o.status === 'open' && o.rate);

    if (openOrders.length === 0) return null;

    const avgRate = openOrders.reduce((sum, o) => sum + o.rate, 0) / openOrders.length;

    return {
      source: 'P2P_Market',
      rate: Math.round(avgRate * 100) / 100,
      change24h: 0,
      ordersCount: openOrders.length,
      timestamp: new Date().toISOString()
    };
  }

  const avgRate = recentOrders.reduce((sum, o) => sum + (o.finalRate || o.final_rate || o.rate), 0) / recentOrders.length;

  return {
    source: 'P2P_Completed',
    rate: Math.round(avgRate * 100) / 100,
    change24h: 0,
    ordersCount: recentOrders.length,
    timestamp: new Date().toISOString()
  };
}

/**
 * Fetch rates from all sources
 */
async function fetchAllRates(p2pOrders = []) {
  logger.debug('Fetching XRP/TRY rates from all sources');

  const sources = await Promise.all([
    fetchFromCoinGecko(),
    fetchFromBinance(),
    fetchFromBTCTurk(),
    fetchFromParibu()
  ]);

  // Add P2P market rate
  const p2pRate = calculateP2PRate(p2pOrders);
  if (p2pRate) {
    sources.push(p2pRate);
  }

  // Filter out null values (failed fetches) and sources with null/NaN rates
  const validSources = sources.filter(s => s !== null && s.rate !== null && s.rate !== undefined && !isNaN(s.rate));

  if (validSources.length === 0) {
    throw new Error('Failed to fetch rates from all sources');
  }

  // Calculate average rate (weighted by source reliability)
  const weights = {
    'CoinGecko': 1.0,
    'Binance': 1.2,
    'BTCTurk': 1.5,    // Turkish exchange, more relevant
    'Paribu': 1.5,      // Turkish exchange, more relevant
    'P2P_Market': 1.3,  // Current market sentiment
    'P2P_Completed': 1.8 // Most relevant - actual trades
  };

  let weightedSum = 0;
  let totalWeight = 0;

  validSources.forEach(source => {
    const weight = weights[source.source] || 1.0;
    weightedSum += source.rate * weight;
    totalWeight += weight;
  });

  const avgRate = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : null;

  // Calculate average change
  const avgChange = validSources.reduce((sum, s) => sum + s.change24h, 0) / validSources.length;

  return {
    rate: avgRate,
    sources: validSources,
    averageChange24h: Math.round(avgChange * 100) / 100,
    timestamp: new Date().toISOString()
  };
}

/**
 * Get current XRP/TRY rate (cached)
 */
async function getCurrentRate(forceRefresh = false, p2pOrders = []) {
  const now = Date.now();

  // Return cached rate if valid
  if (!forceRefresh && rateCache.rate && rateCache.nextUpdate && now < rateCache.nextUpdate) {
    return {
      rate: rateCache.rate,
      sources: rateCache.sources,
      averageChange24h: rateCache.averageChange24h,
      cached: true,
      lastUpdated: rateCache.lastUpdated,
      nextUpdate: rateCache.nextUpdate,
      ttl: Math.floor((rateCache.nextUpdate - now) / 1000)
    };
  }

  // Fetch fresh rates
  try {
    const rateData = await module.exports.fetchAllRates(p2pOrders);

    // Phase 8 Security: Circuit Breaker
    // Prevent sudden huge price swings from draining P2P orders if an oracle glitches.
    if (rateCache.rate) {
      const SystemSettingsDAL = require('../database/dal/systemSettings');
      let circuitBreakerPct = 10.0; // default 10%
      try {
        const settings = await SystemSettingsDAL.getAll();
        if (settings.circuit_breaker_percentage) {
          circuitBreakerPct = parseFloat(settings.circuit_breaker_percentage);
        }
      } catch (e) {
        logger.warn('Failed to read circuit_breaker_percentage, using default 10%');
      }

      const diff = Math.abs(rateData.rate - rateCache.rate);
      const diffPct = (diff / rateCache.rate) * 100;

      if (diffPct > circuitBreakerPct) {
        logger.error(`CIRCUIT BREAKER TRIPPED! Rate swung by ${diffPct.toFixed(2)}% (from ${rateCache.rate} to ${rateData.rate}). Halting updates.`);
        // Return stale cache with a warning instead of the spiked rate.
        // This effectively halts new rate consumption until the market normalizes
        // or a moderator updates the circuit_breaker_percentage.
        return {
          rate: rateCache.rate,
          sources: rateCache.sources,
          averageChange24h: rateCache.averageChange24h,
          cached: true,
          stale: true,
          lastUpdated: rateCache.lastUpdated,
          warning: `Circuit breaker active: price swung by ${diffPct.toFixed(2)}%. Trading temporarily uses last known safe rate.`
        };
      }
    }

    rateCache = {
      rate: rateData.rate,
      sources: rateData.sources,
      averageChange24h: rateData.averageChange24h,
      lastUpdated: rateData.timestamp,
      nextUpdate: now + CACHE_TTL_MS
    };

    return {
      ...rateData,
      cached: false,
      ttl: Math.floor(CACHE_TTL_MS / 1000)
    };
  } catch (error) {
    // If fetch fails and we have old cache, return it with warning
    if (rateCache.rate) {
      logger.warn('Using stale cache due to API failure');
      return {
        rate: rateCache.rate,
        sources: rateCache.sources,
        averageChange24h: rateCache.averageChange24h,
        cached: true,
        stale: true,
        lastUpdated: rateCache.lastUpdated,
        warning: 'Using stale data due to API failure'
      };
    }

    throw error;
  }
}

/**
 * Calculate XRP amount from TRY
 */
async function calculateXRPFromTRY(tryAmount, feePercent = 0) {
  const rateData = await module.exports.getCurrentRate();
  const rate = rateData.rate;

  const xrpBeforeFee = tryAmount / rate;
  const fee = xrpBeforeFee * (feePercent / 100);
  const xrpAfterFee = xrpBeforeFee - fee;

  return {
    tryAmount: tryAmount,
    xrpRate: rate,
    xrpBeforeFee: Math.round(xrpBeforeFee * 1000000) / 1000000,
    fee: Math.round(fee * 1000000) / 1000000,
    feePercent: feePercent,
    xrpAmount: Math.round(xrpAfterFee * 1000000) / 1000000,
    sources: rateData.sources.map(s => s.source),
    calculation: {
      step1: `${tryAmount} TRY ÷ ${rate} = ${xrpBeforeFee.toFixed(6)} XRP`,
      step2: `Fee (${feePercent}%): ${fee.toFixed(6)} XRP`,
      step3: `Final: ${xrpAfterFee.toFixed(6)} XRP`
    }
  };
}

/**
 * Calculate TRY amount from XRP
 */
async function calculateTRYFromXRP(xrpAmount, feePercent = 0) {
  const rateData = await module.exports.getCurrentRate();
  const rate = rateData.rate;

  const xrpAfterFee = xrpAmount / (1 + (feePercent / 100));
  const fee = xrpAmount - xrpAfterFee;
  const tryAmount = xrpAfterFee * rate;

  return {
    xrpAmount: xrpAmount,
    xrpAfterFee: xrpAfterFee,
    fee: fee,
    feePercent: feePercent,
    tryAmount: Math.round(tryAmount * 100) / 100,
    xrpRate: rate,
    sources: rateData.sources.map(s => s.source)
  };
}

/**
 * Get market statistics
 */
function getMarketStats(rateData) {
  const sources = rateData.sources || [];

  return {
    currentRate: rateData.rate,
    change24h: rateData.averageChange24h,
    sourcesCount: sources.length,
    sources: sources.map(s => ({
      name: s.source,
      rate: s.rate,
      change24h: s.change24h,
      timestamp: s.timestamp
    })),
    highestRate: sources.length > 0 ? Math.max(...sources.map(s => s.rate)) : 0,
    lowestRate: sources.length > 0 ? Math.min(...sources.map(s => s.rate)) : 0,
    rateSpread: sources.length > 0 ?
      Math.max(...sources.map(s => s.rate)) - Math.min(...sources.map(s => s.rate)) : 0
  };
}

module.exports = {
  getCurrentRate,
  calculateXRPFromTRY,
  calculateTRYFromXRP,
  getMarketStats,
  fetchAllRates,
  fetchFromCoinGecko,
  fetchFromBinance,
  fetchFromBTCTurk,
  fetchFromParibu,
  calculateP2PRate
};
