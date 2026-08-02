/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { notice } from '../../services/notice';
import RequestFlow from '../RequestFlow';
import { useXRPL } from '../../hooks/useXRPL';
import authService from '../../services/authService';
import QRCodeLib from 'qrcode';

jest.mock('../../hooks/useXRPL');
jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: { authFetch: jest.fn() }
}));
jest.mock('qrcode', () => ({ toCanvas: jest.fn().mockResolvedValue(undefined) }));

const ADDR = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const OTHER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

const walletHook = { wallet: { address: ADDR }, apiBaseUrl: 'http://localhost:5001' };

const myRequests = [
  { request_id: 'R1', to_address: ADDR, amount_xrp: '5', memo: 'coffee', status: 'open' },
  { request_id: 'R2', to_address: ADDR, amount_xrp: '1', memo: null, status: 'paid' },
  { request_id: 'R3', to_address: OTHER, amount_xrp: '9', memo: null, status: 'open' }
];

beforeEach(() => {
  jest.resetAllMocks();
  useXRPL.mockReturnValue({ ...walletHook });
  global.fetch = jest.fn().mockResolvedValue({
    json: () => Promise.resolve({ success: true, paymentRequests: myRequests })
  });
  authService.authFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, paymentRequest: { request_id: 'NEWREQ' } })
  });
  QRCodeLib.toCanvas.mockResolvedValue(undefined);
  Object.assign(navigator, {
    clipboard: { writeText: jest.fn().mockResolvedValue(undefined) }
  });
  delete navigator.share;
});

describe('RequestFlow', () => {
  test('prompts for a wallet when none is loaded', () => {
    useXRPL.mockReturnValue({ wallet: null, apiBaseUrl: 'http://localhost:5001' });
    render(<RequestFlow />);
    expect(screen.getByText(/Create or unlock your wallet/)).toBeInTheDocument();
  });

  test('renders amount input and lists my open requests only', async () => {
    render(<RequestFlow />);
    await waitFor(() => expect(screen.getByText(/5 XRP/)).toBeInTheDocument());
    expect(screen.getByText(/coffee/)).toBeInTheDocument();
    expect(screen.getByText('paid ✓')).toBeInTheDocument();
    // other user's request filtered out
    expect(screen.queryByText(/9 XRP/)).not.toBeInTheDocument();
  });

  test('create button stays disabled until a positive amount', () => {
    render(<RequestFlow />);
    expect(screen.getByText('Create request link')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '12' } });
    expect(screen.getByText('Create request link')).toBeEnabled();
  });

  test('private note toggle reveals the note input', () => {
    render(<RequestFlow />);
    fireEvent.click(screen.getByText('+ private note'));
    fireEvent.change(screen.getByPlaceholderText(/What's it for/), { target: { value: 'dinner' } });
    expect(screen.getByDisplayValue('dinner')).toBeInTheDocument();
    expect(screen.getByText(/never on the blockchain/)).toBeInTheDocument();
  });

  test('creates a request link and renders the QR card', async () => {
    render(<RequestFlow />);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '7.5' } });
    fireEvent.click(screen.getByText('+ private note'));
    fireEvent.change(screen.getByPlaceholderText(/What's it for/), { target: { value: 'rent' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Create request link'));
    });
    expect(authService.authFetch).toHaveBeenCalledWith(
      'http://localhost:5001/api/payment_requests',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ amount: 7.5, recipientAddress: ADDR, memo: 'rent' })
      })
    );
    expect(screen.getByText(/Scan to pay me 7.5 XRP/)).toBeInTheDocument();
    // link is truncated for display; assert the visible prefix and rely on
    // the copy test for the full req=NEWREQ payload
    expect(screen.getByText(/\/pay\?to=/)).toBeInTheDocument();
    await waitFor(() => expect(QRCodeLib.toCanvas).toHaveBeenCalled());
  });

  test('create failure surfaces a toast', async () => {
    authService.authFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, message: 'bad request' })
    });
    render(<RequestFlow />);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '3' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Create request link'));
    });
    expect(notice.error).toHaveBeenCalledWith('bad request');
    expect(screen.queryByText(/Scan to pay me/)).not.toBeInTheDocument();
  });

  test('copy button writes the link to the clipboard', async () => {
    render(<RequestFlow />);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '2' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Create request link'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Copy'));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('req=NEWREQ'));
    expect(notice.success).toHaveBeenCalledWith('Link copied');
  });

  test('clipboard failure toasts an error', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
    render(<RequestFlow />);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '2' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Create request link'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Copy'));
    });
    expect(notice.error).toHaveBeenCalledWith('Could not copy the link');
  });

  test('share uses navigator.share when available', async () => {
    navigator.share = jest.fn().mockResolvedValue(undefined);
    render(<RequestFlow />);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Create request link'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Share link'));
    });
    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('req=NEWREQ')
    }));
  });

  test('share falls back to copy when navigator.share rejects', async () => {
    navigator.share = jest.fn().mockRejectedValue(new Error('cancelled'));
    render(<RequestFlow />);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Create request link'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Share link'));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});
