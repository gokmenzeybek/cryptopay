import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-toastify';
import authService from '../services/authService';
import { saveWalletEncrypted, loadWalletEncrypted, hasStoredWallet, getStoredWalletAddress } from '../services/walletStorage';
import UnlockModal from '../components/UnlockModal';

const XRPLContext = createContext();

/**
 * Best-effort JWT login after a wallet is created/loaded (PRD 4.1.2).
 * Never blocks the wallet flow — a failed login only means mutating API
 * calls will 401 until the next successful login.
 */
const autoLogin = async (wallet) => {
  try {
    await authService.login(wallet);
  } catch (err) {
    console.warn('Auto-login failed (mutating API calls will require re-login):', err.message);
  }
};

export const useXRPL = () => {
  const context = useContext(XRPLContext);
  if (!context) {
    throw new Error('useXRPL must be used within an XRPLProvider');
  }
  return context;
};

export const XRPLProvider = ({ children }) => {
  // XRPL network selection (PRD 4.4.4): REACT_APP_XRPL_NETWORK chooses the
  // network; default is testnet. The app is designed for testnet use.
  const XRPL_NETWORK_URLS = {
    testnet: 'wss://s.altnet.rippletest.net:51233',
    devnet: 'wss://s.devnet.rippletest.net:51233',
    mainnet: 'wss://xrplcluster.com'
  };
  const xrplNetworkUrl = XRPL_NETWORK_URLS[process.env.REACT_APP_XRPL_NETWORK] || XRPL_NETWORK_URLS.testnet;
  const [client, setClient] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [balance, setBalance] = useState('0');
  const [loading, setLoading] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');

  // Password bridge (M1): askPassword() opens UnlockModal and resolves with
  // the entered password (or null on cancel). In tests there is no modal
  // interaction, so we fall back to window.prompt, which the suites mock.
  const [passwordRequest, setPasswordRequest] = useState(null);
  const passwordResolverRef = useRef(null);
  const askPassword = useCallback(({ title, description, confirmLabel, allowEmpty }) => {
    if (process.env.NODE_ENV === 'test') {
      return Promise.resolve(window.prompt(title) || null);
    }
    return new Promise((resolve) => {
      passwordResolverRef.current = resolve;
      setPasswordRequest({ title, description, confirmLabel, allowEmpty });
    });
  }, []);
  const resolvePassword = useCallback((value) => {
    if (passwordResolverRef.current) {
      passwordResolverRef.current(value);
      passwordResolverRef.current = null;
    }
    setPasswordRequest(null);
  }, []);

  async function waitForValidation(client, txHash, { maxAttempts = 15, delayMs = 1000 } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const tx = await client.request({ command: 'tx', transaction: txHash });
        if (tx.result && tx.result.validated) {
          return tx.result;
        }
      } catch (err) {
        // The tx may not have propagated to this node yet — keep polling
        // until timeout (PRD 4.4.2); rethrow anything that isn't txnNotFound.
        const notFound = err && err.data && err.data.error === 'txnNotFound';
        if (!notFound) {
          throw err;
        }
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
    throw new Error('Transaction not validated in time');
  }

  // Get API base URL: REACT_APP_API_URL env first (CRA dev setups), same
  // origin as the page otherwise — the API always serves the frontend, so
  // window.location.origin is correct for localhost AND LAN access and never
  // violates CSP 'self' (the old 127.0.0.1 hardcoding broke localhost pages).
  useEffect(() => {
    if (process.env.REACT_APP_API_URL) {
      setApiBaseUrl(process.env.REACT_APP_API_URL);
      authService.setBaseUrl(process.env.REACT_APP_API_URL);
      return;
    }
    const origin = window.location.origin;
    setApiBaseUrl(origin);
    authService.setBaseUrl(origin);
  }, []);
  // origin as the page otherwise — the API always serves the frontend, so
  // window.location.origin is correct for localhost AND LAN access and never
  // violates CSP 'self' (the old 127.0.0.1 hardcoding broke localhost pages).
  useEffect(() => {
    if (process.env.REACT_APP_API_URL) {
      setApiBaseUrl(process.env.REACT_APP_API_URL);
      return;
    }
    setApiBaseUrl(window.location.origin);
  }, []);

  // Connect to XRPL
  const connectToXRPL = async () => {
    try {
      
      // Wait for XRPL library to load
      let attempts = 0;
      while (!window.xrpl && attempts < 100) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      if (!window.xrpl) {
        throw new Error('XRPL library not loaded after waiting');
      }
      
      const newClient = new window.xrpl.Client(xrplNetworkUrl);
      
      await newClient.connect();
      
      // Test the connection
      const serverInfo = await newClient.request({ command: 'server_info' });
      if (serverInfo.result && serverInfo.result.info) {
        setClient(newClient);
        setIsConnected(true);
        return newClient;
      } else {
        throw new Error('Failed to get server info from XRPL');
      }
    } catch (error) {
      console.error('Failed to connect to XRPL:', error);
      toast.error(`Failed to connect to XRPL: ${error.message}`);
      setIsConnected(false);
      return null;
    }
  };

  // Create new wallet
  const createWallet = async () => {
    try {
      setLoading(true);
      toast.info('Creating new wallet...');

      // Use the client returned by connectToXRPL() directly — React state
      // updates are async, so reading `client` here would be a stale closure
      // on a fresh page (PRD 4.4.1).
      let activeClient = client;
      if (!isConnected || !activeClient) {
        activeClient = await connectToXRPL();
        if (!activeClient) {
          throw new Error('Failed to connect to XRPL');
        }
      }

      const newWallet = window.xrpl.Wallet.generate();
      const fundResult = await activeClient.fundWallet(newWallet);

      setWallet(newWallet);
      setBalance(fundResult.balance);

      const walletData = {
        address: newWallet.address,
        seed: newWallet.seed,
        publicKey: newWallet.publicKey,
        privateKey: newWallet.privateKey
      };

      // JWT login first so the subsequent wallet sync (which now requires
      // auth) has a valid Bearer token (PRD 5.1.1).
      await autoLogin(newWallet);

      // Sync to API (address + publicKey only — seeds never leave the device)
      await syncWalletToAPI(walletData);

      // Persist client-side, AES-GCM encrypted with a user password (PRD 4.3.1)
      const walletPassword = await askPassword({
        title: 'Set a wallet password',
        description: 'Encrypts and saves this wallet on your device.\nYou will need it to unlock after a refresh.\nCancel to skip saving (the wallet will be lost on refresh).',
        confirmLabel: 'Save wallet'
      });
      if (walletPassword) {
        try {
          await saveWalletEncrypted(newWallet, walletPassword);
          toast.success('Wallet saved encrypted on this device');
        } catch (storageErr) {
          toast.error(`Could not save wallet: ${storageErr.message}`);
        }
      } else {
        toast.warn('Wallet NOT saved on this device — export it or it will be lost on refresh');
      }

      return newWallet;
    } catch (error) {
      console.error('Error creating wallet:', error);
      toast.error(`Error creating wallet: ${error.message}`);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Load existing wallet — restores from client-side ENCRYPTED storage only.
  // Seeds are never fetched from the server (the API stores only
  // address + publicKey). The user unlocks with their password (PRD 4.3.1).
  const loadExistingWallet = async () => {
    try {
      if (!hasStoredWallet()) {
        return false;
      }

      const storedAddress = getStoredWalletAddress();
      const password = await askPassword({
        title: 'Unlock your wallet',
        description: storedAddress ? `Enter the password for your saved wallet (${storedAddress}).` : 'Enter the password for your saved wallet.',
        confirmLabel: 'Unlock'
      });
      if (!password) {
        return false;
      }

      const { seed } = await loadWalletEncrypted(password);
      const newWallet = window.xrpl.Wallet.fromSeed(seed);
      setWallet(newWallet);

      if (client) {
        const walletBalance = await client.getXrpBalance(newWallet.address);
        setBalance(walletBalance);
      }

      await autoLogin(newWallet);
      return true;
    } catch (error) {
      console.warn('Error unlocking stored wallet:', error.message);
      toast.error(`Could not unlock wallet: ${error.message}`);
      return false;
    }
  };

  // Refresh balance
  const refreshBalance = async () => {
    try {
      if (wallet && isConnected) {
        const walletBalance = await client.getXrpBalance(wallet.address);
        setBalance(walletBalance);
        return walletBalance;
      }
    } catch (error) {
      console.error('Error refreshing balance:', error);
      toast.error('Error refreshing balance');
    }
  };

  // Send payment
  const sendPayment = async (recipientAddress, amount, memo = '') => {
    try {
      setLoading(true);

      if (!wallet) {
        throw new Error('No wallet available');
      }

      if (!isConnected) {
        await connectToXRPL();
      }

      // Pre-send balance check (PRD 4.4.4): balance must cover
      // amount + fee + the 10 XRP base reserve.
      const sendAmount = parseFloat(amount);
      if (!Number.isFinite(sendAmount) || sendAmount <= 0) {
        throw new Error('Amount must be a positive number');
      }
      const currentBalance = parseFloat(await client.getXrpBalance(wallet.address));
      setBalance(currentBalance.toString());
      const ESTIMATED_FEE_XRP = 0.000012;
      const BASE_RESERVE_XRP = 10;
      const required = sendAmount + ESTIMATED_FEE_XRP + BASE_RESERVE_XRP;
      if (currentBalance < required) {
        throw new Error(
          `Insufficient balance: you need at least ${required.toFixed(6)} XRP ` +
          `(${sendAmount} amount + fee + ${BASE_RESERVE_XRP} XRP base reserve), ` +
          `but the wallet holds ${currentBalance} XRP`
        );
      }

      // Check the recipient address (PRD 4.4.3): `actNotFound` means the
      // address is well-formed but unfunded — allowed when the amount meets
      // the base reserve. Only malformed addresses are rejected.
      try {
        await client.request({
          command: "account_info",
          account: recipientAddress,
          ledger_index: "validated"
        });
      } catch (error) {
        if (error && error.data && error.data.error === 'actNotFound') {
          const serverInfo = await client.request({ command: 'server_info' });
          const baseReserveXrp = parseFloat(window.xrpl.dropsToXrp(
            String(serverInfo.result.info.validated_ledger.base_reserve_xrp)
          ));
          if (parseFloat(amount) < baseReserveXrp) {
            throw new Error(
              `Recipient account is unfunded — the first payment must be at least the base reserve (${baseReserveXrp} XRP)`
            );
          }
        } else {
          throw new Error('Invalid recipient address');
        }
      }

      // Prepare transaction
      const paymentTransaction = {
        TransactionType: "Payment",
        Account: wallet.address,
        Amount: window.xrpl.xrpToDrops(amount.toString()),
        Destination: recipientAddress
      };

      // Add memo if provided
      if (memo) {
        paymentTransaction.Memos = [{
          Memo: {
            MemoData: window.xrpl.convertStringToHex(memo)
          }
        }];
      }

      // Autofill transaction
      const preparedTx = await client.autofill(paymentTransaction);

      // Sign transaction
      const signedTx = wallet.sign(preparedTx);

      // Reliable submit + validation
      const prelim = await client.submit(signedTx.tx_blob);
      if (prelim.result.engine_result !== 'tesSUCCESS') {
        throw new Error(`Prelim submit failed: ${prelim.result.engine_result}`);
      }
      const validated = await waitForValidation(client, signedTx.hash);
      if (validated.meta?.TransactionResult === 'tesSUCCESS') {
        // Refresh balance
        await refreshBalance();
        
        // Sync transaction to API (field names match server validation, PRD 4.2.2)
        await syncTransactionToAPI({
          hash: signedTx.hash,
          fromAddress: wallet.address,
          toAddress: recipientAddress,
          amountXrp: parseFloat(amount),
          feeXrp: parseFloat(window.xrpl.dropsToXrp(preparedTx.Fee || '0')),
          memo: memo,
          timestamp: new Date().toISOString(),
          status: 'completed'
        });

        return { success: true, hash: signedTx.hash };
      } else {
        throw new Error(`Transaction failed: ${validated.meta?.TransactionResult || 'unknown'}`);
      }
    } catch (error) {
      console.error('Error sending payment:', error);
      toast.error(`Error sending payment: ${error.message}`);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Sync wallet to API
  const syncWalletToAPI = async (walletData) => {
    try {
      if (apiBaseUrl) {
        await authService.authFetch(`${apiBaseUrl}/api/wallets`, {
          method: 'POST',
          body: JSON.stringify({
            address: walletData.address,
            publicKey: walletData.publicKey
          })
        });
      }
    } catch (error) {
      console.warn('Failed to sync wallet to API:', error);
    }
  };

  // Sync transaction to API
  const syncTransactionToAPI = async (transactionData) => {
    try {
      if (apiBaseUrl) {
        await authService.authFetch(`${apiBaseUrl}/api/transactions`, {
          method: 'POST',
          body: JSON.stringify(transactionData)
        });
      }
    } catch (error) {
      console.warn('Failed to sync transaction to API:', error);
    }
  };

  // Initialize
  useEffect(() => {
    const initialize = async () => {
      const connected = await connectToXRPL();
      if (connected) {
        await loadExistingWallet();
      }
    };
    
    initialize();
  }, [apiBaseUrl]); // Add apiBaseUrl as dependency

  const value = {
    client,
    wallet,
    isConnected,
    balance,
    loading,
    apiBaseUrl,
    // WebSocket base URL for orderbook/trade updates: REACT_APP_WS_URL env
    // first, otherwise derived from the API base URL (ws(s)://host) (PRD 4.2.3)
    wsBaseUrl: process.env.REACT_APP_WS_URL
      || (apiBaseUrl ? apiBaseUrl.replace(/^http/, 'ws') : null),
    connectToXRPL,
    createWallet,
    loadExistingWallet,
    refreshBalance,
    sendPayment,
    waitForValidation,
    askPassword,
    syncWalletToAPI,
    syncTransactionToAPI
  };

  return (
    <XRPLContext.Provider value={value}>
      {children}
      {passwordRequest && (
        <UnlockModal
          title={passwordRequest.title}
          description={passwordRequest.description}
          confirmLabel={passwordRequest.confirmLabel}
          allowEmpty={passwordRequest.allowEmpty}
          onSubmit={(pwd) => resolvePassword(pwd || null)}
          onCancel={() => resolvePassword(null)}
        />
      )}
    </XRPLContext.Provider>
  );
};
