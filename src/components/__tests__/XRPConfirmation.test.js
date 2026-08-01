/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import XRPConfirmation from '../XRPConfirmation';
import { useXRPL } from '../../hooks/useXRPL';
import authService from '../../services/authService';

jest.mock('../../hooks/useXRPL');
jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: { authFetch: jest.fn() }
}));

const ORDER = {
  id: 11,
  xrpAmount: '25',
  tryAmount: '1000',
  rate: '40',
  counterpartyAddress: 'rBuyerAddress',
  paymentConfirmedAt: '2026-01-02T00:00:00Z'
};

const HASH = 'A'.repeat(64);

const renderModal = (order = ORDER) => {
  useXRPL.mockReturnValue({ apiBaseUrl: 'http://localhost:5001' });
  const onClose = jest.fn();
  const onConfirmed = jest.fn();
  render(<XRPConfirmation order={order} onClose={onClose} onConfirmed={onConfirmed} />);
  return { onClose, onConfirmed };
};

beforeEach(() => {
  jest.resetAllMocks();
  authService.authFetch.mockResolvedValue({
    json: () => Promise.resolve({ success: true })
  });
});

describe('XRPConfirmation', () => {
  test('renders the order summary', () => {
    renderModal();
    expect(screen.getAllByText('Confirm XRP Transfer').length).toBeGreaterThan(0);
    expect(screen.getByText('25.000000 XRP')).toBeInTheDocument();
    expect(screen.getByText('₺1000.00')).toBeInTheDocument();
    expect(screen.getByText('rBuyerAddress')).toBeInTheDocument();
  });

  test('shows Not confirmed when paymentConfirmedAt missing', () => {
    renderModal({ ...ORDER, paymentConfirmedAt: null });
    expect(screen.getByText('Not confirmed')).toBeInTheDocument();
  });

  test('requires a transaction hash', async () => {
    renderModal();
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText('Please provide the XRP transaction hash')).toBeInTheDocument();
  });

  test('rejects a malformed hash', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/transaction hash from your wallet/i), {
      target: { name: 'xrpTransactionHash', value: 'nothex' }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText(/64 hex characters/)).toBeInTheDocument();
    expect(authService.authFetch).not.toHaveBeenCalled();
  });

  test('successful confirmation calls onConfirmed', async () => {
    const { onConfirmed } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/transaction hash from your wallet/i), {
      target: { name: 'xrpTransactionHash', value: HASH }
    });
    fireEvent.change(screen.getByPlaceholderText(/additional information/i), {
      target: { name: 'additionalNotes', value: 'sent from wallet' }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(authService.authFetch).toHaveBeenCalledWith(
      'http://localhost:5001/api/p2p/confirm-xrp',
      expect.objectContaining({
        body: JSON.stringify({ orderId: 11, xrpTransactionHash: HASH, additionalNotes: 'sent from wallet' })
      })
    );
    expect(onConfirmed).toHaveBeenCalledWith(11);
  });

  test('server error is shown', async () => {
    authService.authFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: false, error: 'hash already used' })
    });
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/transaction hash from your wallet/i), {
      target: { name: 'xrpTransactionHash', value: HASH }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText('hash already used')).toBeInTheDocument();
  });

  test('network error is shown', async () => {
    authService.authFetch.mockRejectedValue(new Error('down'));
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/transaction hash from your wallet/i), {
      target: { name: 'xrpTransactionHash', value: HASH }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  test('Cancel and × close the modal', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
