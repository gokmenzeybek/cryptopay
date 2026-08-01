import React, { useState } from 'react';
import styled from 'styled-components';
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

const FormGroup = styled.div`
  margin-bottom: 20px;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: ${theme.color.inkSoft};
  font-size: 14px;
`;

const Input = styled.input`
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: ${theme.color.surface};
  border-radius: ${theme.radius.input};
  font-size: 1rem;
  font-family: ${theme.font.stack};
  transition: box-shadow ${theme.motion.fast};
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px ${theme.color.signal};
  }

  &::placeholder {
    color: ${theme.color.inkFaint};
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: ${theme.color.surface};
  border-radius: ${theme.radius.input};
  font-size: 1rem;
  font-family: ${theme.font.stack};
  min-height: 100px;
  resize: vertical;
  transition: box-shadow ${theme.motion.fast};
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px ${theme.color.signal};
  }

  &::placeholder {
    color: ${theme.color.inkFaint};
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  flex-wrap: wrap;
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
  min-width: 120px;

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

const SecondaryBtn = styled(ActionButton)`
  background: ${theme.color.surface};
  color: ${theme.color.ink};
`;

const LoadingSpinner = styled.div`
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid ${theme.color.line};
  border-top: 2px solid ${theme.color.signal};
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 8px;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const InfoBox = styled.div`
  background: ${theme.color.signalWash};
  color: ${theme.color.signalDeep};
  padding: 14px 16px;
  border-radius: ${theme.radius.card};
  margin-bottom: 20px;
  font-size: 14px;
  line-height: 1.5;
`;

const WarningBox = styled.div`
  background: #FFF8E1;
  color: #856404;
  padding: 14px 16px;
  border-radius: ${theme.radius.card};
  margin-bottom: 20px;
  font-size: 14px;
  line-height: 1.5;
`;

const ErrorBox = styled.div`
  background: ${theme.color.dangerWash};
  color: ${theme.color.danger};
  padding: 14px 16px;
  border-radius: ${theme.radius.card};
  margin-bottom: 20px;
  font-size: 14px;
`;

const OrderSummary = styled.div`
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  padding: 20px;
  margin-bottom: 20px;
`;

const SummaryRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid ${theme.color.line};

  &:last-child {
    border-bottom: none;
  }
  font-size: 14px;
`;

const SummaryLabel = styled.span`
  font-weight: 600;
  color: ${theme.color.inkSoft};
`;

const SummaryValue = styled.span`
  color: ${theme.color.ink};
  font-weight: 600;
`;

const AddressDisplay = styled.div`
  font-family: monospace;
  font-size: 0.85rem;
  color: ${theme.color.inkSoft};
  word-break: break-all;
`;

const XRPConfirmation = ({ order, onClose, onConfirmed }) => {
  const { apiBaseUrl } = useXRPL();
  const [formData, setFormData] = useState({
    xrpTransactionHash: '',
    additionalNotes: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!formData.xrpTransactionHash.trim()) {
      setError('Please provide the XRP transaction hash');
      return;
    }

    if (!/^[0-9A-Fa-f]{64}$/.test(formData.xrpTransactionHash.trim())) {
      setError('Please provide a valid XRP transaction hash (64 hex characters)');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.authFetch(`${apiBaseUrl}/api/p2p/confirm-xrp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          xrpTransactionHash: formData.xrpTransactionHash,
          additionalNotes: formData.additionalNotes
        })
      });

      const data = await response.json();

      if (data.success) {
        onConfirmed(order.id);
      } else {
        setError(data.error || 'Failed to confirm XRP transfer');
      }
    } catch (error) {
      setError('Network error. Please try again.');
      console.error('Error confirming XRP transfer:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>Confirm XRP Transfer</ModalTitle>
          <CloseButton onClick={onClose}>×</CloseButton>
        </ModalHeader>

        <ModalBody>
          <OrderSummary>
            <SummaryRow>
              <SummaryLabel>Order ID:</SummaryLabel>
              <SummaryValue>{order.id}</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>XRP Amount to Send:</SummaryLabel>
              <SummaryValue>{(parseFloat(order.xrpAmount) || 0).toFixed(6)} XRP</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>TRY Amount:</SummaryLabel>
              <SummaryValue>₺{(parseFloat(order.tryAmount) || 0).toFixed(2)}</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Rate:</SummaryLabel>
              <SummaryValue>₺{(parseFloat(order.rate) || 0).toFixed(2)} per XRP</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Buyer Address:</SummaryLabel>
              <SummaryValue>
                <AddressDisplay>{order.counterpartyAddress || 'N/A'}</AddressDisplay>
              </SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Payment Confirmed:</SummaryLabel>
              <SummaryValue>
                {order.paymentConfirmedAt ?
                  new Date(order.paymentConfirmedAt).toLocaleString() :
                  'Not confirmed'
                }
              </SummaryValue>
            </SummaryRow>
          </OrderSummary>

          <InfoBox>
            <strong>Important:</strong> Only confirm the XRP transfer after you have successfully sent the XRP
            to the buyer's address. Make sure to copy the exact transaction hash from your XRPL wallet.
          </InfoBox>

          <WarningBox>
            <strong>Warning:</strong> Once you confirm the XRP transfer, the trade will be completed and
            cannot be reversed. Make sure the transaction hash is correct and the XRP has been successfully sent.
          </WarningBox>

          {error && <ErrorBox>{error}</ErrorBox>}

          <form onSubmit={handleSubmit}>
            <FormGroup>
              <Label>XRP Transaction Hash *</Label>
              <Input
                type="text"
                name="xrpTransactionHash"
                value={formData.xrpTransactionHash}
                onChange={handleInputChange}
                placeholder="Enter the XRP transaction hash from your wallet"
                required
              />
            </FormGroup>

            <FormGroup>
              <Label>Additional Notes</Label>
              <TextArea
                name="additionalNotes"
                value={formData.additionalNotes}
                onChange={handleInputChange}
                placeholder="Any additional information about the XRP transfer..."
              />
            </FormGroup>

            <ButtonRow>
              <SecondaryBtn
                type="button"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </SecondaryBtn>
              <SuccessBtn
                type="submit"
                disabled={loading}
              >
                {loading && <LoadingSpinner />}
                Confirm XRP Transfer
              </SuccessBtn>
            </ButtonRow>
          </form>
        </ModalBody>
      </ModalContent>
    </ModalOverlay>
  );
};

export default XRPConfirmation;
