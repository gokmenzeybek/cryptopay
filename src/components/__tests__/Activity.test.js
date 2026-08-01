/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Activity from '../Activity';
import { useXRPL } from '../../hooks/useXRPL';

jest.mock('../../hooks/useXRPL');

const ADDR = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const OTHER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

const baseHook = {
  wallet: { address: ADDR },
  balance: '42.123456',
  isConnected: true,
  apiBaseUrl: 'http://localhost:5001',
  createWallet: jest.fn(),
  loadExistingWallet: jest.fn(),
  loading: false
};

const renderActivity = () =>
  render(
    <MemoryRouter>
      <Activity />
    </MemoryRouter>
  );

beforeEach(() => {
  jest.resetAllMocks();
  useXRPL.mockReturnValue({ ...baseHook });
});

describe('Activity screen', () => {
  test('shows the title and empty state when no transactions', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, transactions: [] })
    });
    renderActivity();
    expect(screen.getByText('Activity')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/No activity yet/)).toBeInTheDocument());
  });

  test('renders incoming and outgoing activity rows', async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes('/api/payment_requests')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, paymentRequests: [] }) });
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
    renderActivity();
    await waitFor(() => expect(screen.getByText(/\+5 XRP/)).toBeInTheDocument());
    expect(screen.getByText(/−2\.5 XRP/)).toBeInTheDocument();
    expect(screen.getAllByText(/rPT1S…AYe/).length).toBeGreaterThan(0);
  });

  test('fetch failure leaves the empty state', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    renderActivity();
    await waitFor(() => expect(screen.getByText(/No activity yet/)).toBeInTheDocument());
  });
});
