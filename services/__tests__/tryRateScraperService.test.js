/**
 * Unit Tests for TRY Rate Scraper Service
 */

const axios = require('axios');
const tryRateScraperService = require('../tryRateScraperService');

// Mock axios
jest.mock('axios');
const mockedAxios = axios;

describe('TRY Rate Scraper Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset any cached data
    jest.spyOn(tryRateScraperService, 'getCurrentRate').mockRestore();
  });

  describe('fetchFromCoinGecko', () => {
    it('should fetch rate from CoinGecko successfully', async () => {
      const mockResponse = {
        data: {
          ripple: {
            try: 12.5,
            try_24h_change: 2.5
          }
        }
      };
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await tryRateScraperService.fetchFromCoinGecko();

      expect(result).toEqual({
        source: 'CoinGecko',
        rate: 12.5,
        change24h: 2.5,
        timestamp: expect.any(String)
      });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.coingecko.com/api/v3/simple/price',
        expect.objectContaining({
          params: {
            ids: 'ripple',
            vs_currencies: 'try',
            include_24hr_change: true
          },
          timeout: 5000
        })
      );
    });

    it('should handle CoinGecko API errors', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await tryRateScraperService.fetchFromCoinGecko();

      expect(result).toBeNull();
    });

    it('should handle invalid CoinGecko response', async () => {
      const mockResponse = { data: {} };
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await tryRateScraperService.fetchFromCoinGecko();

      expect(result).toBeNull();
    });
  });

  describe('fetchFromBinance', () => {
    it('should fetch rate from Binance successfully', async () => {
      const xrpUsdtResponse = {
        data: { lastPrice: '0.5', priceChangePercent: '1.5' }
      };
      const usdtTryResponse = {
        data: { lastPrice: '25.0' }
      };

      mockedAxios.get
        .mockResolvedValueOnce(xrpUsdtResponse)
        .mockResolvedValueOnce(usdtTryResponse);

      const result = await tryRateScraperService.fetchFromBinance();

      expect(result).toEqual({
        source: 'Binance',
        rate: 12.5, // 0.5 * 25.0
        change24h: 1.5,
        timestamp: expect.any(String)
      });
    });

    it('should handle Binance API errors', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await tryRateScraperService.fetchFromBinance();

      expect(result).toBeNull();
    });
  });

  describe('fetchFromBTCTurk', () => {
    it('should fetch rate from BTCTurk successfully', async () => {
      const mockResponse = {
        data: {
          data: [
            {
              pair: 'XRPTRY',
              last: '12.5',
              dailyChangePercent: '2.0'
            }
          ]
        }
      };
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await tryRateScraperService.fetchFromBTCTurk();

      expect(result).toEqual({
        source: 'BTCTurk',
        rate: 12.5,
        change24h: 2.0,
        timestamp: expect.any(String)
      });
    });

    it('should handle BTCTurk API errors', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await tryRateScraperService.fetchFromBTCTurk();

      expect(result).toBeNull();
    });
  });

  describe('fetchFromParibu', () => {
    it('should fetch rate from Paribu successfully', async () => {
      const mockResponse = {
        data: {
          XRP_TL: {
            last: '12.5',
            percentChange: '1.5'
          }
        }
      };
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await tryRateScraperService.fetchFromParibu();

      expect(result).toEqual({
        source: 'Paribu',
        rate: 12.5,
        change24h: 1.5,
        timestamp: expect.any(String)
      });
    });

    it('should handle Paribu API errors', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await tryRateScraperService.fetchFromParibu();

      expect(result).toBeNull();
    });
  });

  describe('calculateP2PRate', () => {
    it('should calculate rate from recent completed orders', () => {
      const p2pOrders = [
        {
          status: 'completed',
          completedAt: new Date().toISOString(),
          rate: 12.0
        },
        {
          status: 'completed',
          completedAt: new Date().toISOString(),
          rate: 13.0
        }
      ];

      const result = tryRateScraperService.calculateP2PRate(p2pOrders);

      expect(result).toEqual({
        source: 'P2P_Completed',
        rate: 12.5,
        change24h: 0,
        ordersCount: 2,
        timestamp: expect.any(String)
      });
    });

    it('should calculate rate from open orders when no recent completed', () => {
      const p2pOrders = [
        {
          status: 'open',
          rate: 12.0
        },
        {
          status: 'open',
          rate: 14.0
        }
      ];

      const result = tryRateScraperService.calculateP2PRate(p2pOrders);

      expect(result).toEqual({
        source: 'P2P_Market',
        rate: 13.0,
        change24h: 0,
        ordersCount: 2,
        timestamp: expect.any(String)
      });
    });

    it('should return null for empty orders', () => {
      const result = tryRateScraperService.calculateP2PRate([]);
      expect(result).toBeNull();
    });

    it('should use DB-shaped rows (completed_at / rate) so completed trades influence the rate', () => {
      const dbRows = [
        { status: 'completed', completed_at: new Date().toISOString(), rate: 20.0 },
        { status: 'completed', completed_at: new Date().toISOString(), rate: 22.0 }
      ];

      const result = tryRateScraperService.calculateP2PRate(dbRows);

      expect(result).toEqual({
        source: 'P2P_Completed',
        rate: 21.0,
        change24h: 0,
        ordersCount: 2,
        timestamp: expect.any(String)
      });
    });

    it('should ignore completed orders without a completion timestamp', () => {
      // A completed order with no completed_at/completedAt must not count
      // as a recent trade (previously it counted with an Invalid Date check miss)
      const result = tryRateScraperService.calculateP2PRate([
        { status: 'completed', rate: 50.0 }
      ]);

      expect(result).toBeNull();
    });
  });

  describe('RATE_CACHE_TTL_SECONDS', () => {
    it('honors the env var for cache expiry', async () => {
      jest.resetModules();
      process.env.RATE_CACHE_TTL_SECONDS = '1';
      try {
        const freshService = require('../tryRateScraperService');
        jest.spyOn(freshService, 'fetchAllRates').mockResolvedValue({
          rate: 12.5,
          sources: [{ source: 'CoinGecko', rate: 12.5 }],
          averageChange24h: 0,
          timestamp: new Date().toISOString()
        });

        // First call fetches fresh (ttl ~1s per the env var)
        const first = await freshService.getCurrentRate();
        expect(first.cached).toBe(false);
        expect(first.ttl).toBe(1);

        // Second call within the TTL returns the cache
        const second = await freshService.getCurrentRate();
        expect(second.cached).toBe(true);

        // After ~1s the cache expires and a fresh fetch happens
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const third = await freshService.getCurrentRate();
        expect(third.cached).toBe(false);
      } finally {
        delete process.env.RATE_CACHE_TTL_SECONDS;
        jest.resetModules();
      }
    });
  });

  describe('getCurrentRate', () => {
    it('should return cached rate when valid', async () => {
      // Mock the internal functions to return cached data
      const mockRateData = {
        rate: 12.5,
        sources: [{ source: 'CoinGecko', rate: 12.5 }],
        averageChange24h: 1.5,
        timestamp: new Date().toISOString()
      };

      jest.spyOn(tryRateScraperService, 'fetchAllRates').mockResolvedValueOnce(mockRateData);

      // First call should fetch fresh data
      const result1 = await tryRateScraperService.getCurrentRate();
      expect(result1.cached).toBe(false);

      // Second call should return cached data
      const result2 = await tryRateScraperService.getCurrentRate();
      expect(result2.cached).toBe(true);
    });

    it('should force refresh when requested', async () => {
      const mockRateData = {
        rate: 12.5,
        sources: [{ source: 'CoinGecko', rate: 12.5 }],
        averageChange24h: 1.5,
        timestamp: new Date().toISOString()
      };

      jest.spyOn(tryRateScraperService, 'fetchAllRates').mockResolvedValue(mockRateData);

      const result = await tryRateScraperService.getCurrentRate(true);
      expect(result.cached).toBe(false);
    });
  });

  describe('calculateXRPFromTRY', () => {
    it('should calculate XRP amount from TRY with fee', async () => {
      jest.spyOn(tryRateScraperService, 'getCurrentRate').mockResolvedValueOnce({
        rate: 10.0,
        sources: [{ source: 'CoinGecko' }]
      });

      const result = await tryRateScraperService.calculateXRPFromTRY(100, 1.5);

      expect(result).toEqual({
        tryAmount: 100,
        xrpRate: 10.0,
        xrpBeforeFee: 10.0,
        fee: 0.15,
        feePercent: 1.5,
        xrpAmount: 9.85,
        sources: ['CoinGecko'],
        calculation: expect.objectContaining({
          step1: '100 TRY ÷ 10 = 10.000000 XRP',
          step2: 'Fee (1.5%): 0.150000 XRP',
          step3: 'Final: 9.850000 XRP'
        })
      });
    });
  });

  describe('calculateTRYFromXRP', () => {
    it('should calculate TRY amount from XRP with fee', async () => {
      jest.spyOn(tryRateScraperService, 'getCurrentRate').mockResolvedValueOnce({
        rate: 10.0,
        sources: [{ source: 'CoinGecko' }]
      });

      const result = await tryRateScraperService.calculateTRYFromXRP(10, 1.5);

      expect(result).toEqual({
        xrpAmount: 10,
        xrpAfterFee: 9.852216748768473,
        fee: 0.1477832512315267,
        feePercent: 1.5,
        tryAmount: 98.52,
        xrpRate: 10.0,
        sources: ['CoinGecko']
      });
    });
  });

  describe('getMarketStats', () => {
    it('should return market statistics', () => {
      const rateData = {
        rate: 12.5,
        averageChange24h: 1.5,
        sources: [
          { source: 'CoinGecko', rate: 12.0, change24h: 1.0, timestamp: '2023-01-01T00:00:00Z' },
          { source: 'Binance', rate: 13.0, change24h: 2.0, timestamp: '2023-01-01T00:00:00Z' }
        ]
      };

      const result = tryRateScraperService.getMarketStats(rateData);

      expect(result).toEqual({
        currentRate: 12.5,
        change24h: 1.5,
        sourcesCount: 2,
        sources: [
          { name: 'CoinGecko', rate: 12.0, change24h: 1.0, timestamp: '2023-01-01T00:00:00Z' },
          { name: 'Binance', rate: 13.0, change24h: 2.0, timestamp: '2023-01-01T00:00:00Z' }
        ],
        highestRate: 13.0,
        lowestRate: 12.0,
        rateSpread: 1.0
      });
    });
  });

  describe('scraper invalid-response branches (PRD 7.1.3)', () => {
    it('Binance returns null when the response is unusable', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: null })
        .mockResolvedValueOnce({ data: null });
      const result = await tryRateScraperService.fetchFromBinance();
      expect(result).toBeNull();
    });

    it('BTCTurk returns null when the XRP/TRY pair is missing', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { data: [{ pair: 'BTCTRY' }] } });
      const result = await tryRateScraperService.fetchFromBTCTurk();
      expect(result).toBeNull();
    });

    it('Paribu returns null when the XRP_TL market is missing', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { BTC_TL: { last: '1' } } });
      const result = await tryRateScraperService.fetchFromParibu();
      expect(result).toBeNull();
    });
  });

  describe('fetchAllRates aggregation branches (PRD 7.1.3)', () => {
    // Earlier describes spy on fetchAllRates with persistent implementations;
    // restore the real function so these tests exercise the aggregation logic.
    beforeEach(() => {
      jest.restoreAllMocks();
    });

    const mockAllSources = () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: { ripple: { try: 12, try_24h_change: 1 } } }) // CoinGecko
        .mockResolvedValueOnce({ data: { lastPrice: '0.5', priceChangePercent: '1' } }) // Binance XRP/USDT
        .mockResolvedValueOnce({ data: { data: [{ pair: 'XRPTRY', last: '13', dailyChangePercent: '2' }] } }) // BTCTurk
        .mockResolvedValueOnce({ data: { XRP_TL: { last: '12.5', percentChange: '1.5' } } }) // Paribu
        .mockResolvedValueOnce({ data: { lastPrice: '25.0' } }); // Binance USDT/TRY (second call)
    };

    it('includes the P2P market rate when orders are provided', async () => {
      mockAllSources();
      const result = await tryRateScraperService.fetchAllRates([
        { status: 'open', rate: 14 }
      ]);
      expect(result.sources.some(s => s.source === 'P2P_Market')).toBe(true);
    });

    it('filters out null and NaN source rates', async () => {
      mockedAxios.get
        .mockRejectedValueOnce(new Error('cg down'))            // CoinGecko
        .mockRejectedValueOnce(new Error('binance down'))       // Binance XRP/USDT
        .mockResolvedValueOnce({ data: { data: [{ pair: 'XRPTRY', last: 'abc', dailyChangePercent: '2' }] } }) // BTCTurk NaN rate
        .mockResolvedValueOnce({ data: { XRP_TL: { last: '12.5', percentChange: '1.5' } } }) // Paribu
        .mockRejectedValueOnce(new Error('binance down'));      // Binance USDT/TRY (second call)
      const result = await tryRateScraperService.fetchAllRates();
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].source).toBe('Paribu');
    });

    it('throws when every source fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('all down'));
      await expect(tryRateScraperService.fetchAllRates()).rejects.toThrow(
        'Failed to fetch rates from all sources'
      );
    });
  });

  describe('getCurrentRate stale-cache fallback (PRD 7.1.3)', () => {
    it('serves the stale cache with a warning when refetch fails', async () => {
      // Seed the cache with a fresh fetch
      jest.spyOn(tryRateScraperService, 'fetchAllRates').mockResolvedValueOnce({
        rate: 12.5,
        sources: [{ source: 'CoinGecko', rate: 12.5 }],
        averageChange24h: 1.5,
        timestamp: new Date().toISOString()
      });
      await tryRateScraperService.getCurrentRate(true);

      // Now fail the refetch — the stale cache must be returned
      jest.spyOn(tryRateScraperService, 'fetchAllRates').mockRejectedValueOnce(new Error('api down'));
      const result = await tryRateScraperService.getCurrentRate(true);
      expect(result.stale).toBe(true);
      expect(result.cached).toBe(true);
      expect(result.warning).toMatch(/stale/i);
      expect(result.rate).toBe(12.5);
    });
  });
});