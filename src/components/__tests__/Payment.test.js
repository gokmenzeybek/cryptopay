/**
 * @jest-environment jsdom
 */
/**
 * Unit Tests for Payment Component
 *
 * Rewritten in Phase 7 (PRD 7.1.1) against the current Payment.js: it uses
 * useSearchParams (needs a Router), validates required fields via toasts, and
 * delegates all amount/address/balance checks to useXRPL.sendPayment.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { notice } from '../../services/notice';
import { XRPLProvider } from '../../hooks/useXRPL';
import Payment from '../Payment';

// Mock the useXRPL hook — rebuilt per test to avoid cross-test pollution
let mockUseXRPL;

jest.mock('../../hooks/useXRPL', () => ({
  useXRPL: () => mockUseXRPL,
  XRPLProvider: ({ children }) => <div data-testid="xrpl-provider">{children}</div>
}));

const RECIPIENT = 'rRecipient123456789012345678901234567890';

function buildMock(overrides = {}) {
  return {
    wallet: { address: 'rTest1234567890123456789012345678901234' },
    isConnected: true,
    balance: '1000',
    loading: false,
    sendPayment: jest.fn().mockResolvedValue({ success: true, hash: 'tx_hash_123' }),
    connectToXRPL: jest.fn(),
    ...overrides
  };
}

function renderPayment(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <XRPLProvider>
        <Payment />
      </XRPLProvider>
    </MemoryRouter>
  );
}

function fillForm({ recipient = RECIPIENT, amount = '10', memo = 'Test payment' } = {}) {
  fireEvent.change(screen.getByLabelText(/recipient address/i), {
    target: { value: recipient }
  });
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: memo } });
}

describe('Payment Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseXRPL = buildMock();
  });

  it('renders the payment form', () => {
    renderPayment();

    expect(screen.getByRole('heading', { name: /send payment/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/recipient address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/memo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send payment/i })).toBeInTheDocument();
  });

  it('pre-fills the recipient address from the ?to= URL parameter', () => {
    renderPayment([`/?to=${RECIPIENT}`]);

    expect(screen.getByLabelText(/recipient address/i)).toHaveValue(RECIPIENT);
  });

  it('submits valid data to sendPayment and clears the form', async () => {
    renderPayment();

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /send payment/i }));

    await waitFor(() => {
      expect(mockUseXRPL.sendPayment).toHaveBeenCalledWith(RECIPIENT, 10, 'Test payment');
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/recipient address/i)).toHaveValue('');
      expect(screen.getByLabelText(/amount/i)).toHaveValue(null);
      expect(screen.getByLabelText(/memo/i)).toHaveValue('');
    });
  });

  it('allows an empty memo', async () => {
    renderPayment();

    fillForm({ memo: '' });
    fireEvent.click(screen.getByRole('button', { name: /send payment/i }));

    await waitFor(() => {
      expect(mockUseXRPL.sendPayment).toHaveBeenCalledWith(RECIPIENT, 10, '');
    });
  });

  it('rejects submission with missing required fields', async () => {
    renderPayment();

    // fireEvent.submit bypasses the native `required` attribute validation
    // (which would swallow a button click in jsdom) so the component's own
    // validation logic runs.
    fireEvent.submit(screen.getByRole('button', { name: /send payment/i }).closest('form'));

    await waitFor(() => {
      expect(notice.error).toHaveBeenCalledWith('Please fill in all required fields');
    });
    expect(mockUseXRPL.sendPayment).not.toHaveBeenCalled();
  });

  it('rejects submission when there is no wallet', async () => {
    mockUseXRPL = buildMock({ wallet: null });
    renderPayment();

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /send payment/i }));

    await waitFor(() => {
      expect(notice.error).toHaveBeenCalledWith(
        'No wallet available. Please create a wallet first.'
      );
    });
    expect(mockUseXRPL.sendPayment).not.toHaveBeenCalled();
  });

  it('keeps the form data when sendPayment fails', async () => {
    mockUseXRPL = buildMock({
      sendPayment: jest.fn().mockRejectedValue(new Error('insufficient balance'))
    });
    renderPayment();

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /send payment/i }));

    await waitFor(() => {
      expect(mockUseXRPL.sendPayment).toHaveBeenCalled();
    });

    // Form must NOT be cleared on failure
    expect(screen.getByLabelText(/recipient address/i)).toHaveValue(RECIPIENT);
    expect(screen.getByLabelText(/amount/i)).toHaveValue(10);
  });

  it('disables the submit button while a payment is in flight', () => {
    mockUseXRPL = buildMock({ loading: true });
    renderPayment();

    expect(screen.getByRole('button', { name: /send payment/i })).toBeDisabled();
  });
});
