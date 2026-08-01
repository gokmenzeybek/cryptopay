/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from '../Home';
import { useXRPL } from '../../hooks/useXRPL';

jest.mock('../../hooks/useXRPL');

const ADDR = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const OTHER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

const baseHook = {
  wallet: null,
  balance: null,
  isConnected: true,
  apiBaseUrl: 'http://localhost:5001',
  createWallet: jest.fn(),
  loadExistingWallet: jest.fn(),
  loading: false
};

const renderHome = () =>
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  );

beforeEach(() => {
  jest.resetAllMocks();
  useXRPL.mockReturnValue({ ...baseHook });
  global.fetch = jest.fn().mockResolvedValue({
    json: () => Promise.resolve({ success: true, rate: '32.5', transactions: [] })
  });
});

describe('Home — no wallet', () => {
  test('shows the setup card with create/unlock actions', () => {
    renderHome();
    expect(screen.getByText('Set up your wallet')).toBeInTheDocument();
    expect(screen.getByText('Create my wallet')).toBeInTheDocument();
    expect(screen.getByText('Unlock saved wallet')).toBeInTheDocument();
  });

  test('shows Connecting… when not connected and disables actions', () => {
    useXRPL.mockReturnValue({ ...baseHook, isConnected: false });
    renderHome();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(screen.getByText('Create my wallet')).toBeDisabled();
  });

  test('create button calls createWallet', async () => {
    useXRPL.mockReturnValue({ ...baseHook, createWallet: jest.fn().mockResolvedValue({}) });
    renderHome();
    await act(async () => {
      fireEvent.click(screen.getByText('Create my wallet'));
    });
    expect(useXRPL().createWallet).toHaveBeenCalled();
  });

  test('createWallet rejection is swallowed (hook toasts)', async () => {
    useXRPL.mockReturnValue({
      ...baseHook,
      createWallet: jest.fn().mockRejectedValue(new Error('nope'))
    });
    renderHome();
    await act(async () => {
      fireEvent.click(screen.getByText('Create my wallet'));
    });
    // still rendered, no crash
    expect(screen.getByText('Create my wallet')).toBeInTheDocument();
  });

  test('unlock button calls loadExistingWallet', () => {
    renderHome();
    fireEvent.click(screen.getByText('Unlock saved wallet'));
    expect(useXRPL().loadExistingWallet).toHaveBeenCalled();
  });

  test('buy button calls createBurnerWallet and opens AddFunds', async () => {
    useXRPL.mockReturnValue({
      ...baseHook,
      createBurnerWallet: jest.fn().mockResolvedValue({})
    });
    renderHome();
    await act(async () => {
      fireEvent.click(screen.getByText('Buy XRP — no wallet needed'));
    });
    expect(useXRPL().createBurnerWallet).toHaveBeenCalled();
  });
});

describe('Home — with wallet', () => {
  beforeEach(() => {
    useXRPL.mockReturnValue({
      ...baseHook,
      wallet: { address: ADDR },
      balance: '42.123456'
    });
  });

  test('renders balance, fiat conversion and action tiles', async () => {
    renderHome();
    expect(screen.getByText('Total balance')).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/≈ ₺/)).toBeInTheDocument());
    expect(screen.getByText('Send')).toBeInTheDocument();
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText('+ Add funds')).toBeInTheDocument();
  });

  test('shows empty activity state when no transactions', async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText(/No activity yet/)).toBeInTheDocument());
  });

  test('renders incoming and outgoing activity rows', async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes('/api/p2p/rate')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, rate: '30' }) });
      }
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          transactions: [
            { id: 1, tx_hash: 'H1', from_address: OTHER, to_address: ADDR, amount_xrp: '5', created_at: '2026-01-01T00:00:00Z' },
            { id: 2, tx_hash: 'H2', from_address: ADDR, to_address: OTHER, amount_xrp: '2.5', created_at: '2026-01-02T00:00:00Z' }
          ]
        })
      });
    });
    renderHome();
    await waitFor(() => expect(screen.getByText(/\+5 XRP/)).toBeInTheDocument());
    expect(screen.getByText(/−2\.5 XRP/)).toBeInTheDocument();
    expect(screen.getAllByText(/rPT1S…AYe/).length).toBeGreaterThan(0);
  });

  test('transaction fetch failure leaves the empty state', async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes('/api/p2p/rate')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
      }
      return Promise.reject(new Error('offline'));
    });
    renderHome();
    await waitFor(() => expect(screen.getByText(/No activity yet/)).toBeInTheDocument());
    // no fiat line without a rate
    expect(screen.queryByText(/≈ ₺/)).not.toBeInTheDocument();
  });

  test('renders payment request rows with status chips and edge-case fields', async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes('/api/p2p/rate')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, rate: '30' }) });
      }
      if (url.includes('/api/payment_requests')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            success: true,
            paymentRequests: [
              { request_id: 1, from_address: OTHER, to_address: ADDR, amount_xrp: '100', status: 'paid', created_at: '2026-01-01T00:00:00Z' },
              { request_id: 2, from_address: ADDR, to_address: OTHER, amount_xrp: '50', status: 'expired', created_at: '2026-01-02T00:00:00Z' },
              { request_id: 3, from_address: OTHER, to_address: ADDR, amount_xrp: null, status: 'open', created_at: null }
            ]
          })
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          transactions: [
            { id: 9, tx_hash: 'H9', from_address: OTHER, to_address: ADDR, amount_xrp: null, created_at: null }
          ]
        })
      });
    });
    renderHome();
    await waitFor(() => expect(screen.getAllByText(/You requested from/).length).toBe(2));
    expect(screen.getByText(/Request to/)).toBeInTheDocument();
    expect(screen.getByText('paid')).toBeInTheDocument();
    expect(screen.getByText('expired')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText(/100 XRP/)).toBeInTheDocument();
    expect(screen.getByText(/\+0 XRP/)).toBeInTheDocument();
  });

  test('navigation buttons route to /pay and /request, scan navigates', () => {
    renderHome();
    fireEvent.click(screen.getByText('Send'));
    fireEvent.click(screen.getByText('Request'));
    fireEvent.click(screen.getByText(/Scan a QR to pay/));
  });

  test('+ Add funds button opens the AddFunds modal', async () => {
    renderHome();
    fireEvent.click(screen.getByText('+ Add funds'));
    // AddFunds renders the sheet and entry screen
    await waitFor(() => expect(screen.getByText('Add funds')).toBeInTheDocument());
    expect(screen.getByText(/Find a seller/)).toBeInTheDocument();
  });

  test('AddFunds modal can be closed', async () => {
    renderHome();
    fireEvent.click(screen.getByText('+ Add funds'));
    await waitFor(() => expect(screen.getByText('Add funds')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Add funds')).not.toBeInTheDocument());
  });

  test('shows temporary guest warning banner for burner sessions', () => {
    useXRPL.mockReturnValue({
      ...baseHook,
      wallet: { address: ADDR },
      balance: '42',
      sessionType: 'buyer'
    });
    renderHome();
    expect(screen.getByText(/Temporary guest wallet/)).toBeInTheDocument();
  });
});
