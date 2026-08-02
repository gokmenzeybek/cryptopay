/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { notice } from '../../services/notice';
import OrderDetails from '../OrderDetails';
import { useXRPL } from '../../hooks/useXRPL';
import authService from '../../services/authService';

jest.mock('../../hooks/useXRPL');
jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: { authFetch: jest.fn() }
}));

const ADDR = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

const baseOrder = {
  id: 21,
  type: 'buy',
  status: 'matched',
  tryAmount: '1000',
  xrpAmount: '25',
  rate: '40',
  xrplAddress: ADDR,
  paymentMethods: ['papara'],
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: '2026-01-01T01:00:00Z',
  counterpartyAddress: 'rCounterparty'
};

const hookBase = {
  apiBaseUrl: 'http://localhost:5001',
  client: null,
  wallet: null,
  isConnected: false,
  waitForValidation: jest.fn()
};

const renderDetails = (order = baseOrder, hook = {}, props = {}) => {
  useXRPL.mockReturnValue({ ...hookBase, ...hook });
  const callbacks = {
    onClose: jest.fn(),
    onPaymentConfirmed: jest.fn(),
    onXRPConfirmed: jest.fn(),
    onDisputeRaised: jest.fn(),
    onCancelled: jest.fn(),
    onEscrowLocked: jest.fn(),
    ...props
  };
  render(<OrderDetails order={order} userAddress={ADDR} {...callbacks} />);
  return callbacks;
};

  beforeEach(() => {
  jest.resetAllMocks();
  authService.authFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true })
  });
});

describe('OrderDetails — rendering', () => {
  test('returns null without an order', () => {
    useXRPL.mockReturnValue({ ...hookBase });
    const { container } = render(<OrderDetails order={null} onClose={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders order info rows', () => {
    renderDetails({
      ...baseOrder,
      paymentReference: 'REF1',
      xrpTransactionHash: 'HASHX',
      matchedAt: '2026-01-01T00:10:00Z',
      disputeReason: 'did not pay'
    });
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('₺1000.00')).toBeInTheDocument();
    expect(screen.getByText('25.000000 XRP')).toBeInTheDocument();
    expect(screen.getByText('Papara')).toBeInTheDocument();
    expect(screen.getByText('REF1')).toBeInTheDocument();
    expect(screen.getByText('HASHX')).toBeInTheDocument();
    expect(screen.getByText('did not pay')).toBeInTheDocument();
    expect(screen.getByText('rCounterparty')).toBeInTheDocument();
  });

  test('escrow status badges and locked hint for buyers', () => {
    renderDetails({ ...baseOrder, escrowStatus: 'locked', escrowTransactionHash: 'EH1' });
    expect(screen.getByText('locked on ledger')).toBeInTheDocument();
    expect(screen.getByText('EH1')).toBeInTheDocument();
    expect(screen.getByText(/The seller has locked the XRP/)).toBeInTheDocument();
  });

  test('prepared escrow status label', () => {
    renderDetails({ ...baseOrder, type: 'sell', escrowStatus: 'prepared' });
    expect(screen.getByText(/prepared \(awaiting seller signature\)/)).toBeInTheDocument();
  });

  test('missing timestamps show N/A', () => {
    renderDetails({ ...baseOrder, createdAt: null, expiresAt: null });
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });
});

describe('OrderDetails — actions by state', () => {
  test('buyer on matched order sees Confirm TRY Payment, dispute and cancel', () => {
    renderDetails();
    expect(screen.getByText('Confirm TRY Payment')).toBeInTheDocument();
    expect(screen.getByText('Raise Dispute')).toBeInTheDocument();
    expect(screen.getByText('Cancel Order')).toBeInTheDocument();
    expect(screen.queryByText('Lock XRP in Escrow')).not.toBeInTheDocument();
  });

  test('seller on matched order sees the escrow lock action', () => {
    renderDetails({ ...baseOrder, type: 'sell' });
    expect(screen.getByText('Lock XRP in Escrow')).toBeInTheDocument();
    expect(screen.queryByText('Confirm TRY Payment')).not.toBeInTheDocument();
  });

  test('no lock action when escrow already locked', () => {
    renderDetails({ ...baseOrder, type: 'sell', escrowStatus: 'locked' });
    expect(screen.queryByText('Lock XRP in Escrow')).not.toBeInTheDocument();
  });

  test('payment_confirmed sell order shows Confirm XRP Transfer', () => {
    renderDetails({ ...baseOrder, type: 'sell', status: 'payment_confirmed' });
    expect(screen.getByText('Confirm XRP Transfer')).toBeInTheDocument();
    // cannot cancel once payment is confirmed
    expect(screen.queryByText('Cancel Order')).not.toBeInTheDocument();
    expect(screen.getByText('Raise Dispute')).toBeInTheDocument();
  });

  test('completed order shows no actions', () => {
    renderDetails({ ...baseOrder, status: 'completed', completedAt: '2026-01-02T00:00:00Z' });
    expect(screen.queryByText('Cancel Order')).not.toBeInTheDocument();
    expect(screen.queryByText('Raise Dispute')).not.toBeInTheDocument();
    expect(screen.getByText('Completed At:')).toBeInTheDocument();
  });
});

describe('OrderDetails — cancel flow', () => {
  test('cancel calls the API and closes on success', async () => {
    const cbs = renderDetails();
    fireEvent.click(screen.getByText('Cancel Order'));
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel order'));
    });
    expect(authService.authFetch).toHaveBeenCalledWith(
      'http://localhost:5001/api/p2p/cancel',
      expect.objectContaining({
        body: JSON.stringify({ orderId: 21, reason: 'User cancelled' })
      })
    );
    expect(notice.success).toHaveBeenCalledWith('Order cancelled');
    expect(cbs.onCancelled).toHaveBeenCalledWith(21);
    expect(cbs.onClose).toHaveBeenCalled();
  });

  test('cancel with escrow info toasts the status', async () => {
    authService.authFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, escrow: { status: 'cancel_pending' } })
    });
    renderDetails();
    fireEvent.click(screen.getByText('Cancel Order'));
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel order'));
    });
    expect(notice.info).toHaveBeenCalledWith('Escrow status: cancel_pending');
  });

  test('cancel failure with dispute hint', async () => {
    authService.authFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, message: 'Escrow locked — open a dispute' })
    });
    renderDetails();
    fireEvent.click(screen.getByText('Cancel Order'));
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel order'));
    });
    expect(notice.error).toHaveBeenCalledWith('Escrow locked — open a dispute');
    expect(notice.info).toHaveBeenCalledWith('You can raise a dispute from this order instead');
  });

  test('uses the entered cancellation reason', async () => {
    renderDetails();
    fireEvent.click(screen.getByText('Cancel Order'));
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'changed my mind' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel order'));
    });
    expect(authService.authFetch.mock.calls[0][1].body).toContain('changed my mind');
  });
});

describe('OrderDetails — escrow lock flow', () => {
  const sellOrder = { ...baseOrder, type: 'sell' };
  // Factory (not a shared object): jest.resetAllMocks() would wipe the
  // implementations of any mocks created at describe scope.
  const makeConnectedHook = (overrides = {}) => ({
    isConnected: true,
    client: {
      autofill: jest.fn().mockResolvedValue({ Sequence: 77 }),
      submit: jest.fn().mockResolvedValue({ result: { engine_result: 'tesSUCCESS' } })
    },
    wallet: { sign: jest.fn().mockReturnValue({ tx_blob: 'BLOB', hash: 'TXH' }) },
    waitForValidation: jest.fn().mockResolvedValue({ meta: { TransactionResult: 'tesSUCCESS' } }),
    ...overrides
  });

  test('happy path: prepare → sign → submit → record', async () => {
    const hook = makeConnectedHook();
    const cbs = renderDetails(sellOrder, hook);
    await act(async () => {
      fireEvent.click(screen.getByText('Lock XRP in Escrow'));
    });
    await waitFor(() => expect(notice.success).toHaveBeenCalledWith('XRP locked in escrow on the ledger'));
    expect(authService.authFetch).toHaveBeenCalledWith(
      'http://localhost:5001/api/p2p/prepare-escrow',
      expect.objectContaining({
        body: JSON.stringify({ orderId: 21, xrpAmount: 25, destinationAddress: 'rCounterparty' })
      })
    );
    expect(hook.wallet.sign).toHaveBeenCalled();
    expect(hook.client.submit).toHaveBeenCalledWith('BLOB');
    expect(authService.authFetch).toHaveBeenCalledWith(
      'http://localhost:5001/api/p2p/submit-escrow-hash',
      expect.objectContaining({
        body: JSON.stringify({ orderId: 21, txHash: 'TXH', offerSequence: 77 })
      })
    );
    expect(cbs.onEscrowLocked).toHaveBeenCalledWith(21);
    expect(cbs.onClose).toHaveBeenCalled();
  });

  test('blocked when not connected', async () => {
    renderDetails(sellOrder, { isConnected: false, client: null });
    await act(async () => {
      fireEvent.click(screen.getByText('Lock XRP in Escrow'));
    });
    expect(notice.error).toHaveBeenCalledWith(expect.stringContaining('Not connected'));
  });

  test('blocked without a wallet', async () => {
    renderDetails(sellOrder, { isConnected: true, client: {}, wallet: null });
    await act(async () => {
      fireEvent.click(screen.getByText('Lock XRP in Escrow'));
    });
    expect(notice.error).toHaveBeenCalledWith(expect.stringContaining('No unlocked wallet'));
  });

  test('blocked without a counterparty', async () => {
    renderDetails({ ...sellOrder, counterpartyAddress: null }, makeConnectedHook());
    await act(async () => {
      fireEvent.click(screen.getByText('Lock XRP in Escrow'));
    });
    expect(notice.error).toHaveBeenCalledWith(expect.stringContaining('no counterparty'));
  });

  test('prepare-escrow server failure', async () => {
    authService.authFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, message: 'order not yours' })
    });
    renderDetails(sellOrder, makeConnectedHook());
    await act(async () => {
      fireEvent.click(screen.getByText('Lock XRP in Escrow'));
    });
    await waitFor(() => expect(notice.error).toHaveBeenCalledWith('order not yours'));
  });

  test('submit engine_result failure', async () => {
    const hook = makeConnectedHook({
      client: {
        autofill: jest.fn().mockResolvedValue({ Sequence: 1 }),
        submit: jest.fn().mockResolvedValue({ result: { engine_result: 'tecUNFUNDED' } })
      }
    });
    renderDetails(sellOrder, hook);
    await act(async () => {
      fireEvent.click(screen.getByText('Lock XRP in Escrow'));
    });
    await waitFor(() =>
      expect(notice.error).toHaveBeenCalledWith('EscrowCreate submit failed: tecUNFUNDED')
    );
  });

  test('ledger validation failure', async () => {
    const hook = makeConnectedHook({
      waitForValidation: jest.fn().mockResolvedValue({ meta: { TransactionResult: 'tecPATH_DRY' } })
    });
    renderDetails(sellOrder, hook);
    await act(async () => {
      fireEvent.click(screen.getByText('Lock XRP in Escrow'));
    });
    await waitFor(() =>
      expect(notice.error).toHaveBeenCalledWith('EscrowCreate failed on ledger: tecPATH_DRY')
    );
  });

  test('submit-escrow-hash server failure', async () => {
    authService.authFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, transaction: {} }) })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ success: false, error: 'db down' }) });
    renderDetails(sellOrder, makeConnectedHook());
    await act(async () => {
      fireEvent.click(screen.getByText('Lock XRP in Escrow'));
    });
    await waitFor(() => expect(notice.error).toHaveBeenCalledWith('db down'));
  });
});

describe('OrderDetails — sub-modals', () => {
  test('Confirm TRY Payment opens PaymentConfirmation and propagates confirm', async () => {
    const cbs = renderDetails();
    fireEvent.click(screen.getByText('Confirm TRY Payment'));
    // PaymentConfirmation modal is open — submit proof through its form
    fireEvent.change(screen.getByPlaceholderText(/proof of payment/i), {
      target: { name: 'proofOfPayment', value: 'proof' }
    });
    await act(async () => {
      const forms = document.querySelectorAll('form');
      fireEvent.submit(forms[forms.length - 1]);
    });
    await waitFor(() => expect(cbs.onPaymentConfirmed).toHaveBeenCalledWith(21));
  });

  test('Raise Dispute opens DisputeResolution', () => {
    renderDetails();
    fireEvent.click(screen.getByText('Raise Dispute'));
    expect(screen.getAllByText('Raise Dispute').length).toBeGreaterThan(1);
    expect(screen.getByText(/Dispute Process/)).toBeInTheDocument();
  });

  test('Confirm XRP Transfer opens XRPConfirmation', () => {
    renderDetails({ ...baseOrder, type: 'sell', status: 'payment_confirmed' });
    fireEvent.click(screen.getByText('Confirm XRP Transfer'));
    expect(screen.getByPlaceholderText(/transaction hash from your wallet/i)).toBeInTheDocument();
  });
});
