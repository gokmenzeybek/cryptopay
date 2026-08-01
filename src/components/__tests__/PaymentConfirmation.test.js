/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PaymentConfirmation from '../PaymentConfirmation';
import { useXRPL } from '../../hooks/useXRPL';
import authService from '../../services/authService';

jest.mock('../../hooks/useXRPL');
jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: { authFetch: jest.fn() }
}));

const BASE_ORDER = {
  id: 7,
  tryAmount: '1000',
  xrpAmount: '25',
  rate: '40',
  paymentMethods: ['bank_transfer', 'papara'],
  counterpartyAddress: 'rSellerAddress'
};

const PAPARA_ORDER = {
  ...BASE_ORDER,
  paymentMethods: ['papara'],
  metadata: { paparaAccountNumber: '1234567890', paparaAccountHolder: 'Grace Hopper' }
};

const renderModal = (order = BASE_ORDER) => {
  useXRPL.mockReturnValue({ apiBaseUrl: 'http://localhost:5001' });
  const onClose = jest.fn();
  const onConfirmed = jest.fn();
  render(<PaymentConfirmation order={order} onClose={onClose} onConfirmed={onConfirmed} />);
  return { onClose, onConfirmed };
};

beforeEach(() => {
  jest.resetAllMocks();
  authService.authFetch.mockResolvedValue({
    json: () => Promise.resolve({ success: true })
  });
});

describe('PaymentConfirmation — bank transfer flow', () => {
  test('renders the order summary and proof form', () => {
    renderModal();
    expect(screen.getByText('Confirm TRY Payment')).toBeInTheDocument();
    expect(screen.getByText('₺1000.00')).toBeInTheDocument();
    expect(screen.getByText('25.000000 XRP')).toBeInTheDocument();
    expect(screen.getByText('Bank Transfer, Papara')).toBeInTheDocument();
    expect(screen.getByText('rSellerAddress')).toBeInTheDocument();
  });

  test('requires proof of payment', async () => {
    renderModal();
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText('Please provide proof of payment')).toBeInTheDocument();
    expect(authService.authFetch).not.toHaveBeenCalled();
  });

  test('successful confirmation calls onConfirmed with the order id', async () => {
    const { onConfirmed } = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/proof of payment/i), {
      target: { name: 'proofOfPayment', value: 'receipt-123' }
    });
    fireEvent.change(screen.getByPlaceholderText(/reference number/i), {
      target: { name: 'paymentReference', value: 'REF9' }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(authService.authFetch).toHaveBeenCalledWith(
      'http://localhost:5001/api/p2p/confirm-payment',
      expect.objectContaining({
        body: JSON.stringify({
          orderId: 7,
          proofOfPayment: 'receipt-123',
          paymentReference: 'REF9',
          additionalNotes: ''
        })
      })
    );
    expect(onConfirmed).toHaveBeenCalledWith(7);
  });

  test('server error is shown', async () => {
    authService.authFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: false, error: 'wrong state' })
    });
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/proof of payment/i), {
      target: { name: 'proofOfPayment', value: 'x' }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText('wrong state')).toBeInTheDocument();
  });

  test('network error is shown', async () => {
    authService.authFetch.mockRejectedValue(new Error('offline'));
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/proof of payment/i), {
      target: { name: 'proofOfPayment', value: 'x' }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });
});

describe('PaymentConfirmation — Papara flow', () => {
  test('shows the Papara instant-transfer panel with the account holder', () => {
    renderModal(PAPARA_ORDER);
    expect(screen.getByText(/Papara Instant Transfer/)).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('Initiate Papara Transfer')).toBeInTheDocument();
  });

  test('initiating a Papara payment starts status polling', async () => {
    jest.useFakeTimers();
    authService.authFetch
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true, transactionId: 'TX55', status: 'pending' })
      })
      .mockResolvedValue({
        json: () => Promise.resolve({ success: true, status: 'completed' })
      });
    const { onConfirmed } = renderModal(PAPARA_ORDER);
    await act(async () => {
      fireEvent.click(screen.getByText('Initiate Papara Transfer'));
    });
    expect(screen.getByText('TX55')).toBeInTheDocument();
    expect(screen.getByText(/Checking payment status/)).toBeInTheDocument();
    await act(async () => {
      jest.advanceTimersByTime(5100);
    });
    expect(onConfirmed).toHaveBeenCalledWith(7);
    jest.useRealTimers();
  });

  test('failed Papara status shows an error and stops polling', async () => {
    jest.useFakeTimers();
    authService.authFetch
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true, transactionId: 'TX56', status: 'pending' })
      })
      .mockResolvedValue({
        json: () => Promise.resolve({ success: true, status: 'failed' })
      });
    renderModal(PAPARA_ORDER);
    await act(async () => {
      fireEvent.click(screen.getByText('Initiate Papara Transfer'));
    });
    await act(async () => {
      jest.advanceTimersByTime(5100);
    });
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
    jest.useRealTimers();
  });

  test('initiate failure shows the server error', async () => {
    authService.authFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: false, error: 'papara down' })
    });
    renderModal(PAPARA_ORDER);
    await act(async () => {
      fireEvent.click(screen.getByText('Initiate Papara Transfer'));
    });
    expect(screen.getByText('papara down')).toBeInTheDocument();
  });

  test('initiate network failure shows a generic error', async () => {
    authService.authFetch.mockRejectedValue(new Error('nope'));
    renderModal(PAPARA_ORDER);
    await act(async () => {
      fireEvent.click(screen.getByText('Initiate Papara Transfer'));
    });
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  test('missing papara metadata falls back to the proof-of-payment form', () => {
    renderModal({ ...PAPARA_ORDER, metadata: {} });
    expect(screen.getByPlaceholderText(/proof of payment/i)).toBeInTheDocument();
    expect(screen.queryByText('Initiate Papara Transfer')).not.toBeInTheDocument();
  });

  test('close button and Cancel call onClose', () => {
    const { onClose } = renderModal(PAPARA_ORDER);
    fireEvent.click(screen.getByText('×'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
