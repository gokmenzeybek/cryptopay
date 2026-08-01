/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { toast } from 'react-toastify';
import ConfirmSheet from '../ConfirmSheet';
import { useXRPL } from '../../hooks/useXRPL';
import authService from '../../services/authService';

jest.mock('../../hooks/useXRPL');
jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: { authFetch: jest.fn() }
}));

// jsdom has no PointerEvent — polyfill with a MouseEvent subclass so the
// slide-to-confirm handlers receive clientX/pointerId.
if (typeof window !== 'undefined' && typeof window.PointerEvent !== 'function') {
  window.PointerEvent = class PointerEvent extends window.MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId;
    }
  };
}

const ADDR = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const DEST = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

const renderSheet = (props = {}, hook = {}) => {
  useXRPL.mockReturnValue({
    sendPayment: jest.fn().mockResolvedValue({ hash: 'TXHASH123' }),
    apiBaseUrl: 'http://localhost:5001',
    wallet: { address: ADDR },
    ...hook
  });
  const onClose = jest.fn();
  render(
    <ConfirmSheet
      recipient={DEST}
      amountXrp={10}
      onClose={onClose}
      {...props}
    />
  );
  return { onClose };
};

beforeEach(() => {
  jest.resetAllMocks();
  authService.authFetch.mockResolvedValue({ ok: true });
});

describe('ConfirmSheet', () => {
  test('renders the amount, truncated recipient and fee rows', () => {
    renderSheet({ memo: 'lunch', requestNote: 'from alice', tryRate: 25 });
    expect(screen.getByText('10 XRP')).toBeInTheDocument();
    expect(screen.getByText(/rPT1Sj…/)).toBeInTheDocument();
    expect(screen.getByText('0.00001 XRP')).toBeInTheDocument();
    expect(screen.getByText('lunch')).toBeInTheDocument();
    expect(screen.getByText(/from alice/)).toBeInTheDocument();
    expect(screen.getByText(/≈ ₺250,00/)).toBeInTheDocument();
  });

  test('confirm-and-send runs the payment and shows success', async () => {
    const onDone = jest.fn();
    renderSheet({ onDone });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Confirm and send payment'));
    });
    expect(useXRPL().sendPayment).toHaveBeenCalledWith(DEST, 10, undefined);
    expect(screen.getByText(/Sent in/)).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith({ hash: 'TXHASH123' });
  });

  test('marks the linked payment request paid after success', async () => {
    renderSheet({ requestId: 'REQ9' });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Confirm and send payment'));
    });
    await waitFor(() =>
      expect(authService.authFetch).toHaveBeenCalledWith(
        'http://localhost:5001/api/payment_requests/REQ9/paid',
        expect.objectContaining({ method: 'PATCH' })
      )
    );
  });

  test('success details toggle reveals the tx hash', async () => {
    renderSheet();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Confirm and send payment'));
    });
    fireEvent.click(screen.getByText(/Technical details/));
    expect(screen.getByText('TXHASH123')).toBeInTheDocument();
  });

  test('payment failure lands in the error phase with retry', async () => {
    useXRPL.mockReturnValue({
      sendPayment: jest.fn().mockRejectedValue(new Error('insufficient funds')),
      apiBaseUrl: 'http://localhost:5001',
      wallet: { address: ADDR }
    });
    render(<ConfirmSheet recipient={DEST} amountXrp={10} onClose={jest.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Confirm and send payment'));
    });
    expect(toast.error).toHaveBeenCalledWith('insufficient funds');
    expect(screen.getByText(/didn't go through/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Try again'));
    expect(screen.getByText(/slide to send/)).toBeInTheDocument();
  });

  test('blocks sending without a wallet', async () => {
    renderSheet({}, { wallet: null });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Confirm and send payment'));
    });
    expect(toast.error).toHaveBeenCalledWith('Unlock your wallet first');
    expect(useXRPL().sendPayment).not.toHaveBeenCalled();
  });

  test('slide-to-confirm gesture completes the payment', async () => {
    renderSheet();
    const knob = screen.getByText('→');
    // jsdom: setPointerCapture does not exist — stub it
    knob.setPointerCapture = jest.fn();
    const track = knob.parentElement;
    Object.defineProperty(track, 'clientWidth', { value: 300, configurable: true });

    fireEvent.pointerDown(knob, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(knob, { clientX: 10 });   // partial drag, no execute
    expect(useXRPL().sendPayment).not.toHaveBeenCalled();
    fireEvent.pointerUp(knob);                       // released early: knob resets

    fireEvent.pointerDown(knob, { clientX: 0, pointerId: 1 });
    await act(async () => {
      fireEvent.pointerMove(knob, { clientX: 500 }); // beyond max → execute
    });
    expect(useXRPL().sendPayment).toHaveBeenCalled();
  });

  test('slide move without drag state is a no-op', () => {
    renderSheet();
    const knob = screen.getByText('→');
    fireEvent.pointerMove(knob, { clientX: 100 });
    expect(useXRPL().sendPayment).not.toHaveBeenCalled();
  });

  test('Done closes the sheet after success; overlay click closes too', async () => {
    const { onClose } = renderSheet();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Confirm and send payment'));
    });
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  test('cancel button in error phase closes', async () => {
    useXRPL.mockReturnValue({
      sendPayment: jest.fn().mockRejectedValue(new Error('x')),
      apiBaseUrl: null,
      wallet: { address: ADDR }
    });
    const onClose = jest.fn();
    render(<ConfirmSheet recipient={DEST} amountXrp={1} onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Confirm and send payment'));
    });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
