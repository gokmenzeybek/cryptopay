/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AdminConsole from '../AdminConsole';
import { useXRPL } from '../../hooks/useXRPL';
import authService from '../../services/authService';
import { notice } from '../../services/notice';

jest.mock('../../hooks/useXRPL', () => ({
  useXRPL: jest.fn()
}));
jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: { authFetch: jest.fn() }
}));
jest.mock('../../services/notice', () => ({
  notice: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

const DISPUTES = [
  {
    order_id: 'ORD-123',
    order_type: 'buy',
    xrpl_address: 'rBuyerAddress',
    amount_try: '2500',
    dispute_reason: 'Buyer never paid',
    status: 'disputed'
  }
];

const WALLETS = [
  { address: 'rSellerA', role: 'seller' },
  { address: 'rBuyerB', role: 'buyer' }
];

const renderConsole = () => {
  useXRPL.mockReturnValue({ apiBaseUrl: 'http://localhost:5001' });
  return render(<AdminConsole />);
};

beforeEach(() => {
  jest.resetAllMocks();
  authService.authFetch.mockImplementation((url) => {
    if (url.includes('/api/moderator/disputes')) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true, disputes: DISPUTES }) });
    }
    if (url.includes('/api/moderator/sellers')) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true, wallets: WALLETS }) });
    }
    if (url.includes('/api/moderator/resolve-dispute')) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true, message: 'Dispute resolved' }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
  });
});

describe('AdminConsole', () => {
  test('loads and lists disputes and wallets', async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText('#ORD-123')).toBeInTheDocument());
    expect(screen.getByText('Buyer never paid')).toBeInTheDocument();
    expect(screen.getByText('rSellerA')).toBeInTheDocument();
    expect(screen.getByText('rBuyerB')).toBeInTheDocument();
    expect(screen.getByText('Promote to seller')).toBeInTheDocument();
    expect(screen.getByText('Demote to buyer')).toBeInTheDocument();
  });

  test('resolving a dispute posts the chosen resolution', async () => {
    renderConsole();
    await waitFor(() => screen.getByText('Release to buyer'));
    fireEvent.click(screen.getByText('Release to buyer'));
    await waitFor(() =>
      expect(authService.authFetch).toHaveBeenCalledWith(
        'http://localhost:5001/api/moderator/resolve-dispute',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ orderId: 'ORD-123', resolution: 'release' })
        })
      )
    );
  });

  test('promote posts the seller role change', async () => {
    renderConsole();
    await waitFor(() => screen.getByText('Promote to seller'));
    fireEvent.click(screen.getByText('Promote to seller'));
    await waitFor(() =>
      expect(authService.authFetch).toHaveBeenCalledWith(
        'http://localhost:5001/api/moderator/sellers',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ address: 'rBuyerB', role: 'seller' })
        })
      )
    );
  });

  test('empty states render when there is no data', async () => {
    authService.authFetch.mockImplementation((url) => {
      if (url.includes('/api/moderator/disputes')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, disputes: [] }) });
      }
      if (url.includes('/api/moderator/sellers')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, wallets: [] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
    });
    renderConsole();
    await waitFor(() => expect(screen.getByText('No open disputes.')).toBeInTheDocument());
    expect(screen.getByText('No wallets registered yet.')).toBeInTheDocument();
  });

  test('resolution error surfaces to the user', async () => {
    authService.authFetch.mockImplementation((url) => {
      if (url.includes('/api/moderator/disputes')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, disputes: DISPUTES }) });
      }
      if (url.includes('/api/moderator/sellers')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, wallets: WALLETS }) });
      }
      if (url.includes('/api/moderator/resolve-dispute')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: false, message: 'Escrow condition missing' }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
    });
    renderConsole();
    await waitFor(() => screen.getByText('Release to buyer'));
    fireEvent.click(screen.getByText('Release to buyer'));
    await waitFor(() => expect(notice.error).toHaveBeenCalledWith('Escrow condition missing'));
  });

  test('fetch failure does not crash', async () => {
    authService.authFetch.mockRejectedValue(new Error('offline'));
    renderConsole();
    await act(async () => {});
    expect(screen.getByText('Admin Console')).toBeInTheDocument();
  });
});
