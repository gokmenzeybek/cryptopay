/**
 * @jest-environment jsdom
 */
/**
 * Unit Tests for QRScanner Component
 *
 * Rewritten in Phase 7 (PRD 7.1.1) against the current QRScanner.js: wallet
 * gate screen, manual QR input (JSON + legacy comma format), payment details
 * confirmation, and scanner error handling. The camera Scanner is mocked.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { notice } from '../../services/notice';
import { XRPLProvider } from '../../hooks/useXRPL';
import QRScanner from '../QRScanner';

// Mock the useXRPL hook — rebuilt per test
let mockUseXRPL;

jest.mock('../../hooks/useXRPL', () => ({
  useXRPL: () => mockUseXRPL,
  XRPLProvider: ({ children }) => <div data-testid="xrpl-provider">{children}</div>
}));

// Capture the Scanner props so tests can drive onDecode/onError directly
let scannerProps;
jest.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: (props) => {
    scannerProps = props;
    return <div data-testid="qr-camera" />;
  }
}));

const RECIPIENT = 'rRecipient123456789012345678901234';

function buildMock(overrides = {}) {
  return {
    wallet: { address: 'rTest1234567890123456789012345678901234' },
    loading: false,
    sendPayment: jest.fn().mockResolvedValue({ success: true, hash: 'h' }),
    createWallet: jest.fn().mockResolvedValue({ address: 'rNew' }),
    ...overrides
  };
}

function renderScanner() {
  return render(
    <MemoryRouter>
      <XRPLProvider>
        <QRScanner />
      </XRPLProvider>
    </MemoryRouter>
  );
}

function enterManualData(text) {
  fireEvent.change(
    screen.getByPlaceholderText(/paste qr code data here/i),
    { target: { value: text } }
  );
  fireEvent.click(screen.getByRole('button', { name: /process qr data/i }));
}

describe('QRScanner Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scannerProps = null;
    mockUseXRPL = buildMock();
  });

  it('shows the wallet creation screen when there is no wallet', async () => {
    mockUseXRPL = buildMock({ wallet: null });
    renderScanner();

    expect(screen.getByText('No Wallet Found')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create new wallet/i }));
    await waitFor(() => {
      expect(mockUseXRPL.createWallet).toHaveBeenCalled();
    });
  });

  it('renders the scanner and manual input when a wallet exists', () => {
    renderScanner();

    expect(screen.getByTestId('qr-camera')).toBeInTheDocument();
    expect(screen.getByText(/Manual QR Input/)).toBeInTheDocument();
    expect(screen.getByText(/Supported formats:/)).toBeInTheDocument();
  });

  it('parses a JSON payment request and shows the payment details', () => {
    renderScanner();

    enterManualData(
      JSON.stringify({
        type: 'payment_request',
        recipient: RECIPIENT,
        amount: 10.5,
        memo: 'Dinner'
      })
    );

    expect(notice.success).toHaveBeenCalledWith('Payment request loaded');
    expect(screen.getByText('Payment Request')).toBeInTheDocument();
    expect(screen.getByText('10.5 XRP')).toBeInTheDocument();
    expect(screen.getByText(RECIPIENT)).toBeInTheDocument();
    expect(screen.getByText('Dinner')).toBeInTheDocument();
  });

  it('parses the legacy comma-separated format (address,amount,memo)', () => {
    renderScanner();

    enterManualData(`${RECIPIENT},7.25,Coffee`);

    expect(notice.success).toHaveBeenCalledWith('Payment request loaded');
    expect(screen.getByText('7.25 XRP')).toBeInTheDocument();
    expect(screen.getByText(RECIPIENT)).toBeInTheDocument();
    expect(screen.getByText('Coffee')).toBeInTheDocument();
  });

  it('rejects invalid QR data with an error toast', () => {
    renderScanner();

    enterManualData('not-a-payment-request');

    expect(notice.error).toHaveBeenCalledWith(
      'Invalid QR code format. Please scan a valid payment request QR code.'
    );
  });

  it('rejects a JSON QR payload of the wrong shape', () => {
    renderScanner();

    enterManualData(JSON.stringify({ type: 'something_else', foo: 1 }));

    expect(notice.error).toHaveBeenCalledWith(
      'Invalid QR code. Please scan a payment request QR code.'
    );
  });

  it('requires manual input before processing', () => {
    renderScanner();

    fireEvent.click(screen.getByRole('button', { name: /process qr data/i }));

    expect(notice.error).toHaveBeenCalledWith('Please enter QR code data first.');
  });

  it('sends the payment on confirm and clears the request', async () => {
    renderScanner();

    enterManualData(`${RECIPIENT},10,Memo`);
    fireEvent.click(screen.getByRole('button', { name: /confirm & send payment/i }));

    await waitFor(() => {
      expect(mockUseXRPL.sendPayment).toHaveBeenCalledWith(RECIPIENT, 10, 'Memo');
    });
    // The details block stays mounted (CSS-hidden); the amount disappears.
    await waitFor(() => {
      expect(screen.queryByText('10 XRP')).not.toBeInTheDocument();
    });
  });

  it('cancels a loaded payment request', () => {
    renderScanner();

    enterManualData(`${RECIPIENT},10,Memo`);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(notice.info).toHaveBeenCalledWith('Payment cancelled');
    expect(screen.queryByText('10 XRP')).not.toBeInTheDocument();
  });

  it('surfaces scanner errors (camera denied) via toast and inline message', () => {
    renderScanner();

    expect(scannerProps).toBeTruthy();
    act(() => {
      scannerProps.onError({ name: 'NotAllowedError', message: 'denied' });
    });

    expect(notice.error).toHaveBeenCalledWith(
      'Camera access denied. Please enable camera permissions in your browser or device settings.'
    );
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('feeds decoded camera results through the same parser', () => {
    renderScanner();

    act(() => {
      scannerProps.onDecode(`${RECIPIENT},3,Scan`);
    });

    expect(notice.success).toHaveBeenCalledWith('Payment request loaded');
    expect(screen.getByText('3 XRP')).toBeInTheDocument();
  });

  it('creates a wallet from the no-wallet screen', async () => {
    mockUseXRPL = buildMock({ wallet: null });
    renderScanner();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create new wallet/i }));
    });
    expect(mockUseXRPL.createWallet).toHaveBeenCalled();
    expect(notice.success).toHaveBeenCalledWith('Wallet created successfully!');
  });

  it('surfaces other scanner error types with a generic message', () => {
    renderScanner();
    act(() => {
      scannerProps.onError({ name: 'NotReadableError', message: 'unreadable' });
    });
    expect(notice.error).toHaveBeenCalledWith('Scanner error: unreadable');
    expect(screen.getByText('unreadable')).toBeInTheDocument();
  });

  it('swallows sendPayment failures without crashing', async () => {
    mockUseXRPL = buildMock({ sendPayment: jest.fn().mockRejectedValue(new Error('ledger busy')) });
    renderScanner();
    enterManualData(`${RECIPIENT},10,Memo`);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm & send payment/i }));
    });
    expect(mockUseXRPL.sendPayment).toHaveBeenCalledWith(RECIPIENT, 10, 'Memo');
    expect(screen.getByText('10 XRP')).toBeInTheDocument();
  });

  it('shows an inline error when wallet creation fails', async () => {
    mockUseXRPL = buildMock({
      wallet: null,
      createWallet: jest.fn().mockRejectedValue(new Error('creation failed'))
    });
    renderScanner();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create new wallet/i }));
    });
    expect(notice.error).toHaveBeenCalledWith('Error creating wallet: creation failed');
  });
});
