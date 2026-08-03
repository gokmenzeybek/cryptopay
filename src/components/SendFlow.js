import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { Scanner } from '@yudiel/react-qr-scanner';
import { useXRPL } from '../hooks/useXRPL';
import ConfirmSheet from './ConfirmSheet';
import AddFunds from './AddFunds';
import { CameraIcon } from './icons';
import theme from '../theme';

/**
 * SendFlow — the daily-driver send experience (M1, PRODUCT_PLAN §9.2 /
 * UI_DESIGN §5.2). One vertical thought: who → how much → (note) → review.
 * Lands pre-filled from payment links via ?to=&amount=&memo=&req=.
 * Settlement is delegated to the shared ConfirmSheet.
 */
const Wrap = styled.div`
  max-width: 420px;
  margin: 0 auto;
  font-family: ${theme.font.stack};
`;

const Label = styled.div`
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${theme.color.inkSoft};
  margin: 32px 0 10px;
`;

const RecipientRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  background: ${theme.color.surface};
  border-radius: ${theme.radius.input};
  padding: 0 12px 0 18px;
  height: 60px;
`;

const RecipientInput = styled.input`
  flex: 1;
  border: none;
  background: transparent;
  font-size: 15px;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  outline: none;
`;

const ScanButton = styled.button`
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 8px;
  display: flex;
  align-items: center;
  color: ${theme.color.inkSoft};
  &:hover { color: ${theme.color.ink}; }
`;

const ValidationLine = styled.div`
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 8px;
  font-size: 12px;
  ${p => p.$ok
    ? `background: ${theme.color.signalWash}; color: ${theme.color.signalDeep};`
    : `background: ${theme.color.dangerWash}; color: ${theme.color.danger};`}
`;

const AmountRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
`;

const AmountInput = styled.input`
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: 56px;
  font-weight: 700;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  letter-spacing: -0.02em;
  outline: none;
  &::placeholder { color: ${theme.color.line}; }
`;

const UnitToggle = styled.div`
  display: flex;
  background: ${theme.color.surface};
  border-radius: 20px;
  padding: 4px;
  flex-shrink: 0;
`;

const UnitOption = styled.button`
  border: none;
  border-radius: 16px;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  ${p => p.$active
    ? `background: ${theme.color.paper}; color: ${theme.color.ink};`
    : `background: transparent; color: ${theme.color.inkSoft};`}
`;

const ConversionLine = styled.div`
  font-size: 15px;
  color: ${theme.color.inkSoft};
  margin-top: 8px;
`;

const NoteToggle = styled.button`
  width: 100%;
  margin-top: 28px;
  padding: 16px;
  border: 1.5px dashed ${theme.color.line};
  border-radius: ${theme.radius.input};
  background: transparent;
  color: ${theme.color.inkSoft};
  font-size: 14px;
  font-family: ${theme.font.stack};
  cursor: pointer;
  text-align: center;
`;

const NoteInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  margin-top: 12px;
  height: 52px;
  border: none;
  border-radius: ${theme.radius.input};
  background: ${theme.color.surface};
  padding: 0 16px;
  font-size: 15px;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  outline: none;
`;

const ReviewButton = styled.button`
  width: 100%;
  height: 64px;
  margin-top: 40px;
  border: none;
  border-radius: ${theme.radius.pill};
  background: ${theme.color.ink};
  color: ${theme.color.paper};
  font-size: 17px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};
  &:hover:not(:disabled) { opacity: 0.88; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const AddFundsButton = styled.button`
  width: 100%;
  height: 56px;
  margin-top: 12px;
  border: 1.5px solid ${theme.color.line};
  border-radius: ${theme.radius.pill};
  background: transparent;
  color: ${theme.color.ink};
  font-size: 15px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  &:hover { border-color: ${theme.color.ink}; }
`;

const ScanSheet = styled.div`
  margin-top: 12px;
  border-radius: ${theme.radius.card};
  overflow: hidden;
  background: ${theme.color.ink};
`;

const isValidAddress = (addr) =>
  Boolean(window.xrpl && addr && window.xrpl.isValidClassicAddress(addr));

// Extract a recipient/amount from a scanned payload: payment link or bare address.
const parsePayload = (text) => {
  if (!text) return {};
  try {
    const url = new URL(text, window.location.origin);
    if (url.searchParams.get('to')) {
      return {
        to: url.searchParams.get('to'),
        amount: url.searchParams.get('amount') || undefined,
        memo: url.searchParams.get('memo') || undefined,
        req: url.searchParams.get('req') || undefined
      };
    }
  } catch (_) { /* not a URL — fall through */ }
  return { to: text.trim() };
};

const SendFlow = () => {
  const { apiBaseUrl, wallet, createBurnerWallet } = useXRPL();
  const [searchParams] = useSearchParams();

  const [recipient, setRecipient] = useState(searchParams.get('to') || '');
  const [amount, setAmount] = useState(searchParams.get('amount') || '');
  const [unit, setUnit] = useState('XRP');
  const [memo, setMemo] = useState(searchParams.get('memo') || '');
  const [showNote, setShowNote] = useState(Boolean(searchParams.get('memo')));
  const [requestId] = useState(searchParams.get('req') || null);
  const [requestNote, setRequestNote] = useState(null);
  const [rate, setRate] = useState(null);
  const [scanning, setScanning] = useState(searchParams.get('scan') === '1');
  const [confirming, setConfirming] = useState(false);
  // Guest payer bootstrap: auto-create a temporary burner wallet on a pay link
  // and surface the Papara on-ramp. bootingWallet guards the one-shot effect.
  const [bootedWallet, setBootedWallet] = useState(false);
  const [bootingWallet, setBootingWallet] = useState(false);
  const [walletBootFailed, setWalletBootFailed] = useState(false);
  const [showAddFunds, setShowAddFunds] = useState(false);
  const bootingRef = useRef(false);

  // Live XRP/TRY rate for the fiat toggle (public endpoint)
  useEffect(() => {
    if (!apiBaseUrl) return;
    fetch(`${apiBaseUrl}/api/p2p/rate`)
      .then(r => r.json())
      .then(data => { if (data.success && data.rate) setRate(parseFloat(data.rate)); })
      .catch(() => { /* rate is a display convenience — absence is non-fatal */ });
  }, [apiBaseUrl]);

  // Resolve a payment-request link (M2): shows the requester's private note
  // and status to the sender — in-app only, never on-chain.
  useEffect(() => {
    if (!apiBaseUrl || !requestId) return;
    fetch(`${apiBaseUrl}/api/payment_requests/${requestId}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.paymentRequest) {
          const pr = data.paymentRequest;
          if (pr.memo) setRequestNote(pr.memo);
          if (pr.status === 'paid') {
            // The link was already fulfilled — tell the sender before they pay twice.
            setRequestNote(prev => (prev ? `${prev} (already paid)` : 'This request is already paid'));
          }
        }
      })
      .catch(() => {});
  }, [apiBaseUrl, requestId]);

  // Guest payer bootstrap (M4 on-ramp): a user who opens a pay link or scans
  // a payment QR without a wallet gets a temporary burner wallet created for
  // them automatically, then the Papara buy sheet opens pre-filled to cover
  // the requested amount. No wall, no detour to Home. Manual /pay visits with
  // no target (recipient empty) keep the normal create/unlock path.
  useEffect(() => {
    if (wallet || !apiBaseUrl || !recipient || bootingRef.current || bootedWallet) return;
    bootingRef.current = true;
    setBootingWallet(true);
    createBurnerWallet()
      .then(() => {
        setBootedWallet(true);
        setShowAddFunds(true);
      })
      .catch(() => {
        setWalletBootFailed(true);
      })
      .finally(() => {
        bootingRef.current = false;
        setBootingWallet(false);
      });
  }, [wallet, apiBaseUrl, recipient, bootedWallet, createBurnerWallet]);

  const addressValid = isValidAddress(recipient);
  const showValidation = recipient.length > 0;

  // Amount math in XRP (the settlement unit)
  const amountXrp = unit === 'XRP'
    ? parseFloat(amount) || 0
    : (rate ? (parseFloat(amount) || 0) / rate : 0);
  // Pre-fill the Papara buy sheet with ~the request amount in TRY so a guest
  // payer buys roughly what they need. Editable inside the sheet.
  const presetTry = (rate && amountXrp > 0) ? (amountXrp * rate).toFixed(0) : '';
  const conversionLine = rate && amount
    ? unit === 'XRP'
      ? `≈ ₺${((parseFloat(amount) || 0) * rate).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · 1 XRP = ₺${rate.toFixed(2)}`
      : `≈ ${amountXrp.toFixed(6)} XRP · 1 XRP = ₺${rate.toFixed(2)}`
    : null;

  const canReview = addressValid && amountXrp > 0 && wallet;

  const onScan = useCallback((results) => {
    const text = results && results[0] && results[0].rawValue;
    if (!text) return;
    const parsed = parsePayload(text);
    if (parsed.to) setRecipient(parsed.to);
    if (parsed.amount) setAmount(parsed.amount);
    if (parsed.memo) { setMemo(parsed.memo); setShowNote(true); }
    setScanning(false);
  }, []);

  return (
    <Wrap>
      <Label>To</Label>
      <RecipientRow>
        <RecipientInput
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          placeholder="Recipient address (r…)"
          autoComplete="off"
        />
        <ScanButton onClick={() => setScanning(v => !v)} aria-label="Scan a QR code">
          <CameraIcon width={20} height={20} />
        </ScanButton>
      </RecipientRow>
      {showValidation && (
        <ValidationLine $ok={addressValid}>
          {addressValid
            ? '✓ Valid address — double-check the first and last characters'
            : 'Not a valid XRPL address'}
        </ValidationLine>
      )}
      {scanning && (
        <ScanSheet>
          <Scanner onScan={onScan} onError={(err) => console.error('Scan error:', err)} />
        </ScanSheet>
      )}

      <Label>Amount</Label>
      <AmountRow>
        <AmountInput
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />
        <UnitToggle>
          <UnitOption $active={unit === 'XRP'} onClick={() => setUnit('XRP')}>XRP</UnitOption>
          <UnitOption $active={unit === 'TRY'} onClick={() => setUnit('TRY')}>₺ TRY</UnitOption>
        </UnitToggle>
      </AmountRow>
      {conversionLine && <ConversionLine>{conversionLine}</ConversionLine>}

      {showNote ? (
        <>
          <NoteInput
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Note — public on the ledger"
            maxLength={140}
          />
        </>
      ) : (
        <NoteToggle onClick={() => setShowNote(true)}>
          + Add a note (public on the ledger)
        </NoteToggle>
      )}

      {!wallet && bootingWallet && (
        <ValidationLine>Preparing your temporary wallet…</ValidationLine>
      )}
      {!wallet && !bootingWallet && (
        <ValidationLine>
          {walletBootFailed
            ? 'Could not create a temporary wallet — create or unlock one first'
            : 'Create or unlock your wallet before sending'}
        </ValidationLine>
      )}

      <ReviewButton disabled={!canReview} onClick={() => setConfirming(true)}>
        Review payment
      </ReviewButton>

      <AddFundsButton onClick={() => setShowAddFunds(true)}>
        Add funds via Papara
      </AddFundsButton>

      {showAddFunds && (
        <AddFunds
          presetTry={presetTry}
          onClose={() => setShowAddFunds(false)}
        />
      )}

      {confirming && (
        <ConfirmSheet
          recipient={recipient}
          amountXrp={amountXrp}
          memo={memo || undefined}
          requestId={requestId}
          requestNote={requestNote}
          tryRate={rate}
          onClose={() => setConfirming(false)}
        />
      )}
    </Wrap>
  );
};

export default SendFlow;
