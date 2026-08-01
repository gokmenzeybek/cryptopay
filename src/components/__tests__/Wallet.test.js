/**
 * @jest-environment jsdom
 */
/**
 * Unit Tests for Wallet Component
 *
 * Rewritten in Phase 7 (PRD 7.1.1) against the current Wallet.js: connection
 * status block, address/balance info items, create/refresh/export actions.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import { XRPLProvider } from '../../hooks/useXRPL';
import Wallet from '../Wallet';
import { encryptWalletForExport } from '../../services/walletStorage';

// Mock the useXRPL hook — rebuilt per test to avoid cross-test pollution
let mockUseXRPL;

jest.mock('../../hooks/useXRPL', () => ({
  useXRPL: () => mockUseXRPL,
  XRPLProvider: ({ children }) => <div data-testid="xrpl-provider">{children}</div>
}));

jest.mock('../../services/walletStorage', () => ({
  encryptWalletForExport: jest.fn()
}));

const ADDRESS = 'rTest1234567890123456789012345678901234';

function buildMock(overrides = {}) {
  return {
    wallet: null,
    isConnected: false,
    balance: '0',
    loading: false,
    createWallet: jest.fn().mockResolvedValue({ address: ADDRESS }),
    loadExistingWallet: jest.fn(),
    refreshBalance: jest.fn().mockResolvedValue('1500'),
    connectToXRPL: jest.fn().mockResolvedValue(true),
    askPassword: jest.fn(),
    ...overrides
  };
}

describe('Wallet Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseXRPL = buildMock();
  });

  it('renders connection status and "Not connected" when there is no wallet', () => {
    render(
      <XRPLProvider>
        <Wallet />
      </XRPLProvider>
    );

    expect(screen.getByText('XRPL Connection Status')).toBeInTheDocument();
    expect(screen.getByText(/Disconnected/)).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect to xrpl first/i })).toBeDisabled();
  });

  it('shows a connect button when disconnected and calls connectToXRPL', async () => {
    render(
      <XRPLProvider>
        <Wallet />
      </XRPLProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /^connect to xrpl$/i }));

    await waitFor(() => {
      expect(mockUseXRPL.connectToXRPL).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Connected to XRPL successfully!');
    });
  });

  it('enables wallet creation when connected and calls createWallet on click', async () => {
    mockUseXRPL = buildMock({ isConnected: true });

    render(
      <XRPLProvider>
        <Wallet />
      </XRPLProvider>
    );

    const createButton = screen.getByRole('button', { name: /create new wallet/i });
    expect(createButton).not.toBeDisabled();

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(mockUseXRPL.createWallet).toHaveBeenCalled();
    });
  });

  it('disables the create button while loading', () => {
    mockUseXRPL = buildMock({ isConnected: true, loading: true });

    render(
      <XRPLProvider>
        <Wallet />
      </XRPLProvider>
    );

    expect(screen.getByRole('button', { name: /create new wallet/i })).toBeDisabled();
  });

  it('renders wallet address, balance, and actions when a wallet exists', () => {
    mockUseXRPL = buildMock({
      isConnected: true,
      wallet: { address: ADDRESS, publicKey: 'testPublicKey123' },
      balance: '1000'
    });

    render(
      <XRPLProvider>
        <Wallet />
      </XRPLProvider>
    );

    expect(screen.getByText('Wallet Address')).toBeInTheDocument();
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(screen.getByText('1000 XRP')).toBeInTheDocument();
    expect(screen.getByText(/Connected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh balance/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export wallet/i })).toBeInTheDocument();
  });

  it('calls refreshBalance when the refresh button is clicked', async () => {
    mockUseXRPL = buildMock({
      isConnected: true,
      wallet: { address: ADDRESS }
    });

    render(
      <XRPLProvider>
        <Wallet />
      </XRPLProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /refresh balance/i }));

    await waitFor(() => {
      expect(mockUseXRPL.refreshBalance).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Balance updated');
    });
  });

  it('handles createWallet errors without crashing', async () => {
    mockUseXRPL = buildMock({
      isConnected: true,
      createWallet: jest.fn().mockRejectedValue(new Error('Creation failed'))
    });

    render(
      <XRPLProvider>
        <Wallet />
      </XRPLProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /create new wallet/i }));

    await waitFor(() => {
      expect(mockUseXRPL.createWallet).toHaveBeenCalled();
    });
  });

  it('shows a zero balance as 0 XRP', () => {
    mockUseXRPL = buildMock({
      isConnected: true,
      wallet: { address: ADDRESS },
      balance: '0'
    });

    render(
      <XRPLProvider>
        <Wallet />
      </XRPLProvider>
    );

    expect(screen.getByText('0 XRP')).toBeInTheDocument();
  });

  describe('Export Wallet (encrypted, PRD 4.3.2)', () => {
    beforeEach(() => {
      mockUseXRPL = buildMock({
        isConnected: true,
        wallet: { address: ADDRESS }
      });
    });

    it('cancels the export when no password is provided', async () => {
      mockUseXRPL.askPassword.mockResolvedValue(null);

      render(
        <XRPLProvider>
          <Wallet />
        </XRPLProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: /export wallet/i }));

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(
          expect.stringContaining('Export cancelled')
        );
      });
      expect(encryptWalletForExport).not.toHaveBeenCalled();
    });

    it('encrypts and downloads the export when a password is provided', async () => {
      mockUseXRPL.askPassword.mockResolvedValue('s3cure-pw');
      encryptWalletForExport.mockResolvedValue({ version: 1, ciphertext: 'abc' });

      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});
      global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock');

      render(
        <XRPLProvider>
          <Wallet />
        </XRPLProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: /export wallet/i }));

      await waitFor(() => {
        expect(encryptWalletForExport).toHaveBeenCalledWith(
          mockUseXRPL.wallet,
          's3cure-pw'
        );
      });
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Encrypted wallet exported successfully');
      });

      clickSpy.mockRestore();
    });
  });
});
