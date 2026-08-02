import React, { useState } from 'react';
import styled from 'styled-components';
import { notice } from '../services/notice';
import PaymentConfirmation from './PaymentConfirmation';
import XRPConfirmation from './XRPConfirmation';
import DisputeResolution from './DisputeResolution';
import ConfirmDialog from './ConfirmDialog';
import InlineNotice from './InlineNotice';
import { useXRPL } from '../hooks/useXRPL';
import authService from '../services/authService';
import theme from '../theme';

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 20, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1500;
  @media (min-width: 640px) { align-items: center; }
`;

const ModalContent = styled.div`
  background: ${theme.color.paper};
  width: 100%;
  max-width: 420px;
  border-radius: ${theme.radius.sheet} ${theme.radius.sheet} 0 0;
  max-height: 90vh;
  overflow-y: auto;
  @media (min-width: 640px) { border-radius: ${theme.radius.sheet}; }
`;

const ModalHeader = styled.div`
  padding: 20px 24px;
  border-bottom: 1px solid ${theme.color.line};
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ModalTitle = styled.h3`
  margin: 0;
  color: ${theme.color.ink};
  font-family: ${theme.font.stack};
  font-size: 18px;
  font-weight: 700;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: ${theme.color.inkSoft};
  &:hover { color: ${theme.color.ink}; }
`;

const ModalBody = styled.div`
  padding: 24px;
`;

const OrderInfo = styled.div`
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  padding: 20px;
  margin-bottom: 20px;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid ${theme.color.line};
  &:last-child { border-bottom: none; }
  font-size: 14px;
`;

const InfoLabel = styled.span`
  font-weight: 600;
  color: ${theme.color.inkSoft};
`;

const InfoValue = styled.span`
  color: ${theme.color.ink};
  font-weight: 600;
`;

const StatusBadge = styled.span`
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  background: ${props => {
    switch (props.status) {
      case 'open': return theme.color.surface;
      case 'matched': return '#FFF8E1';
      case 'payment_confirmed': return theme.color.signalWash;
      case 'completed': return theme.color.signalWash;
      case 'cancelled': return theme.color.dangerWash;
      case 'disputed': return theme.color.dangerWash;
      case 'expired': return theme.color.surface;
      default: return theme.color.surface;
    }
  }};
  color: ${props => {
    switch (props.status) {
      case 'open': return theme.color.inkSoft;
      case 'matched': return '#856404';
      case 'payment_confirmed': return theme.color.signalDeep;
      case 'completed': return theme.color.signalDeep;
      case 'cancelled': return theme.color.danger;
      case 'disputed': return theme.color.danger;
      case 'expired': return theme.color.inkFaint;
      default: return theme.color.inkSoft;
    }
  }};
`;

const TypeBadge = styled.span`
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  background: ${props => props.type === 'buy' ? theme.color.signalWash : theme.color.dangerWash};
  color: ${props => props.type === 'buy' ? theme.color.signalDeep : theme.color.danger};
`;

const ActionSection = styled.div`
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid ${theme.color.line};
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

const ActionButton = styled.button`
  padding: 12px 20px;
  border: none;
  border-radius: ${theme.radius.pill};
  font-size: 14px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};
  flex: 1;
  min-width: 140px;

  &:hover { opacity: 0.88; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const PrimaryBtn = styled(ActionButton)`
  background: ${theme.color.ink};
  color: ${theme.color.paper};
`;

const SuccessBtn = styled(ActionButton)`
  background: ${theme.color.signal};
  color: #06281A;
`;

const WarningBtn = styled(ActionButton)`
  background: ${theme.color.surface};
  color: ${theme.color.ink};
`;

const DangerBtn = styled(ActionButton)`
  background: ${theme.color.danger};
  color: white;
`;

const PaymentMethodsList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 5px;
`;

const PaymentMethodTag = styled.span`
  padding: 4px 8px;
  background: ${theme.color.surface};
  border-radius: 4px;
  font-size: 0.8rem;
  color: ${theme.color.inkSoft};
`;

const AddressDisplay = styled.div`
  font-family: monospace;
  font-size: 0.85rem;
  color: ${theme.color.inkSoft};
  word-break: break-all;
`;

const TimestampDisplay = styled.div`
  font-size: 0.85rem;
  color: ${theme.color.inkSoft};
`;

const OrderDetails = ({
  order,
  onClose,
  onPaymentConfirmed,
  onXRPConfirmed,
  onDisputeRaised,
  onCancelled,
  onEscrowLocked,
  userAddress
}) => {
  const { apiBaseUrl, client, wallet, isConnected, waitForValidation } = useXRPL();
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);
  const [showXRPConfirmation, setShowXRPConfirmation] = useState(false);
  const [showDisputeResolution, setShowDisputeResolution] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [lockingEscrow, setLockingEscrow] = useState(false);

  if (!order) return null;

  const formatPaymentMethods = (methods) => {
    if (!methods || !Array.isArray(methods)) return [];
    return methods.map(method => {
      const methodNames = {
        'bank_transfer': 'Bank Transfer',
        'papara': 'Papara',
        'ininal': 'İninal',
        'mefete': 'Mefete',
        'qr_havale': 'QR Havale'
      };
      return methodNames[method] || method;
    });
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  };

  const canConfirmPayment = () => {
    return order.status === 'matched' && order.type === 'buy';
  };

  const canConfirmXRP = () => {
    return order.status === 'payment_confirmed' && order.type === 'sell';
  };

  const canCancelOrder = () => {
    return order.status === 'open' || order.status === 'matched';
  };

  const canLockEscrow = () => {
    return order.status === 'matched'
      && order.type === 'sell'
      && !['locked', 'finish_pending', 'finished'].includes(order.escrowStatus);
  };

  const canRaiseDispute = () => {
    return ['matched', 'payment_confirmed'].includes(order.status);
  };

  const handlePaymentConfirmed = (orderId) => {
    setShowPaymentConfirmation(false);
    onPaymentConfirmed(orderId);
  };

  const handleXRPConfirmed = (orderId) => {
    setShowXRPConfirmation(false);
    onXRPConfirmed(orderId);
  };

  const handleDisputeRaised = (orderId) => {
    setShowDisputeResolution(false);
    onDisputeRaised(orderId);
  };

  const handleCancelOrder = async (reason) => {
    setCancelling(true);
    try {
      const response = await authService.authFetch(`${apiBaseUrl}/api/p2p/cancel`, {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id, reason: reason || 'User cancelled' })
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to cancel the order');
      }

      notice.success('Order cancelled');
      if (data.escrow) {
        notice.info(`Escrow status: ${data.escrow.status}`);
      }
      if (onCancelled) {
        onCancelled(order.id);
      }
      onClose();
    } catch (error) {
      notice.error(error.message);
      if (/dispute/i.test(error.message)) {
        notice.info('You can raise a dispute from this order instead');
      }
    } finally {
      setCancelling(false);
    }
  };

  const handleLockEscrow = async () => {
    if (!isConnected || !client) {
      notice.error('Not connected to XRPL. Please wait for the connection and try again.');
      return;
    }
    if (!wallet) {
      notice.error('No unlocked wallet. Load or create your wallet first.');
      return;
    }
    if (!order.counterpartyAddress) {
      notice.error('This order has no counterparty yet.');
      return;
    }

    setLockingEscrow(true);
    try {
      notice.info('Preparing escrow...');
      const prepareResponse = await authService.authFetch(`${apiBaseUrl}/api/p2p/prepare-escrow`, {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id,
          xrpAmount: parseFloat(order.xrpAmount),
          destinationAddress: order.counterpartyAddress
        })
      });
      const prepareData = await prepareResponse.json();
      if (!prepareResponse.ok || !prepareData.success) {
        throw new Error(prepareData.message || prepareData.error || 'Failed to prepare the escrow');
      }

      notice.info('Signing EscrowCreate with your wallet...');
      const preparedTx = await client.autofill(prepareData.transaction);
      const offerSequence = preparedTx.Sequence;
      const signedTx = wallet.sign(preparedTx);

      notice.info('Submitting escrow to the XRPL...');
      const prelim = await client.submit(signedTx.tx_blob);
      if (prelim.result.engine_result !== 'tesSUCCESS') {
        throw new Error(`EscrowCreate submit failed: ${prelim.result.engine_result}`);
      }

      const validated = await waitForValidation(client, signedTx.hash);
      if (validated.meta?.TransactionResult !== 'tesSUCCESS') {
        throw new Error(`EscrowCreate failed on ledger: ${validated.meta?.TransactionResult || 'unknown'}`);
      }

      const submitResponse = await authService.authFetch(`${apiBaseUrl}/api/p2p/submit-escrow-hash`, {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id,
          txHash: signedTx.hash,
          offerSequence
        })
      });
      const submitData = await submitResponse.json();
      if (!submitResponse.ok || !submitData.success) {
        throw new Error(submitData.message || submitData.error || 'Failed to record the escrow lock');
      }

      notice.success('XRP locked in escrow on the ledger');
      if (onEscrowLocked) {
        onEscrowLocked(order.id);
      }
      onClose();
    } catch (error) {
      notice.error(error.message);
    } finally {
      setLockingEscrow(false);
    }
  };

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <InlineNotice />
        <ModalHeader>
          <ModalTitle>Order Details</ModalTitle>
          <CloseButton onClick={onClose}>×</CloseButton>
        </ModalHeader>

        <ModalBody>
          <OrderInfo>
            <InfoRow>
              <InfoLabel>Order ID:</InfoLabel>
              <InfoValue>{order.id}</InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>Type:</InfoLabel>
              <InfoValue>
                <TypeBadge type={order.type}>
                  {order.type}
                </TypeBadge>
              </InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>Status:</InfoLabel>
              <InfoValue>
                <StatusBadge status={order.status}>
                  {order.status.replace('_', ' ')}
                </StatusBadge>
              </InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>TRY Amount:</InfoLabel>
              <InfoValue>₺{(parseFloat(order.tryAmount) || 0).toFixed(2)}</InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>XRP Amount:</InfoLabel>
              <InfoValue>{(parseFloat(order.xrpAmount) || 0).toFixed(6)} XRP</InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>Rate:</InfoLabel>
              <InfoValue>₺{(parseFloat(order.rate) || 0).toFixed(2)} per XRP</InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>XRPL Address:</InfoLabel>
              <InfoValue>
                <AddressDisplay>{order.xrplAddress}</AddressDisplay>
              </InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>Payment Methods:</InfoLabel>
              <InfoValue>
                <PaymentMethodsList>
                  {formatPaymentMethods(order.paymentMethods).map((method, idx) => (
                    <PaymentMethodTag key={idx}>{method}</PaymentMethodTag>
                  ))}
                </PaymentMethodsList>
              </InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>Created:</InfoLabel>
              <InfoValue>
                <TimestampDisplay>{formatTimestamp(order.createdAt)}</TimestampDisplay>
              </InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>Expires:</InfoLabel>
              <InfoValue>
                <TimestampDisplay>{formatTimestamp(order.expiresAt)}</TimestampDisplay>
              </InfoValue>
            </InfoRow>
            {order.counterpartyAddress && (
              <InfoRow>
                <InfoLabel>Counterparty:</InfoLabel>
                <InfoValue>
                  <AddressDisplay>{order.counterpartyAddress}</AddressDisplay>
                </InfoValue>
              </InfoRow>
            )}
            {order.paymentReference && (
              <InfoRow>
                <InfoLabel>Payment Reference:</InfoLabel>
                <InfoValue>{order.paymentReference}</InfoValue>
              </InfoRow>
            )}
            {order.xrpTransactionHash && (
              <InfoRow>
                <InfoLabel>XRP Transaction:</InfoLabel>
                <InfoValue>
                  <AddressDisplay>{order.xrpTransactionHash}</AddressDisplay>
                </InfoValue>
              </InfoRow>
            )}
            {order.matchedAt && (
              <InfoRow>
                <InfoLabel>Matched At:</InfoLabel>
                <InfoValue>
                  <TimestampDisplay>{formatTimestamp(order.matchedAt)}</TimestampDisplay>
                </InfoValue>
              </InfoRow>
            )}
            {order.paymentConfirmedAt && (
              <InfoRow>
                <InfoLabel>Payment Confirmed:</InfoLabel>
                <InfoValue>
                  <TimestampDisplay>{formatTimestamp(order.paymentConfirmedAt)}</TimestampDisplay>
                </InfoValue>
              </InfoRow>
            )}
            {order.completedAt && (
              <InfoRow>
                <InfoLabel>Completed At:</InfoLabel>
                <InfoValue>
                  <TimestampDisplay>{formatTimestamp(order.completedAt)}</TimestampDisplay>
                </InfoValue>
              </InfoRow>
            )}
            {order.disputeReason && (
              <InfoRow>
                <InfoLabel>Dispute Reason:</InfoLabel>
                <InfoValue>{order.disputeReason}</InfoValue>
              </InfoRow>
            )}
            {order.escrowStatus && order.escrowStatus !== 'none' && (
              <InfoRow>
                <InfoLabel>Escrow:</InfoLabel>
                <InfoValue>
                  <StatusBadge status={order.escrowStatus === 'locked' ? 'matched' : order.escrowStatus === 'finished' ? 'completed' : 'open'}>
                    {{
                      prepared: 'prepared (awaiting seller signature)',
                      locked: 'locked on ledger',
                      finish_pending: 'finish pending',
                      finished: 'released to buyer',
                      cancel_pending: 'cancel pending',
                      refunded: 'refunded to seller'
                    }[order.escrowStatus] || order.escrowStatus}
                  </StatusBadge>
                </InfoValue>
              </InfoRow>
            )}
            {order.escrowTransactionHash && (
              <InfoRow>
                <InfoLabel>Escrow Tx:</InfoLabel>
                <InfoValue>
                  <AddressDisplay>{order.escrowTransactionHash}</AddressDisplay>
                </InfoValue>
              </InfoRow>
            )}
            {order.escrowStatus === 'locked' && order.type === 'buy' && (
              <InfoRow>
                <InfoLabel></InfoLabel>
                <InfoValue style={{ fontSize: '13px', color: theme.color.inkSoft }}>
                  The seller has locked the XRP in escrow on the XRPL. Send the TRY
                  payment via the agreed method, then confirm the payment — the
                  escrow will be released to your address.
                </InfoValue>
              </InfoRow>
            )}
          </OrderInfo>

          <ActionSection>
            {canLockEscrow() && (
              <SuccessBtn
                disabled={lockingEscrow}
                onClick={handleLockEscrow}
              >
                {lockingEscrow ? 'Locking Escrow…' : 'Lock XRP in Escrow'}
              </SuccessBtn>
            )}

            {canConfirmPayment() && (
              <SuccessBtn
                onClick={() => setShowPaymentConfirmation(true)}
              >
                Confirm TRY Payment
              </SuccessBtn>
            )}

            {canConfirmXRP() && (
              <SuccessBtn
                onClick={() => setShowXRPConfirmation(true)}
              >
                Confirm XRP Transfer
              </SuccessBtn>
            )}

            {canRaiseDispute() && (
              <WarningBtn
                onClick={() => setShowDisputeResolution(true)}
              >
                Raise Dispute
              </WarningBtn>
            )}

            {canCancelOrder() && (
              <DangerBtn
                disabled={cancelling}
                onClick={() => setShowCancelDialog(true)}
              >
                {cancelling ? 'Cancelling…' : 'Cancel Order'}
              </DangerBtn>
            )}
          </ActionSection>
        </ModalBody>
      </ModalContent>

      {showPaymentConfirmation && (
        <PaymentConfirmation
          order={order}
          onClose={() => setShowPaymentConfirmation(false)}
          onConfirmed={handlePaymentConfirmed}
        />
      )}

      {showXRPConfirmation && (
        <XRPConfirmation
          order={order}
          onClose={() => setShowXRPConfirmation(false)}
          onConfirmed={handleXRPConfirmed}
        />
      )}

      {showDisputeResolution && (
        <DisputeResolution
          order={order}
          onClose={() => setShowDisputeResolution(false)}
          onDisputeRaised={handleDisputeRaised}
        />
      )}

      {showCancelDialog && (
        <ConfirmDialog
          title="Cancel this order?"
          description="The order will close and stop matching. Optionally add a reason for the record."
          inputLabel="Reason (optional)"
          placeholder="e.g. Changed my mind"
          confirmLabel="Cancel order"
          onSubmit={(reason) => {
            setShowCancelDialog(false);
            handleCancelOrder(reason);
          }}
          onCancel={() => setShowCancelDialog(false)}
        />
      )}
    </ModalOverlay>
  );
};

export default OrderDetails;
