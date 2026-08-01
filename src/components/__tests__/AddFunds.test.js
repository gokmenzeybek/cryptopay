/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AddFunds from '../AddFunds';
import { useXRPL } from '../../hooks/useXRPL';
import authService from '../../services/authService';

jest.mock('../../hooks/useXRPL');
jest.mock('../../services/authService');

const ADDR = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

const baseHook = {
  wallet: { address: ADDR },
  balance: '50.0',
  isConnected: true,
  apiBaseUrl: 'http://localhost:5001',
};

describe('AddFunds Component', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    useXRPL.mockReturnValue({ ...baseHook });
    authService.getToken.mockReturnValue('mock-jwt-token');
    authService.authFetch.mockImplementation(async () => ({
      json: async () => ({ success: true })
    }));

    global.fetch = jest.fn((url) => {
      if (url.includes('/api/p2p/rate')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, rate: '40.0' })
        });
      }
      if (url.includes('/api/p2p/quick-match')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            success: true,
            orderId: 'buy_order_123',
            xrpAmount: 12.5,
            rate: 40.0,
            paymentInstructions: {
              method: 'papara',
              paparaNumber: '1234567890',
              amount: 500,
              currency: 'TRY',
              referenceCode: 'QM-A1B2C3D4',
              description: 'CryptoPay QM-A1B2C3D4',
              timeLimitMinutes: 30
            },
            sellOrderId: 'sell_order_999'
          })
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });
  });

  test('renders entry screen with input and methods', async () => {
    render(<AddFunds onClose={mockOnClose} />);
    expect(screen.getByText('Add funds')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0')).toBeInTheDocument();

    const input = screen.getByPlaceholderText('0');
    fireEvent.change(input, { target: { value: '500' } });

    await waitFor(() => {
      expect(screen.getByText(/≈ 12.5000 XRP/)).toBeInTheDocument();
    });
  });

  test('triggers quick-match and advances to instructions screen', async () => {
    render(<AddFunds onClose={mockOnClose} />);
    const input = screen.getByPlaceholderText('0');
    fireEvent.change(input, { target: { value: '500' } });

    const findBtn = screen.getByText('Find a seller');
    await act(async () => {
      fireEvent.click(findBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Send the transfer')).toBeInTheDocument();
      expect(screen.getByText('QM-A1B2C3D4')).toBeInTheDocument();
      expect(screen.getByText('1234567890')).toBeInTheDocument();
    });
  });

  test('calls confirm-payment when "I\'ve sent the transfer" is clicked', async () => {
    render(<AddFunds onClose={mockOnClose} />);
    const input = screen.getByPlaceholderText('0');
    fireEvent.change(input, { target: { value: '500' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Find a seller'));
    });

    await waitFor(() => {
      expect(screen.getByText('I\'ve sent the transfer')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('I\'ve sent the transfer'));
    });

    await waitFor(() => {
      expect(authService.authFetch).toHaveBeenCalledWith(
        'http://localhost:5001/api/p2p/confirm-payment',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            orderId: 'buy_order_123',
            proofOfPayment: {
              method: 'papara',
              referenceCode: 'QM-A1B2C3D4'
            }
          })
        })
      );
      expect(screen.getByText('Waiting for seller')).toBeInTheDocument();
    });
  });
});
