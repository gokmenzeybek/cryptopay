import React, { useState, useRef } from 'react';
import styled from 'styled-components';
import { toast } from 'react-toastify';
import { useXRPL } from '../hooks/useXRPL';
import authService from '../services/authService';
import theme from '../theme';

/**
 * ConfirmSheet — the single payment confirmation surface (M1, PRODUCT_PLAN
 * §9.4 / UI_DESIGN §5.3). Three entrances (Send flow, scan, payment link)
 * converge here: receipt-style detail rows, slide-to-confirm, and a success
 * state on the same screen. Settlement goes through useXRPL.sendPayment —
 * no new transaction code.
 */
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 20, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1500;
  @media (min-width: 640px) { align-items: center; }
`;

const Sheet = styled.div`
  background: ${theme.color.paper};
  width: 100%;
  max-width: 420px;
  border-radius: ${theme.radius.sheet} ${theme.radius.sheet} 0 0;
  padding: 32px 24px 40px;
  text-align: center;
  @media (min-width: 640px) { border-radius: ${theme.radius.sheet}; }
`;

const HeroAmount = styled.div`
  font-size: 52px;
  font-weight: 700;
  color: ${theme.color.ink};
  letter-spacing: -0.02em;
  margin-top: 8px;
`;

const FiatLine = styled.div`
  font-size: 15px;
  color: ${theme.color.inkSoft};
  margin-top: 4px;
`;

const DetailCard = styled.div`
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  padding: 20px 24px;
  margin: 28px 0 16px;
  text-align: left;
`;

const DetailRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid ${theme.color.line};
  &:last-child { border-bottom: none; }
  font-size: 13px;
`;

const DetailLabel = styled.span`color: ${theme.color.inkSoft};`;
const DetailValue = styled.span`
  color: ${theme.color.ink};
  font-weight: 600;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PrivacyLine = styled.p`
  font-size: 12px;
  color: ${theme.color.inkFaint};
  margin: 0 0 20px;
`;

const SlideTrack = styled.div`
  position: relative;
  height: 64px;
  border-radius: 32px;
  background: ${theme.color.ink};
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  user-select: none;
  touch-action: none;
  ${p => p.$disabled && 'opacity: 0.5; pointer-events: none;'}
`;

const SlideKnob = styled.div`
  position: absolute;
  left: ${p => p.$x}px;
  top: 8px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: ${theme.color.signal};
  color: #06281A;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: grab;
  transition: ${p => p.$dragging ? 'none' : `left ${theme.motion.med}`};
`;

const SlideLabel = styled.span`
  color: ${theme.color.inkFaint};
  font-size: 15px;
  font-weight: 600;
`;

const SuccessBox = styled.div`
  background: ${theme.color.signalWash};
  border-radius: ${theme.radius.card};
  padding: 32px 24px;
  margin-top: 24px;
`;

const SuccessCheck = styled.div`
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: ${theme.color.signal};
  color: #06281A;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
`;

const SuccessTitle = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: ${theme.color.ink};
`;

const DetailsToggle = styled.button`
  background: none;
  border: none;
  color: ${theme.color.inkSoft};
  font-size: 12px;
  margin-top: 12px;
  cursor: pointer;
`;

const HashText = styled.div`
  font-family: monospace;
  font-size: 11px;
  color: ${theme.color.inkSoft};
  word-break: break-all;
  margin-top: 8px;
  text-align: left;
`;

const CloseButton = styled.button`
  width: 100%;
  height: 56px;
  border: none;
  border-radius: ${theme.radius.pill};
  background: ${theme.color.surface};
  color: ${theme.color.ink};
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 16px;
`;

const truncate = (addr) => addr && addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-3)}` : addr;

const ConfirmSheet = ({ recipient, amountXrp, memo, requestId, requestNote, tryRate, onClose, onDone }) => {
  const { sendPayment, apiBaseUrl, wallet } = useXRPL();
  const [phase, setPhase] = useState('confirm'); // confirm | sending | success | error
  const [result, setResult] = useState(null);
  const [elapsed, setElapsed] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [knobX, setKnobX] = useState(8);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef(null);
  const dragState = useRef({ startX: 0, knobStart: 8 });

  const fiatLine = tryRate
    ? `≈ ₺${(parseFloat(amountXrp) * tryRate).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

  const execute = async () => {
    if (!wallet) {
      toast.error('Unlock your wallet first');
      return;
    }
    setPhase('sending');
    const started = Date.now();
    try {
      const payment = await sendPayment(recipient, parseFloat(amountXrp), memo || undefined);
      setElapsed(((Date.now() - started) / 1000).toFixed(1));
      setResult(payment);
      setPhase('success');

      // Mark the payment request paid when this send answered one (M2 link;
      // harmless no-op when requestId is absent).
      if (requestId && apiBaseUrl) {
        try {
          await authService.authFetch(`${apiBaseUrl}/api/payment_requests/${requestId}/paid`, {
            method: 'PATCH',
            body: JSON.stringify({ txHash: payment.hash })
          });
        } catch (err) {
          console.warn('Could not mark payment request paid:', err.message);
        }
      }
      if (onDone) onDone(payment);
    } catch (err) {
      toast.error(err.message);
      setPhase('error');
    }
  };

  // Slide-to-confirm (pointer events; keyboard/a11y via button fallback below)
  const onPointerDown = (e) => {
    dragState.current = { startX: e.clientX, knobStart: knobX };
    setDragging(true);
    e.target.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging || !trackRef.current) return;
    const max = trackRef.current.clientWidth - 56 - 8;
    const next = Math.min(Math.max(dragState.current.knobStart + (e.clientX - dragState.current.startX), 8), max);
    setKnobX(next);
    if (next >= max) {
      setDragging(false);
      setKnobX(8);
      execute();
    }
  };
  const onPointerUp = () => {
    if (dragging) {
      setDragging(false);
      setKnobX(8);
    }
  };

  return (
    <Overlay onClick={phase === 'success' ? onClose : undefined}>
      <Sheet onClick={(e) => e.stopPropagation()}>
        <HeroAmount>{parseFloat(amountXrp)} XRP</HeroAmount>
        {fiatLine && <FiatLine>{fiatLine}</FiatLine>}

        <DetailCard>
          <DetailRow>
            <DetailLabel>To</DetailLabel>
            <DetailValue title={recipient}>{truncate(recipient)}</DetailValue>
          </DetailRow>
          <DetailRow>
            <DetailLabel>Network fee</DetailLabel>
            <DetailValue>0.00001 XRP</DetailValue>
          </DetailRow>
          <DetailRow>
            <DetailLabel>Settlement</DetailLabel>
            <DetailValue>~4 seconds</DetailValue>
          </DetailRow>
          {memo && (
            <DetailRow>
              <DetailLabel>Note</DetailLabel>
              <DetailValue>{memo}</DetailValue>
            </DetailRow>
          )}
          {requestNote && (
            <DetailRow>
              <DetailLabel>Request</DetailLabel>
              <DetailValue>“{requestNote}”</DetailValue>
            </DetailRow>
          )}
        </DetailCard>

        {phase === 'confirm' && (
          <>
            <PrivacyLine>Signed on this device. Your keys never leave it.</PrivacyLine>
            <SlideTrack ref={trackRef}>
              <SlideKnob
                $x={knobX}
                $dragging={dragging}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >→</SlideKnob>
              <SlideLabel>slide to send</SlideLabel>
            </SlideTrack>
            {/* Keyboard / screen-reader equivalent of the slide gesture */}
            <CloseButton onClick={execute} aria-label="Confirm and send payment">
              Confirm and send
            </CloseButton>
          </>
        )}

        {phase === 'sending' && (
          <>
            <PrivacyLine>Signing and submitting…</PrivacyLine>
            <SlideTrack $disabled>
              <SlideLabel>Sending…</SlideLabel>
            </SlideTrack>
          </>
        )}

        {phase === 'error' && (
          <>
            <PrivacyLine>Payment didn't go through — nothing was sent.</PrivacyLine>
            <CloseButton onClick={() => setPhase('confirm')}>Try again</CloseButton>
            <CloseButton onClick={onClose}>Cancel</CloseButton>
          </>
        )}

        {phase === 'success' && (
          <SuccessBox>
            <SuccessCheck>✓</SuccessCheck>
            <SuccessTitle>Sent{elapsed ? ` in ${elapsed}s` : ''}</SuccessTitle>
            <DetailsToggle onClick={() => setShowDetails(v => !v)}>
              Technical details {showDetails ? '⌃' : '⌄'}
            </DetailsToggle>
            {showDetails && result?.hash && <HashText>{result.hash}</HashText>}
            <CloseButton onClick={onClose}>Done</CloseButton>
          </SuccessBox>
        )}
      </Sheet>
    </Overlay>
  );
};

export default ConfirmSheet;
