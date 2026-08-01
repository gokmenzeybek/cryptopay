/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DisputeResolution from '../DisputeResolution';
import { useXRPL } from '../../hooks/useXRPL';
import authService from '../../services/authService';

jest.mock('../../hooks/useXRPL');
jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: { authFetch: jest.fn() }
}));

const ORDER = {
  id: 13,
  type: 'sell',
  tryAmount: '1000',
  xrpAmount: '25',
  rate: '40',
  status: 'payment_confirmed',
  counterpartyAddress: 'rBuyerAddress',
  paymentMethods: ['papara']
};

const renderModal = (order = ORDER) => {
  useXRPL.mockReturnValue({ apiBaseUrl: 'http://localhost:5001' });
  const onClose = jest.fn();
  const onDisputeRaised = jest.fn();
  render(<DisputeResolution order={order} onClose={onClose} onDisputeRaised={onDisputeRaised} />);
  return { onClose, onDisputeRaised };
};

beforeEach(() => {
  jest.resetAllMocks();
  authService.authFetch.mockResolvedValue({
    json: () => Promise.resolve({ success: true })
  });
});

describe('DisputeResolution', () => {
  test('renders the order summary with mapped payment methods', () => {
    renderModal();
    expect(screen.getAllByText('Raise Dispute').length).toBeGreaterThan(0);
    expect(screen.getByText('₺1000.00 / 25.000000 XRP')).toBeInTheDocument();
    expect(screen.getByText('Papara')).toBeInTheDocument();
    expect(screen.getByText('rBuyerAddress')).toBeInTheDocument();
    expect(screen.getByText('payment confirmed')).toBeInTheDocument();
  });

  test('requires a reason', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/detailed evidence/i), {
      target: { name: 'evidence', value: 'chat log attached' }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText('Please select a dispute reason')).toBeInTheDocument();
  });

  test('requires evidence', async () => {
    renderModal();
    fireEvent.change(screen.getByDisplayValue('Select a reason for the dispute'), {
      target: { name: 'reason', value: 'xrp_not_sent' }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText('Please provide evidence for your dispute')).toBeInTheDocument();
  });

  test('successful dispute calls onDisputeRaised', async () => {
    const { onDisputeRaised } = renderModal();
    fireEvent.change(screen.getByDisplayValue('Select a reason for the dispute'), {
      target: { name: 'reason', value: 'fraud_suspected' }
    });
    fireEvent.change(screen.getByPlaceholderText(/detailed evidence/i), {
      target: { name: 'evidence', value: 'fake screenshot' }
    });
    fireEvent.change(screen.getByPlaceholderText(/additional information/i), {
      target: { name: 'additionalInfo', value: 'please hurry' }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(authService.authFetch).toHaveBeenCalledWith(
      'http://localhost:5001/api/p2p/dispute',
      expect.objectContaining({
        body: JSON.stringify({
          orderId: 13,
          reason: 'fraud_suspected',
          evidence: 'fake screenshot',
          additionalInfo: 'please hurry'
        })
      })
    );
    expect(onDisputeRaised).toHaveBeenCalledWith(13);
  });

  test('server error is shown', async () => {
    authService.authFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: false, error: 'already disputed' })
    });
    renderModal();
    fireEvent.change(screen.getByDisplayValue('Select a reason for the dispute'), {
      target: { name: 'reason', value: 'other' }
    });
    fireEvent.change(screen.getByPlaceholderText(/detailed evidence/i), {
      target: { name: 'evidence', value: 'ev' }
    });
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText('already disputed')).toBeInTheDocument();
  });

  test('network error is shown', async () => {
    authService.authFetch.mockRejectedValue(new Error('down'));
    renderModal();
    fireEvent.change(screen.getByDisplayValue('Select a reason for the dispute'), {
      target: { name: 'reason', value: 'other' }
    });
    fireEvent.change(screen.getByPlaceholderText(/detailed evidence/i), {
      target: { name: 'evidence', value: 'ev' }
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
