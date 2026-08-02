import { useCallback, useEffect, useRef, useState } from 'react';
import authService from '../services/authService';
import { useXRPL } from './useXRPL';

/**
 * useOrderFeed — live order book updates over WebSocket.
 *
 * Opens a single authenticated WebSocket to the same origin as the API
 * (wsBaseUrl from the XRPL context), subscribes to `order_status` events, and
 * invokes `onUpdate` (debounced) whenever an order changes. This lets the P2P
 * order book refresh immediately on trades instead of only on the 15s poll.
 *
 * Reconnects with exponential backoff (1s → 30s max). Cleans up timers and the
 * socket on unmount or when `enabled` flips to false.
 */
const useOrderFeed = ({ onUpdate, enabled = true, debounceMs = 1000 } = {}) => {
  const { wsBaseUrl } = useXRPL();
  const [isLive, setIsLive] = useState(false);

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const attemptRef = useRef(0);

  const onUpdateRef = useRef(onUpdate);
  const enabledRef = useRef(enabled);
  const wsBaseUrlRef = useRef(wsBaseUrl);

  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { wsBaseUrlRef.current = wsBaseUrl; }, [wsBaseUrl]);

  const connect = useCallback(() => {
    const base = wsBaseUrlRef.current;
    let token = null;
    try {
      token = typeof authService.getToken === 'function' ? authService.getToken() : null;
    } catch (error) {
      token = null;
    }
    if (!base || !token || !enabledRef.current) return;

    let socket;
    try {
      socket = new WebSocket(base);
    } catch (error) {
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ action: 'auth', token }));
    };

    socket.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.event === 'authenticated') {
          attemptRef.current = 0;
          setIsLive(true);
          return;
        }
        if (packet.event === 'order_status') {
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            if (onUpdateRef.current) onUpdateRef.current();
          }, debounceMs);
        }
      } catch (error) {
        // Ignore malformed frames.
      }
    };

    socket.onclose = () => {
      setIsLive(false);
      socketRef.current = null;
      if (enabledRef.current) {
        const delay = Math.min(30000, 1000 * 2 ** attemptRef.current);
        attemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    socket.onerror = () => {
      try {
        socket.close();
      } catch (error) {
        // Already closed.
      }
    };
  }, [debounceMs]);

  useEffect(() => {
    if (!enabled) return undefined;

    connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close();
      }
      setIsLive(false);
    };
  }, [enabled, connect]);

  return { isLive };
};

export default useOrderFeed;
