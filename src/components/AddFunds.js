import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled, { keyframes } from 'styled-components';
import { toast } from 'react-toastify';
import { useXRPL } from '../hooks/useXRPL';
import authService from '../services/authService';
import theme from '../theme';

/**
 * AddFunds — broker on-ramp modal (M4, PRODUCT_PLAN §7.2).
 * Internal 4-state machine:
 *   entry       → amount input + "Find a seller" CTA
 *   matching    → spinner while POST /api/p2p/quick-match runs
 *   instructions → pre-filled Papara transfer card + countdown + "I've sent it"
 *   waiting     → polling for completed status after buyer confirms payment
 *
 * The user sees: enter ₺ amount → send one Papara transfer → XRP arrives.
 * The order book is never mentioned.
 */

// ─── Animations ───────────────────────────────────────────────────────────────

const spin = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

// ─── Layout shells ────────────────────────────────────────────────────────────

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 20, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 2000;
  @media (min-width: 640px) { align-items: center; }
`;

const Sheet = styled.div`
  background: ${theme.color.paper};
  width: 100%;
  max-width: 420px;
  border-radius: ${theme.radius.sheet} ${theme.radius.sheet} 0 0;
  padding: 28px 24px 44px;
  animation: ${fadeIn} 220ms ease-out;
  @media (min-width: 640px) { border-radius: ${theme.radius.sheet}; }
`;

const DragHandle = styled.div`
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: ${theme.color.line};
  margin: 0 auto 24px;
`;

// ─── Shared type-scale ────────────────────────────────────────────────────────

const ScreenTitle = styled.h2`
  font-size: 20px;
  font-weight: 700;
  color: ${theme.color.ink};
  margin: 0 0 6px;
  font-family: ${theme.font.stack};
`;

const ScreenSub = styled.p`
  font-size: 14px;
  color: ${theme.color.inkSoft};
  margin: 0 0 28px;
  line-height: 1.5;
  font-family: ${theme.font.stack};
`;

const Label = styled.div`
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${theme.color.inkSoft};
  margin-bottom: 10px;
  font-family: ${theme.font.stack};
`;

// ─── Entry screen ─────────────────────────────────────────────────────────────

const AmountWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  background: ${theme.color.surface};
  border-radius: ${theme.radius.input};
  padding: 0 18px;
  height: 72px;
  margin-bottom: 10px;
`;

const CurrencyBadge = styled.span`
  font-size: 22px;
  font-weight: 700;
  color: ${theme.color.inkSoft};
  font-family: ${theme.font.stack};
  flex-shrink: 0;
`;

const AmountInput = styled.input`
  flex: 1;
  border: none;
  background: transparent;
  font-size: 40px;
  font-weight: 700;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  letter-spacing: -0.02em;
  outline: none;
  &::placeholder { color: ${theme.color.line}; }
`;

const XrpPreview = styled.div`
  font-size: 13px;
  color: ${theme.color.inkFaint};
  margin-bottom: 28px;
  font-family: ${theme.font.stack};
`;

const MethodSelect = styled.select`
  width: 100%;
  height: 52px;
  border: none;
  border-radius: ${theme.radius.input};
  background: ${theme.color.surface};
  font-size: 15px;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  padding: 0 16px;
  outline: none;
  cursor: pointer;
  margin-bottom: 24px;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B6B66' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 16px center;
`;

// ─── Matching screen ──────────────────────────────────────────────────────────

const SpinnerRing = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 3px solid ${theme.color.surface};
  border-top-color: ${theme.color.signal};
  animation: ${spin} 700ms linear infinite;
  margin: 40px auto 24px;
`;

const MatchingText = styled.div`
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: ${theme.color.ink};
  font-family: ${theme.font.stack};
  margin-bottom: 8px;
`;

const MatchingSub = styled.div`
  text-align: center;
  font-size: 13px;
  color: ${theme.color.inkSoft};
  font-family: ${theme.font.stack};
  margin-bottom: 40px;
`;

// ─── Instructions screen ──────────────────────────────────────────────────────

const InstructionCard = styled.div`
  background: ${theme.color.ink};
  border-radius: ${theme.radius.card};
  padding: 22px 22px;
  margin-bottom: 20px;
`;

const InstrRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  &:last-child { border-bottom: none; }
`;

const InstrLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.4);
  font-family: ${theme.font.stack};
`;

const InstrValue = styled.span`
  font-size: 15px;
  font-weight: 600;
  color: ${p => p.$highlight ? theme.color.signal : '#fff'};
  font-family: ${theme.font.stack};
  max-width: 55%;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CopyButton = styled.button`
  border: none;
  background: rgba(255,255,255,0.12);
  color: #fff;
  font-size: 11px;
  font-family: ${theme.font.stack};
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 5px;
  cursor: pointer;
  margin-left: 8px;
  flex-shrink: 0;
  letter-spacing: 0.04em;
`;

const CountdownBar = styled.div`
  height: 3px;
  background: ${theme.color.surface};
  border-radius: 2px;
  margin-bottom: 24px;
  overflow: hidden;
`;

const CountdownFill = styled.div`
  height: 100%;
  border-radius: 2px;
  background: ${p => p.$pct > 0.33 ? theme.color.signal : theme.color.danger};
  width: ${p => Math.round(p.$pct * 100)}%;
  transition: width 1s linear, background 0.5s;
`;

const CountdownLabel = styled.div`
  font-size: 12px;
  color: ${theme.color.inkSoft};
  text-align: center;
  margin-bottom: 20px;
  font-family: ${theme.font.stack};
`;

const PrivacyNote = styled.div`
  font-size: 12px;
  color: ${theme.color.inkFaint};
  text-align: center;
  margin-bottom: 24px;
  font-family: ${theme.font.stack};
`;

// ─── Waiting screen ───────────────────────────────────────────────────────────

const WaitingIcon = styled.div`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: ${theme.color.signalWash};
  color: ${theme.color.signalDeep};
  font-size: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 20px auto 20px;
`;

const WaitingTitle = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: ${theme.color.ink};
  text-align: center;
  margin-bottom: 8px;
  font-family: ${theme.font.stack};
`;

const WaitingSub = styled.div`
  font-size: 14px;
  color: ${theme.color.inkSoft};
  text-align: center;
  line-height: 1.6;
  margin-bottom: 24px;
  font-family: ${theme.font.stack};
`;

const OrderIdChip = styled.div`
  background: ${theme.color.surface};
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 12px;
  color: ${theme.color.inkSoft};
  text-align: center;
  word-break: break-all;
  margin-bottom: 28px;
  font-family: ${theme.font.stack};
`;

const CompletedIcon = styled(WaitingIcon)`
  background: ${theme.color.signalWash};
  color: ${theme.color.signalDeep};
  font-size: 32px;
`;

// ─── Shared buttons ───────────────────────────────────────────────────────────

const PrimaryBtn = styled.button`
  width: 100%;
  height: 60px;
  border: none;
  border-radius: ${theme.radius.pill};
  background: ${p => p.$danger ? theme.color.danger : p.$ghost ? 'transparent' : theme.color.ink};
  color: ${p => p.$ghost ? theme.color.inkSoft : theme.color.paper};
  font-size: 17px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};
  &:hover { opacity: 0.9; }
  &:disabled { opacity: 0.4; pointer-events: none; }
  margin-bottom: 10px;
`;

const GhostBtn = styled(PrimaryBtn)`
  height: 44px;
  font-size: 14px;
  background: transparent;
  color: ${theme.color.inkSoft};
  margin-bottom: 0;
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAYMENT_METHOD_LABELS = {
  papara:        'Papara',
  bank_transfer: 'Bank Transfer',
  ininal:        'İninal',
  mefete:        'Mefete',
  qr_havale:     'QR Havale'
};

const EXPIRY_SECS = 30 * 60; // 30 minutes

function fmtSecs(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

const AddFunds = ({ onClose }) => {
  const { wallet, apiBaseUrl } = useXRPL();

  // 4 screens: 'entry' | 'matching' | 'instructions' | 'waiting'
  const [screen, setScreen] = useState('entry');

  // Entry screen state
  const [tryAmount, setTryAmount] = useState('');
  const [method, setMethod] = useState('papara');
  const [rate, setRate] = useState(null);

  // Result from quick-match
  const [matchResult, setMatchResult] = useState(null);

  // Countdown timer for the instructions screen
  const [secsLeft, setSecsLeft] = useState(EXPIRY_SECS);
  const countdownRef = useRef(null);

  // Waiting screen
  const [completed, setCompleted] = useState(false);
  const pollingRef = useRef(null);

  // Fetch live rate on mount
  useEffect(() => {
    if (!apiBaseUrl) return;
    fetch(`${apiBaseUrl}/api/p2p/rate`)
      .then(r => r.json())
      .then(d => { if (d.success && d.rate) setRate(parseFloat(d.rate)); })
      .catch(() => {});
  }, [apiBaseUrl]);

  // Countdown on instructions screen
  useEffect(() => {
    if (screen !== 'instructions') return;
    setSecsLeft(EXPIRY_SECS);
    countdownRef.current = setInterval(() => {
      setSecsLeft(s => {
        if (s <= 1) { clearInterval(countdownRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [screen]);

  // Poll my-orders when waiting for completion
  const pollStatus = useCallback(() => {
    if (!apiBaseUrl || !wallet || !matchResult) return;
    authService.authFetch(`${apiBaseUrl}/api/p2p/my-orders/${wallet.address}?limit=5`)
      .then(r => r.json())
      .then(data => {
        if (!data.success) return;
        const order = (data.orders || []).find(o => o.id === matchResult.orderId || o.order_id === matchResult.orderId);
        if (order && order.status === 'completed') {
          setCompleted(true);
          clearInterval(pollingRef.current);
        }
      })
      .catch(() => {});
  }, [apiBaseUrl, wallet, matchResult]);

  useEffect(() => {
    if (screen !== 'waiting') return;
    pollingRef.current = setInterval(pollStatus, 10000);
    return () => clearInterval(pollingRef.current);
  }, [screen, pollStatus]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleFindSeller = async () => {
    const amt = parseFloat(tryAmount);
    if (!amt || amt <= 0) {
      toast.error('Please enter an amount.');
      return;
    }
    setScreen('matching');
    try {
      const token = authService.getToken ? authService.getToken() : localStorage.getItem('auth_token');
      const res = await fetch(`${apiBaseUrl}/api/p2p/quick-match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ tryAmount: amt, paymentMethod: method })
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.message || 'No sellers available right now.');
        setScreen('entry');
        return;
      }
      setMatchResult(data);
      setScreen('instructions');
    } catch (err) {
      toast.error('Network error. Please try again.');
      setScreen('entry');
    }
  };

  const handleISentIt = async () => {
    if (!matchResult) return;
    try {
      const res = await authService.authFetch(`${apiBaseUrl}/api/p2p/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: matchResult.orderId,
          proofOfPayment: {
            method,
            referenceCode: matchResult.paymentInstructions.referenceCode
          }
        })
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.message || 'Could not confirm payment.');
        return;
      }
      clearInterval(countdownRef.current);
      setScreen('waiting');
    } catch (err) {
      toast.error('Network error. Please try again.');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied!')).catch(() => {});
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const xrpPreview = rate && tryAmount
    ? (parseFloat(tryAmount) / rate).toFixed(4)
    : null;

  return (
    <Overlay onClick={e => { if (e.target === e.currentTarget) onClose(); }} id="add-funds-overlay">
      <Sheet id="add-funds-sheet" onClick={e => e.stopPropagation()}>
        <DragHandle />

        {/* ── ENTRY ── */}
        {screen === 'entry' && (
          <>
            <ScreenTitle>Add funds</ScreenTitle>
            <ScreenSub>Enter how much TRY you want to convert to XRP. We'll find you a seller instantly.</ScreenSub>

            <Label>Amount in ₺</Label>
            <AmountWrap>
              <CurrencyBadge>₺</CurrencyBadge>
              <AmountInput
                id="add-funds-try-amount"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={tryAmount}
                onChange={e => setTryAmount(e.target.value)}
                autoFocus
              />
            </AmountWrap>
            {xrpPreview && (
              <XrpPreview>≈ {xrpPreview} XRP at current rate</XrpPreview>
            )}

            <Label>Payment method</Label>
            <MethodSelect
              id="add-funds-method"
              value={method}
              onChange={e => setMethod(e.target.value)}
            >
              {Object.entries(PAYMENT_METHOD_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </MethodSelect>

            <PrimaryBtn
              id="add-funds-find-seller"
              onClick={handleFindSeller}
              disabled={!tryAmount || parseFloat(tryAmount) <= 0 || !wallet}
            >
              Find a seller
            </PrimaryBtn>
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          </>
        )}

        {/* ── MATCHING ── */}
        {screen === 'matching' && (
          <>
            <SpinnerRing />
            <MatchingText>Finding best seller…</MatchingText>
            <MatchingSub>Matching you with a seller at the best rate. This takes a second.</MatchingSub>
          </>
        )}

        {/* ── INSTRUCTIONS ── */}
        {screen === 'instructions' && matchResult && (
          <>
            <ScreenTitle>Send the transfer</ScreenTitle>
            <ScreenSub>
              Send exactly this amount via {PAYMENT_METHOD_LABELS[method] || method}.
              Include the reference code in the transfer description.
            </ScreenSub>

            <InstructionCard id="add-funds-instructions-card">
              {matchResult.paymentInstructions.paparaNumber && (
                <InstrRow>
                  <InstrLabel>Papara no</InstrLabel>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <InstrValue>{matchResult.paymentInstructions.paparaNumber}</InstrValue>
                    <CopyButton onClick={() => copyToClipboard(matchResult.paymentInstructions.paparaNumber)}>COPY</CopyButton>
                  </div>
                </InstrRow>
              )}
              <InstrRow>
                <InstrLabel>Amount</InstrLabel>
                <InstrValue $highlight>
                  ₺{matchResult.paymentInstructions.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </InstrValue>
              </InstrRow>
              <InstrRow>
                <InstrLabel>Reference</InstrLabel>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <InstrValue $highlight>{matchResult.paymentInstructions.referenceCode}</InstrValue>
                  <CopyButton onClick={() => copyToClipboard(matchResult.paymentInstructions.referenceCode)}>COPY</CopyButton>
                </div>
              </InstrRow>
              <InstrRow>
                <InstrLabel>Description</InstrLabel>
                <InstrValue>{matchResult.paymentInstructions.description}</InstrValue>
              </InstrRow>
              <InstrRow>
                <InstrLabel>You receive</InstrLabel>
                <InstrValue $highlight>{matchResult.xrpAmount} XRP</InstrValue>
              </InstrRow>
            </InstructionCard>

            <CountdownBar>
              <CountdownFill $pct={secsLeft / EXPIRY_SECS} />
            </CountdownBar>
            <CountdownLabel>
              {secsLeft > 0
                ? `Complete within ${fmtSecs(secsLeft)}`
                : 'Time limit reached — the order may be cancelled'}
            </CountdownLabel>

            <PrivacyNote>
              The seller confirms receipt and releases XRP automatically via escrow.
            </PrivacyNote>

            <PrimaryBtn id="add-funds-i-sent-it" onClick={handleISentIt}>
              I've sent the transfer
            </PrimaryBtn>
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          </>
        )}

        {/* ── WAITING ── */}
        {screen === 'waiting' && (
          <>
            {completed ? (
              <>
                <CompletedIcon>✓</CompletedIcon>
                <WaitingTitle>XRP is on its way!</WaitingTitle>
                <WaitingSub>
                  The seller confirmed your payment. XRP will arrive in your wallet within seconds.
                </WaitingSub>
                <PrimaryBtn onClick={onClose}>Done</PrimaryBtn>
              </>
            ) : (
              <>
                <WaitingIcon>⏳</WaitingIcon>
                <WaitingTitle>Waiting for seller</WaitingTitle>
                <WaitingSub>
                  Your TRY payment was reported. The seller will verify and release your XRP.
                  This usually takes 1–3 minutes.
                </WaitingSub>
                {matchResult && (
                  <OrderIdChip>Order ID: {matchResult.orderId}</OrderIdChip>
                )}
                <GhostBtn onClick={onClose}>Close (your order stays active)</GhostBtn>
              </>
            )}
          </>
        )}
      </Sheet>
    </Overlay>
  );
};

export default AddFunds;
