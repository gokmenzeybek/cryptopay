/**
 * @jest-environment jsdom
 */
/**
 * Unit Tests for Dashboard Component
 *
 * Rewritten in Phase 7 (PRD 7.1.1) against the current Dashboard.js: stat
 * cards grid, refresh button, and Recent Transactions / Recent Payment
 * Requests sections with empty states.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { XRPLProvider } from '../../hooks/useXRPL';
import Dashboard from '../Dashboard';

// Mock the useXRPL hook
const mockUseXRPL = {
  wallet: {
    address: 'rTest1234567890123456789012345678901234'
  },
  isConnected: true,
  balance: '1000',
  loading: false,
  apiBaseUrl: 'http://localhost:5001'
};

jest.mock('../../hooks/useXRPL', () => ({
  useXRPL: () => mockUseXRPL,
  XRPLProvider: ({ children }) => <div data-testid="xrpl-provider">{children}</div>
}));

// Mock fetch
global.fetch = jest.fn();

const STATS_BODY = {
  success: true,
  stats: {
    active_wallets: 5,
    total_transactions: 100,
    total_requests: 7,
    pending_requests: 2,
    total_volume_xrp: 1000,
    recent_transactions_24h: 3
  }
};

const TRANSACTIONS_BODY = {
  success: true,
  transactions: [
    {
      amount: 10,
      from_address: 'rSender',
      to_address: 'rRecipient',
      memo: 'test memo',
      timestamp: '2026-07-31T12:00:00Z'
    }
  ]
};

const REQUESTS_BODY = {
  success: true,
  payment_requests: [
    {
      amount: 5,
      recipient: 'rRecipient',
      status: 'pending',
      created_at: '2026-07-31T12:00:00Z'
    }
  ]
};

function mockFetchAll() {
  global.fetch.mockImplementation((url) => {
    let body = { success: true };
    if (url.includes('/api/stats')) body = STATS_BODY;
    else if (url.includes('/api/transactions')) body = TRANSACTIONS_BODY;
    else if (url.includes('/api/payment_requests')) body = REQUESTS_BODY;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
}

describe('Dashboard Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAll();
  });

  it('renders the dashboard with fetched statistics', async () => {
    render(
      <XRPLProvider>
        <Dashboard />
      </XRPLProvider>
    );

    expect(screen.getByText(/Dashboard/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    expect(screen.getByText('Active Wallets')).toBeInTheDocument();
    expect(screen.getByText('Total Transactions')).toBeInTheDocument();
    expect(screen.getByText('Payment Requests')).toBeInTheDocument();
    expect(screen.getByText('Pending Requests')).toBeInTheDocument();
    expect(screen.getByText('Total Volume (XRP)')).toBeInTheDocument();
    expect(screen.getByText('Recent (24h)')).toBeInTheDocument();
  });

  it('lists recent transactions and payment requests', async () => {
    render(
      <XRPLProvider>
        <Dashboard />
      </XRPLProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('10 XRP')).toBeInTheDocument();
    });

    expect(screen.getByText(/rSender → rRecipient/)).toBeInTheDocument();
    expect(screen.getByText('5 XRP')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('shows empty states when there is no data', async () => {
    global.fetch.mockImplementation((url) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            url.includes('/api/stats')
              ? STATS_BODY
              : { success: true, transactions: [], payment_requests: [] }
          )
      })
    );

    render(
      <XRPLProvider>
        <Dashboard />
      </XRPLProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    });
    expect(screen.getByText('No payment requests yet')).toBeInTheDocument();
  });

  it('handles API errors gracefully and keeps rendering', async () => {
    global.fetch.mockRejectedValue(new Error('API Error'));

    render(
      <XRPLProvider>
        <Dashboard />
      </XRPLProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    });
    // Stat cards fall back to their zero defaults
    expect(screen.getByText('Active Wallets')).toBeInTheDocument();
  });

  it('refreshes all three datasets when the refresh button is clicked', async () => {
    render(
      <XRPLProvider>
        <Dashboard />
      </XRPLProvider>
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3); // initial load
    });

    // Wait for the initial refresh to settle (button re-enables when
    // loading flips back to false) before clicking.
    const button = screen.getByRole('button', { name: /refresh data/i });
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });

    button.click();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(6); // initial + refresh
    });
  });
});
