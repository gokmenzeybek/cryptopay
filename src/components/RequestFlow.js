import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled from 'styled-components';
import QRCodeLib from 'qrcode';
import { toast } from 'react-toastify';
import { useXRPL } from '../hooks/useXRPL';
import authService from '../services/authService';
import theme from '../theme';

/**
 * RequestFlow — request money via a shareable link + QR (M2, PRODUCT_PLAN
 * §9.3 / UI_DESIGN §5.4). The link (/pay?to=&amount=&req=) is the single
 * artifact for both remote sharing and in-person scans. The private note
 * lives server-side only — it is never encoded in the QR and never goes
 * on-chain.
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

const AmountRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
`;

const AmountInput = styled.input`
  width: 220px;
  border: none;
  background: transparent;
  font-size: 48px;
  font-weight: 700;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  text-align: right;
  outline: none;
  &::placeholder { color: ${theme.color.line}; }
`;

const UnitText = styled.span`
  font-size: 24px;
  font-weight: 600;
  color: ${theme.color.inkSoft};
`;

const NotePill = styled.button`
  display: block;
  margin: 16px auto 0;
  border: none;
  border-radius: 17px;
  background: ${theme.color.surface};
  color: ${theme.color.inkSoft};
  font-size: 13px;
  font-family: ${theme.font.stack};
  padding: 9px 16px;
  cursor: pointer;
`;

const NoteInput = styled.input`
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 16px auto 0;
  height: 52px;
  border: none;
  border-radius: ${theme.radius.input};
  background: ${theme.color.surface};
  padding: 0 16px;
  font-size: 15px;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  outline: none;
  text-align: center;
`;

const NoteHint = styled.div`
  text-align: center;
  font-size: 12px;
  color: ${theme.color.inkFaint};
  margin-top: 6px;
`;

const CreateButton = styled.button`
  width: 100%;
  height: 60px;
  margin-top: 32px;
  border: none;
  border-radius: ${theme.radius.pill};
  background: ${theme.color.ink};
  color: ${theme.color.paper};
  font-size: 16px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};
  &:hover:not(:disabled) { opacity: 0.88; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const QRCard = styled.div`
  background: ${theme.color.ink};
  border-radius: ${theme.radius.sheet};
  padding: 32px 24px 24px;
  margin-top: 32px;
  text-align: center;
`;

const QRFrame = styled.div`
  background: ${theme.color.paper};
  border-radius: 12px;
  padding: 16px;
  display: inline-block;
`;

const QRTitle = styled.div`
  color: ${theme.color.paper};
  font-size: 16px;
  font-weight: 600;
  margin-top: 20px;
`;

const QRLink = styled.div`
  color: ${theme.color.inkFaint};
  font-size: 12px;
  margin-top: 6px;
  word-break: break-all;
`;

const QRMeta = styled.div`
  color: ${theme.color.inkSoft};
  font-size: 12px;
  margin-top: 6px;
`;

const ShareRow = styled.div`
  display: flex;
  gap: 14px;
  margin-top: 24px;
`;

const ShareButton = styled.button`
  flex: 1;
  height: 56px;
  border: none;
  border-radius: 28px;
  font-size: 15px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  ${p => p.$primary
    ? `background: ${theme.color.signal}; color: #06281A;`
    : `background: ${theme.color.surface}; color: ${theme.color.ink};`}
`;

const RequestRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 4px;
  font-size: 14px;
  color: ${theme.color.ink};
`;

const StatusChip = styled.span`
  font-size: 13px;
  color: ${p => p.$paid ? theme.color.signalDeep : theme.color.inkSoft};
`;

const truncateLink = (link) => link.length > 44 ? `${link.slice(0, 40)}…` : link;

const RequestFlow = () => {
  const { wallet, apiBaseUrl } = useXRPL();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState(null);
  const [requests, setRequests] = useState([]);
  const qrCanvasRef = useRef(null);

  const canCreate = wallet && parseFloat(amount) > 0;

  const fetchMyRequests = useCallback(() => {
    if (!apiBaseUrl || !wallet) return;
    fetch(`${apiBaseUrl}/api/payment_requests?limit=50`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setRequests((data.paymentRequests || [])
            .filter(pr => pr.to_address === wallet.address)
            .slice(0, 10));
        }
      })
      .catch(() => {});
  }, [apiBaseUrl, wallet]);

  useEffect(() => { fetchMyRequests(); }, [fetchMyRequests]);

  // Render the QR once a link exists (encodes the payment LINK, never the note)
  useEffect(() => {
    if (link && qrCanvasRef.current) {
      QRCodeLib.toCanvas(qrCanvasRef.current, link, {
        width: 200,
        margin: 0,
        color: { dark: '#141414', light: '#FAFAF7' }
      }).catch(() => {});
    }
  }, [link]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const response = await authService.authFetch(`${apiBaseUrl}/api/payment_requests`, {
        method: 'POST',
        body: JSON.stringify({
          amount: parseFloat(amount),
          recipientAddress: wallet.address,
          memo: note || undefined
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || data.error || 'Could not create the request');
      }

      const requestId = data.paymentRequest.request_id;
      const paymentLink = `${window.location.origin}/pay?to=${wallet.address}&amount=${parseFloat(amount)}&req=${requestId}`;
      setLink(paymentLink);
      fetchMyRequests();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch (_) {
      toast.error('Could not copy the link');
    }
  };

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Payment request', text: `Send me ${parseFloat(amount)} XRP`, url: link });
        return;
      } catch (_) { /* user cancelled or unsupported — fall back to copy */ }
    }
    copyLink();
  };

  if (!wallet) {
    return (
      <Wrap>
        <Label>Request</Label>
        <NoteHint style={{ fontSize: 14 }}>Create or unlock your wallet to request money.</NoteHint>
      </Wrap>
    );
  }

  return (
    <Wrap>
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
        <UnitText>XRP</UnitText>
      </AmountRow>

      {showNote ? (
        <>
          <NoteInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What's it for? (e.g. dinner)"
            maxLength={140}
          />
          <NoteHint>Private — visible in the app only, never on the blockchain.</NoteHint>
        </>
      ) : (
        <NotePill onClick={() => setShowNote(true)}>+ private note</NotePill>
      )}

      <CreateButton disabled={!canCreate || creating} onClick={handleCreate}>
        {creating ? 'Creating…' : 'Create request link'}
      </CreateButton>

      {link && (
        <QRCard>
          <QRFrame>
            <canvas ref={qrCanvasRef} />
          </QRFrame>
          <QRTitle>Scan to pay me {parseFloat(amount)} XRP</QRTitle>
          <QRLink>{truncateLink(link)}</QRLink>
          <QRMeta>Expires in 30 days · note stays off-chain</QRMeta>
          <ShareRow>
            <ShareButton $primary onClick={shareLink}>Share link</ShareButton>
            <ShareButton onClick={copyLink}>Copy</ShareButton>
          </ShareRow>
        </QRCard>
      )}

      {requests.length > 0 && (
        <>
          <Label>Open requests</Label>
          {requests.map((pr) => (
            <RequestRow key={pr.request_id}>
              <span>
                {parseFloat(pr.amount_xrp)} XRP{pr.memo ? ` · “${pr.memo}”` : ''}
              </span>
              <StatusChip $paid={pr.status === 'paid'}>
                {pr.status === 'paid' ? 'paid ✓' : pr.status}
              </StatusChip>
            </RequestRow>
          ))}
        </>
      )}
    </Wrap>
  );
};

export default RequestFlow;
