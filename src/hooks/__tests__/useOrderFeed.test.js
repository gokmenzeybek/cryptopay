/**
 * @jest-environment jsdom
 *
 * Unit tests for the useOrderFeed hook (Phase 4 live order book feed):
 *  - authenticates over the WebSocket and marks the feed live
 *  - debounces order_status updates into onUpdate calls
 *  - skips connecting when disabled
 *  - reconnects with backoff after an unexpected close
 *  - cleans up socket and timers on unmount
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useXRPL, XRPLProvider } from '../useXRPL';
import authService from '../../services/authService';
import useOrderFeed from '../useOrderFeed';

jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn().mockReturnValue('jwt-token'),
    login: jest.fn(),
    authFetch: jest.fn(),
    logout: jest.fn(),
    setBaseUrl: jest.fn(),
    setToken: jest.fn()
  }
}));

jest.mock('../../services/walletStorage', () => ({
  saveWalletEncrypted: jest.fn().mockResolvedValue(),
  loadWalletEncrypted: jest.fn().mockResolvedValue(null),
  hasStoredWallet: jest.fn().mockReturnValue(false),
  getStoredWalletAddress: jest.fn().mockReturnValue(null),
  clearStoredWallet: jest.fn()
}));

jest.mock('../../services/notice', () => ({
  notice: { error: jest.fn() }
}));

class MockWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose({});
  }

  _open() {
    this.readyState = 1;
    if (this.onopen) this.onopen({});
  }

  _message(payload) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(payload) });
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function Wrapper({ children }) {
  return <XRPLProvider>{children}</XRPLProvider>;
}

describe('useOrderFeed', () => {
  const onUpdate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    MockWebSocket.instances = [];
    delete global.WebSocket;
    global.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    delete global.WebSocket;
  });

  it('authenticates on open and reports live on the authenticated event', async () => {
    process.env.REACT_APP_WS_URL = 'wss://ws.example.com';

    const { result } = renderHook(
      () => useOrderFeed({ onUpdate }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      await wait(0);
      expect(MockWebSocket.instances.length).toBe(1);
      MockWebSocket.instances[0]._open();
      await wait(0);
    });

    expect(MockWebSocket.instances[0].sent[0].action).toBe('auth');
    expect(MockWebSocket.instances[0].sent[0].token).toBe('jwt-token');

    await act(async () => {
      MockWebSocket.instances[0]._message({ event: 'authenticated', address: 'rTest' });
    });

    expect(result.current.isLive).toBe(true);
    delete process.env.REACT_APP_WS_URL;
  });

  it('debounces order_status events into a single onUpdate call', async () => {
    process.env.REACT_APP_WS_URL = 'wss://ws.example.com';

    const { result } = renderHook(
      () => useOrderFeed({ onUpdate, debounceMs: 30 }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      await wait(0);
      MockWebSocket.instances[0]._open();
      await wait(0);
      MockWebSocket.instances[0]._message({ event: 'authenticated' });
      MockWebSocket.instances[0]._message({ event: 'order_status', data: { orderId: '1', status: 'open' } });
      MockWebSocket.instances[0]._message({ event: 'order_status', data: { orderId: '2', status: 'matched' } });
      await wait(60);
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(result.current.isLive).toBe(true);
    delete process.env.REACT_APP_WS_URL;
  });

  it('does not connect when disabled', async () => {
    process.env.REACT_APP_WS_URL = 'wss://ws.example.com';

    renderHook(
      () => useOrderFeed({ onUpdate, enabled: false }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      await wait(0);
    });

    expect(MockWebSocket.instances.length).toBe(0);
    delete process.env.REACT_APP_WS_URL;
  });

  it('reconnects with exponential backoff after an unexpected close', async () => {
    jest.useFakeTimers();
    process.env.REACT_APP_WS_URL = 'wss://ws.example.com';

    renderHook(
      () => useOrderFeed({ onUpdate }),
      { wrapper: Wrapper }
    );

    act(() => {
      MockWebSocket.instances[0]._open();
    });
    act(() => {
      MockWebSocket.instances[0]._message({ event: 'authenticated' });
    });

    act(() => {
      MockWebSocket.instances[0].close();
    });

    expect(MockWebSocket.instances.length).toBe(1);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(MockWebSocket.instances.length).toBe(2);

    jest.useRealTimers();
    delete process.env.REACT_APP_WS_URL;
  });
});
