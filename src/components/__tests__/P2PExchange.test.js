/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import P2PExchange from '../P2PExchange';
import { useXRPL } from '../../hooks/useXRPL';
import authService from '../../services/authService';

jest.mock('../../hooks/useXRPL');
jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: { authFetch: jest.fn() }
}));

const STATS = {
  total_orders: 10, open_orders: 4, matched_orders: 3, completed_orders: 3,
  total_volume_try: 50000, total_volume_xrp: 1250, avg_rate: 40,
  buy_orders: 5, sell_orders: 5
};

const MARKET_ORDERS = [
  { id: 1, type: 'sell', status: 'open', tryAmount: '1000', xrpAmount: '25', rate: '40', paymentMethods: ['papara'], createdAt: '2026-01-01' }
];

const MY_ORDERS = [
  { id: 2, type: 'buy', status: 'open', tryAmount: '500', xrpAmount: '12.5', rate: '40', paymentMethods: ['papara'], createdAt: '2026-01-01' }
];

const setupFetches = () => {
  global.fetch = jest.fn((url) => {
    if (url.includes('/api/p2p/stats')) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true, stats: STATS }) });
    }
    if (url.includes('/api/p2p/rate')) {
      return Promise.resolve({
        json: () => Promise.resolve({ success: true, rate: 40, timestamp: '2026-01-01T00:00:00Z' })
      });
    }
    if (url.includes('/api/p2p/orders')) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true, orders: MARKET_ORDERS }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
  });
  authService.authFetch.mockImplementation((url) => {
    if (url.includes('/api/p2p/my-orders')) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true, orders: MY_ORDERS }) });
    }
    if (url.includes('/api/p2p/match')) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
  });
};

const renderExchange = async () => {
  useXRPL.mockReturnValue({ apiBaseUrl: 'http://localhost:5001', wallet: { address: 'rMineAddress' } });
  let utils;
  await act(async () => {
    utils = render(<P2PExchange />);
  });
  return utils;
};

beforeEach(() => {
  jest.resetAllMocks();
  setupFetches();
  window.confirm = jest.fn().mockReturnValue(true);
});

describe('P2PExchange', () => {
  test('renders stats, rate and the market order book', async () => {
    await renderExchange();
    expect(screen.getByText(/P2P TRY-XRP Exchange/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('₺40.00').length).toBeGreaterThan(0));
    expect(screen.getByText('10')).toBeInTheDocument(); // total orders
    expect(screen.getByText('₺50000')).toBeInTheDocument();
    expect(screen.getByText('₺1000.00')).toBeInTheDocument(); // market order
  });

  test('tab switching renders Orders, My Orders and Create views', async () => {
    await renderExchange();
    fireEvent.click(screen.getByText('Orders'));
    expect(screen.getByRole('heading', { name: 'All Orders' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('My Orders'));
    await waitFor(() => expect(screen.getByText('₺500.00')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Create Order'));
    expect(screen.getAllByRole('heading', { name: 'Create New Order' }).length).toBeGreaterThan(0);
  });

  test('order click opens OrderDetails', async () => {
    await renderExchange();
    await waitFor(() => screen.getByText('₺1000.00'));
    fireEvent.click(screen.getByText('₺1000.00'));
    expect(screen.getByText('Order Details')).toBeInTheDocument();
    // close via ×
    fireEvent.click(screen.getByText('×'));
    expect(screen.queryByText('Order Details')).not.toBeInTheDocument();
  });

  test('matching requires an own open counter-order', async () => {
    // my orders: a BUY open order; market order is a SELL → compatible
    authService.authFetch.mockImplementation((url) => {
      if (url.includes('/api/p2p/my-orders')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, orders: [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    });
    await renderExchange();
    // wait for empty my-orders fetch for the logged-in wallet address
    fireEvent.click(screen.getByText('My Orders'));
    await act(async () => {});
    fireEvent.click(screen.getByText('Market'));
    await waitFor(() => screen.getByText('₺1000.00'));
    fireEvent.click(screen.getByText('Match'));
    fireEvent.click(screen.getByText('Match order'));
    await waitFor(() =>
      expect(screen.getByText(/You need your own open buy order/)).toBeInTheDocument()
    );
  });

  test('successful match shows success and opens matched order details', async () => {
    await renderExchange();
    fireEvent.click(screen.getByText('My Orders'));
    await waitFor(() => expect(screen.getByText('₺500.00')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Market'));
    await waitFor(() => screen.getByText('₺1000.00'));
    fireEvent.click(screen.getByText('Match'));
    await waitFor(() => screen.getByText('Match order'));
    fireEvent.click(screen.getByText('Match order'));
    await waitFor(() => expect(screen.getByText('Orders matched successfully!')).toBeInTheDocument());
    expect(authService.authFetch).toHaveBeenCalledWith(
      'http://localhost:5001/api/p2p/match',
      expect.objectContaining({
        body: JSON.stringify({ orderId: 2, counterpartyOrderId: 1 })
      })
    );
  });

  test('match server error is shown', async () => {
    authService.authFetch.mockImplementation((url) => {
      if (url.includes('/api/p2p/my-orders')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, orders: MY_ORDERS }) });
      }
      if (url.includes('/api/p2p/match')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'incompatible orders' }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    });
    await renderExchange();
    fireEvent.click(screen.getByText('My Orders'));
    await waitFor(() => expect(screen.getByText('₺500.00')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Market'));
    await waitFor(() => screen.getByText('₺1000.00'));
    fireEvent.click(screen.getByText('Match'));
    await waitFor(() => screen.getByText('Match order'));
    fireEvent.click(screen.getByText('Match order'));
    await waitFor(() => expect(screen.getByText('incompatible orders')).toBeInTheDocument());
  });

  test('refresh button refetches data', async () => {
    await renderExchange();
    const statsCalls = global.fetch.mock.calls.filter(c => c[0].includes('/api/p2p/stats')).length;
    await act(async () => {
      fireEvent.click(screen.getByText('Refresh'));
    });
    const after = global.fetch.mock.calls.filter(c => c[0].includes('/api/p2p/stats')).length;
    expect(after).toBeGreaterThan(statsCalls);
  });

  test('fetch failures are tolerated without crashing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    authService.authFetch.mockRejectedValue(new Error('offline'));
    await renderExchange();
    expect(screen.getByText(/P2P TRY-XRP Exchange/)).toBeInTheDocument();
  });
});
