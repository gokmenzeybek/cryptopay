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

const Select = styled.select`
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: ${theme.color.surface};
  border-radius: ${theme.radius.input};
  font-size: 1rem;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: box-shadow ${theme.motion.fast};
  outline: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236B6B66' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 16px center;

  &:focus {
    box-shadow: 0 0 0 2px ${theme.color.signal};
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
  min-height: 120px;
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

const SecondaryBtn = styled(ActionButton)`
  background: ${theme.color.surface};
  color: ${theme.color.ink};
`;

const DangerBtn = styled(ActionButton)`
  background: ${theme.color.danger};
  color: white;
`;

const LoadingSpinner = styled.div`
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid ${theme.color.line};
  border-top: 2px solid ${theme.color.danger};
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

const DisputeResolution = ({ order, onClose, onDisputeRaised }) => {
  const { apiBaseUrl } = useXRPL();
  const [formData, setFormData] = useState({
    reason: '',
    evidence: '',
    additionalInfo: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const disputeReasons = [
    { value: 'payment_not_received', label: 'Payment not received' },
    { value: 'payment_amount_incorrect', label: 'Payment amount incorrect' },
    { value: 'xrp_not_sent', label: 'XRP not sent' },
    { value: 'xrp_amount_incorrect', label: 'XRP amount incorrect' },
    { value: 'counterparty_unresponsive', label: 'Counterparty unresponsive' },
    { value: 'fraud_suspected', label: 'Fraud suspected' },
    { value: 'technical_issue', label: 'Technical issue' },
    { value: 'other', label: 'Other' }
  ];

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

    if (!formData.reason) {
      setError('Please select a dispute reason');
      return;
    }

    if (!formData.evidence.trim()) {
      setError('Please provide evidence for your dispute');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.authFetch(`${apiBaseUrl}/api/p2p/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          reason: formData.reason,
          evidence: formData.evidence,
          additionalInfo: formData.additionalInfo
        })
      });

      const data = await response.json();

      if (data.success) {
        onDisputeRaised(order.id);
      } else {
        setError(data.error || 'Failed to raise dispute');
      }
    } catch (error) {
      setError('Network error. Please try again.');
      console.error('Error raising dispute:', error);
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>Raise Dispute</ModalTitle>
          <CloseButton onClick={onClose}>×</CloseButton>
        </ModalHeader>

        <ModalBody>
          <OrderSummary>
            <SummaryRow>
              <SummaryLabel>Order ID:</SummaryLabel>
              <SummaryValue>{order.id}</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Order Type:</SummaryLabel>
              <SummaryValue>{order.type}</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Amount:</SummaryLabel>
              <SummaryValue>
                ₺{(parseFloat(order.tryAmount) || 0).toFixed(2)} / {(parseFloat(order.xrpAmount) || 0).toFixed(6)} XRP
              </SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Rate:</SummaryLabel>
              <SummaryValue>₺{(parseFloat(order.rate) || 0).toFixed(2)} per XRP</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Counterparty:</SummaryLabel>
              <SummaryValue>
                <AddressDisplay>{order.counterpartyAddress || 'N/A'}</AddressDisplay>
              </SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Payment Methods:</SummaryLabel>
              <SummaryValue>
                {formatPaymentMethods(order.paymentMethods).join(', ')}
              </SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Current Status:</SummaryLabel>
              <SummaryValue>{order.status.replace('_', ' ')}</SummaryValue>
            </SummaryRow>
          </OrderSummary>

          <InfoBox>
            <strong>Dispute Process:</strong> When you raise a dispute, a moderator will review your case
            and the evidence provided. They will make a decision based on the information available and
            may contact both parties for additional details.
          </InfoBox>

          <WarningBox>
            <strong>Important:</strong> Only raise a dispute if you have a legitimate concern about the trade.
            False disputes may result in account restrictions. Provide as much evidence as possible to support your case.
          </WarningBox>

          {error && <ErrorBox>{error}</ErrorBox>}

          <form onSubmit={handleSubmit}>
            <FormGroup>
              <Label>Dispute Reason *</Label>
              <Select
                name="reason"
                value={formData.reason}
                onChange={handleInputChange}
                required
              >
                <option value="">Select a reason for the dispute</option>
                {disputeReasons.map(reason => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <FormGroup>
              <Label>Evidence *</Label>
              <TextArea
                name="evidence"
                value={formData.evidence}
                onChange={handleInputChange}
                placeholder="Please provide detailed evidence for your dispute. Include transaction IDs, screenshots, communication records, etc."
                required
              />
            </FormGroup>

            <FormGroup>
              <Label>Additional Information</Label>
              <TextArea
                name="additionalInfo"
                value={formData.additionalInfo}
                onChange={handleInputChange}
                placeholder="Any additional information that might help resolve the dispute..."
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
              <DangerBtn
                type="submit"
                disabled={loading}
              >
                {loading && <LoadingSpinner />}
                Raise Dispute
              </DangerBtn>
            </ButtonRow>
          </form>
        </ModalBody>
      </ModalContent>
    </ModalOverlay>
  );
};

export default DisputeResolution;
