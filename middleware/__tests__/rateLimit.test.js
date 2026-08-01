/**
 * Unit Tests for Rate Limiting Middleware
 */

const { createRateLimiter, getRateLimitStats, resetClientRateLimit, RATE_LIMITS } = require('../rateLimit');

describe('Rate Limiting Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('Mozilla/5.0 Test Browser'),
      connection: { remoteAddress: '127.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' }
    };

    mockRes = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockNext = jest.fn();

    // Clear ALL existing rate limit data — the store is a module-level
    // singleton; '' matches every key in resetClientRateLimit.
    resetClientRateLimit('');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('RATE_LIMITS', () => {
    it('should have correct rate limit configurations', () => {
      expect(RATE_LIMITS['exchange-rates']).toEqual({
        maxRequests: 60,
        windowMs: 60000
      });
      expect(RATE_LIMITS['payment-intent']).toEqual({
        maxRequests: 10,
        windowMs: 60000
      });
      expect(RATE_LIMITS['conversion']).toEqual({
        maxRequests: 20,
        windowMs: 60000
      });
      expect(RATE_LIMITS['default']).toEqual({
        maxRequests: 100,
        windowMs: 60000
      });
    });
  });

  describe('createRateLimiter', () => {
    it('should allow requests within limit', () => {
      const rateLimiter = createRateLimiter('exchange-rates');

      // First request
      rateLimiter(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 60);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 59);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
    });

    it('should block requests exceeding limit', () => {
      const rateLimiter = createRateLimiter('payment-intent'); // 10 requests per minute

      // Make 11 requests
      for (let i = 0; i < 11; i++) {
        const req = { ...mockReq };
        const res = { ...mockRes };
        const next = jest.fn();
        
        rateLimiter(req, res, next);
      }

      // Last request should be blocked
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Rate limit exceeded',
        message: expect.stringContaining('Too many requests'),
        retryAfter: expect.any(Number),
        limit: 10,
        windowMs: 60000
      });
    });

    it('should reset window after expiration', (done) => {
      const rateLimiter = createRateLimiter('payment-intent');
      
      // Mock Date.now to control time
      const originalNow = Date.now;
      let currentTime = 1000000;
      Date.now = jest.fn(() => currentTime);

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        const req = { ...mockReq };
        const res = { ...mockRes };
        const next = jest.fn();
        
        rateLimiter(req, res, next);
      }

      // Advance time by 61 seconds (window expired)
      currentTime += 61000;

      // Make another request - should reset window
      const req = { ...mockReq };
      const res = { ...mockRes };
      const next = jest.fn();
      
      rateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 9);

      // Restore Date.now
      Date.now = originalNow;
      done();
    });

    it('should use default rate limit for unknown type', () => {
      const rateLimiter = createRateLimiter('unknown-type');

      rateLimiter(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle missing IP address', () => {
      const reqWithoutIP = {
        get: jest.fn().mockReturnValue('Mozilla/5.0 Test Browser'),
        connection: {},
        socket: {}
      };

      const rateLimiter = createRateLimiter('exchange-rates');
      rateLimiter(reqWithoutIP, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should include retry-after header when rate limited', () => {
      const rateLimiter = createRateLimiter('payment-intent');

      // Exceed rate limit
      for (let i = 0; i < 11; i++) {
        const req = { ...mockReq };
        const res = { ...mockRes };
        const next = jest.fn();
        
        rateLimiter(req, res, next);
      }

      expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    });
  });

  describe('getRateLimitStats', () => {
    it('should return empty stats initially', () => {
      const stats = getRateLimitStats();

      expect(stats).toEqual({
        totalClients: 0,
        byType: {},
        topClients: []
      });
    });

    it('should track stats after requests', () => {
      const rateLimiter = createRateLimiter('exchange-rates');

      // Make some requests
      for (let i = 0; i < 3; i++) {
        const req = { ...mockReq, ip: `127.0.0.${i}` };
        const res = { ...mockRes };
        const next = jest.fn();
        
        rateLimiter(req, res, next);
      }

      const stats = getRateLimitStats();

      // byType keys derive from key.split('_')[0], so 'exchange-rates'
      // keeps its hyphen and 'payment-intent' likewise.
      expect(stats.totalClients).toBe(3);
      expect(stats.byType['exchange-rates']).toBeDefined();
      expect(stats.byType['exchange-rates'].clients).toBe(3);
      expect(stats.byType['exchange-rates'].totalRequests).toBe(3);
      expect(stats.topClients).toHaveLength(3);
    });
  });

  describe('resetClientRateLimit', () => {
    it('should reset rate limit for specific client', () => {
      const rateLimiter = createRateLimiter('exchange-rates');

      // Make requests from specific client
      const clientReq = { ...mockReq, ip: '192.168.1.100' };
      for (let i = 0; i < 3; i++) {
        const res = { ...mockRes };
        const next = jest.fn();
        rateLimiter(clientReq, res, next);
      }

      // Reset client
      const resetCount = resetClientRateLimit('192.168.1.100');

      expect(resetCount).toBeGreaterThan(0);

      // Make another request - should start fresh
      const res = { ...mockRes };
      const next = jest.fn();
      rateLimiter(clientReq, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 59);
    });

    it('should return 0 for non-existent client', () => {
      const resetCount = resetClientRateLimit('non-existent-client');
      expect(resetCount).toBe(0);
    });
  });

  describe('Client Identification', () => {
    it('should use IP address for client identification', () => {
      const rateLimiter = createRateLimiter('exchange-rates');
      
      const req1 = { ...mockReq, ip: '192.168.1.1' };
      const req2 = { ...mockReq, ip: '192.168.1.2' };

      rateLimiter(req1, mockRes, mockNext);
      rateLimiter(req2, mockRes, mockNext);

      const stats = getRateLimitStats();
      expect(stats.totalClients).toBe(2);
    });

    it('should combine IP and user agent for identification', () => {
      const rateLimiter = createRateLimiter('exchange-rates');
      
      const req1 = { 
        ...mockReq, 
        ip: '192.168.1.1',
        get: jest.fn().mockReturnValue('Mozilla/5.0 Browser1')
      };
      const req2 = { 
        ...mockReq, 
        ip: '192.168.1.1',
        get: jest.fn().mockReturnValue('Mozilla/5.0 Browser2')
      };

      rateLimiter(req1, mockRes, mockNext);
      rateLimiter(req2, mockRes, mockNext);

      const stats = getRateLimitStats();
      expect(stats.totalClients).toBe(2); // Different user agents = different clients
    });
  });

  describe('Rate Limit Headers', () => {
    it('should set correct headers for first request', () => {
      const rateLimiter = createRateLimiter('exchange-rates');
      rateLimiter(mockReq, mockRes, mockNext);

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 60);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 59);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
    });

    it('should set correct headers for subsequent requests', () => {
      const rateLimiter = createRateLimiter('exchange-rates');

      // First request
      rateLimiter(mockReq, mockRes, mockNext);
      
      // Second request
      const res2 = { ...mockRes };
      const next2 = jest.fn();
      rateLimiter(mockReq, res2, next2);

      expect(res2.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 58);
    });

    it('should set retry-after header when rate limited', () => {
      const rateLimiter = createRateLimiter('payment-intent');

      // Exceed rate limit
      for (let i = 0; i < 11; i++) {
        const req = { ...mockReq };
        const res = { ...mockRes };
        const next = jest.fn();
        
        rateLimiter(req, res, next);
      }

      expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing user agent', () => {
      const req = {
        ...mockReq,
        get: jest.fn().mockReturnValue(undefined)
      };

      const rateLimiter = createRateLimiter('exchange-rates');
      rateLimiter(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle very long user agent', () => {
      const longUserAgent = 'A'.repeat(100);
      const req = {
        ...mockReq,
        get: jest.fn().mockReturnValue(longUserAgent)
      };

      const rateLimiter = createRateLimiter('exchange-rates');
      rateLimiter(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle concurrent requests', () => {
      const rateLimiter = createRateLimiter('payment-intent');
      const promises = [];

      // Make 5 concurrent requests
      for (let i = 0; i < 5; i++) {
        const req = { ...mockReq };
        const res = { ...mockRes };
        const next = jest.fn();
        
        promises.push(new Promise(resolve => {
          rateLimiter(req, res, next);
          resolve();
        }));
      }

      return Promise.all(promises).then(() => {
        const stats = getRateLimitStats();
        expect(stats.totalClients).toBe(1);
        expect(stats.byType['payment-intent'].totalRequests).toBe(5);
      });
    });
  });
});