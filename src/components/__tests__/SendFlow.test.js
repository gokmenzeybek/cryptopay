/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SendFlow from '../SendFlow';
import { useXRPL } from '../../hooks/useXRPL';

jest.mock('../../hooks/useXRPL');

jest.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: (props) => {
    // expose the callbacks for deterministic tests
    global.__scannerProps = props;
    return <div data-testid="scanner" />;
  }
}));

jest.mock('../AddFunds', () => {
  return {
    __esModule: true,
    default: (props) => (
      <div data-testid="add-funds" data-preset={props.presetTry}>
        Add funds sheet
      </div>
    )
  };
});

const ADDR = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

const hookBase = {
  apiBaseUrl: 'http://localhost:5001',
  wallet: { address: ADDR },
  sendPayment: jest.fn(),
  createBurnerWallet: jest.fn().mockResolvedValue({ address: ADDR })
};

const renderFlow = (route = '/') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <SendFlow />
    </MemoryRouter>
  );

beforeEach(() => {
  jest.resetAllMocks();
  // Re-implement the burner mock after the reset so the auto-bootstrap resolves.
  hookBase.createBurnerWallet = jest.fn().mockResolvedValue({ address: ADDR });
  useXRPL.mockReturnValue({ ...hookBase });
  window.xrpl = {
    isValidClassicAddress: (a) => typeof a === 'string' && a.startsWith('r') && a.length >= 25
  };
  global.fetch = jest.fn().mockResolvedValue({
    json: () => Promise.resolve({ success: true, rate: '40' })
  });
});

describe('SendFlow', () => {
  test('renders recipient and amount inputs', () => {
    renderFlow();
    expect(screen.getByPlaceholderText('Recipient address (r…)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0')).toBeInTheDocument();
    expect(screen.getByText('Review payment')).toBeDisabled();
  });

  test('pre-fills from payment-link search params', () => {
    renderFlow(`/?to=${ADDR}&amount=12.5&memo=dinner`);
    expect(screen.getByPlaceholderText('Recipient address (r…)')).toHaveValue(ADDR);
    expect(screen.getByPlaceholderText('0')).toHaveValue(12.5);
    expect(screen.getByDisplayValue('dinner')).toBeInTheDocument();
  });

  test('shows invalid-address feedback for a bad recipient', () => {
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Recipient address (r…)'), {
      target: { value: 'notanaddress' }
    });
    expect(screen.getByText('Not a valid XRPL address')).toBeInTheDocument();
  });

  test('shows valid feedback and fiat conversion, enables review', async () => {
    renderFlow();
    fireEvent.change(screen.getByPlaceholderText('Recipient address (r…)'), {
      target: { value: ADDR }
    });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '10' } });
    expect(screen.getByText(/Valid address/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/≈ ₺400,00/)).toBeInTheDocument());
    expect(screen.getByText('Review payment')).toBeEnabled();
  });

  test('TRY unit converts the amount through the rate', async () => {
    renderFlow(`/?to=${ADDR}`);
    fireEvent.click(screen.getByText('₺ TRY'));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '80' } });
    await waitFor(() => expect(screen.getByText(/≈ 2\.000000 XRP/)).toBeInTheDocument());
    expect(screen.getByText('Review payment')).toBeEnabled();
  });

  test('note toggle reveals the memo input', () => {
    renderFlow();
    fireEvent.click(screen.getByText(/Add a note/));
    fireEvent.change(screen.getByPlaceholderText(/Note — public/), { target: { value: 'rent' } });
    expect(screen.getByDisplayValue('rent')).toBeInTheDocument();
  });

  test('requires a wallet before review is possible (no pay link)', () => {
    useXRPL.mockReturnValue({ ...hookBase, wallet: null });
    renderFlow('/');
    expect(screen.getByText(/Create or unlock your wallet/)).toBeInTheDocument();
    expect(screen.getByText('Review payment')).toBeDisabled();
  });

  test('wallet-less user opening a pay link gets a burner wallet created once', async () => {
    useXRPL.mockReturnValue({ ...hookBase, wallet: null });
    renderFlow(`/?to=${ADDR}&amount=5`);
    await waitFor(() => {
      expect(hookBase.createBurnerWallet).toHaveBeenCalledTimes(1);
    });
  });

  test('auto-opens the Papara buy sheet pre-filled after wallet boot', async () => {
    useXRPL.mockReturnValue({ ...hookBase, wallet: null, createBurnerWallet: jest.fn().mockResolvedValue({ address: ADDR }) });
    renderFlow(`/?to=${ADDR}&amount=5`);
    await waitFor(() => {
      const sheet = screen.getByTestId('add-funds');
      expect(sheet).toBeInTheDocument();
      expect(sheet.getAttribute('data-preset')).toBe('200');
    });
  });

  test('does not auto-create a wallet for a wallet-less plain /pay visit', () => {
    const createBurnerWallet = jest.fn();
    useXRPL.mockReturnValue({ ...hookBase, wallet: null, createBurnerWallet });
    renderFlow('/');
    expect(createBurnerWallet).not.toHaveBeenCalled();
    expect(screen.getByText(/Create or unlock your wallet/)).toBeInTheDocument();
  });

  test('falls back to manual wallet hint when auto-create fails', async () => {
    useXRPL.mockReturnValue({
      ...hookBase,
      wallet: null,
      createBurnerWallet: jest.fn().mockRejectedValue(new Error('SPONSOR_SEED missing'))
    });
    renderFlow(`/?to=${ADDR}&amount=5`);
    await waitFor(() => {
      expect(screen.getByText(/Could not create a temporary wallet/)).toBeInTheDocument();
    });
    expect(screen.getByText('Review payment')).toBeDisabled();
  });

  test('scan mode fills recipient/amount/memo from a payment link', async () => {
    renderFlow('/?scan=1');
    expect(screen.getByTestId('scanner')).toBeInTheDocument();
    act(() => {
      global.__scannerProps.onScan([{ rawValue: `https://x.example/pay?to=${ADDR}&amount=7&memo=hi` }]);
    });
    expect(screen.getByPlaceholderText('Recipient address (r…)')).toHaveValue(ADDR);
    expect(screen.getByPlaceholderText('0')).toHaveValue(7);
    expect(screen.getByDisplayValue('hi')).toBeInTheDocument();
    expect(screen.queryByTestId('scanner')).not.toBeInTheDocument();
  });

  test('scan with a bare address fills only the recipient', () => {
    renderFlow();
    fireEvent.click(screen.getByLabelText('Scan a QR code'));
    act(() => {
      global.__scannerProps.onScan([{ rawValue: ADDR }]);
    });
    expect(screen.getByPlaceholderText('Recipient address (r…)')).toHaveValue(ADDR);
  });

  test('scan ignores empty results', () => {
    renderFlow('/?scan=1');
    act(() => {
      global.__scannerProps.onScan([]);
      global.__scannerProps.onScan([{}]);
    });
    expect(screen.getByTestId('scanner')).toBeInTheDocument();
  });

  test('opens the confirm sheet on review', async () => {
    renderFlow(`/?to=${ADDR}&amount=3`);
    await waitFor(() => expect(screen.getByText('Review payment')).toBeEnabled());
    fireEvent.click(screen.getByText('Review payment'));
    expect(screen.getByText(/slide to send/i)).toBeInTheDocument();
  });

  test('resolves a payment-request link and shows the private note', async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes('/api/payment_requests/REQ1')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, paymentRequest: { memo: 'for pizza', status: 'open' } })
        });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: true, rate: '40' }) });
    });
    renderFlow(`/?to=${ADDR}&amount=3&req=REQ1`);
    await waitFor(() => expect(screen.getByText('Review payment')).toBeEnabled());
    fireEvent.click(screen.getByText('Review payment'));
    await waitFor(() => expect(screen.getByText(/for pizza/)).toBeInTheDocument());
  });

  test('paid payment request is flagged as already paid', async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes('/api/payment_requests/REQ2')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, paymentRequest: { memo: null, status: 'paid' } })
        });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: true, rate: '40' }) });
    });
    renderFlow(`/?to=${ADDR}&amount=3&req=REQ2`);
    await waitFor(() => expect(screen.getByText('Review payment')).toBeEnabled());
    fireEvent.click(screen.getByText('Review payment'));
    await waitFor(() => expect(screen.getByText(/already paid/)).toBeInTheDocument());
  });
});
