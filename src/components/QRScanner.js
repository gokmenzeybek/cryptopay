import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useXRPL } from '../hooks/useXRPL';
import { notice } from '../services/notice';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Link } from 'react-router-dom';
import theme from '../theme';

const ScannerContainer = styled.div`
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  padding: 24px;
  margin-bottom: 30px;
  font-family: ${theme.font.stack};
`;

const Title = styled.h2`
  margin-bottom: 20px;
  color: ${theme.color.ink};
  font-size: 24px;
  font-weight: 700;
`;

const ScannerSection = styled.div`
  margin-bottom: 30px;
`;

const ScannerBox = styled.div`
  position: relative;
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
  border-radius: ${theme.radius.card};
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0,0,0,0.15);
  background: ${theme.color.ink};
  height: 300px;
`;

const ActionButton = styled.button`
  padding: 14px 28px;
  border: none;
  border-radius: ${theme.radius.pill};
  font-size: 14px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};
  margin: 5px;

  &:hover:not(:disabled) { opacity: 0.88; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const PrimaryButton = styled(ActionButton)`
  background: ${theme.color.ink};
  color: ${theme.color.paper};
`;

const SuccessButton = styled(ActionButton)`
  background: ${theme.color.signal};
  color: #06281A;
`;

const DangerButton = styled(ActionButton)`
  background: ${theme.color.danger};
  color: white;
`;

const EditButton = styled(ActionButton)`
  background: ${theme.color.surface};
  color: ${theme.color.ink};
  border: 1px solid ${theme.color.line};
`;

const PaymentDetails = styled.div`
  background: ${theme.color.surface};
  border-radius: ${theme.radius.card};
  padding: 20px;
  margin-top: 20px;
  display: ${props => props.show ? 'block' : 'none'};
`;

const DetailItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid ${theme.color.line};

  &:last-child {
    border-bottom: none;
  }
`;

const DetailLabel = styled.span`
  font-weight: 600;
  color: ${theme.color.inkSoft};
  font-size: 14px;
`;

const DetailValue = styled.span`
  color: ${theme.color.ink};
  word-break: break-all;
  font-size: 14px;
  font-weight: 600;
`;

const Amount = styled.span`
  font-size: 1.5rem;
  font-weight: 700;
  color: ${theme.color.signalDeep};
`;

const ManualInput = styled.div`
  padding: 20px;
  text-align: center;
  background: ${theme.color.paper};
  border-radius: ${theme.radius.card};
  margin-top: 20px;
  border: 1px solid ${theme.color.line};
`;

const ManualTitle = styled.h3`
  margin: 0 0 8px 0;
  color: ${theme.color.ink};
  font-size: 16px;
  font-weight: 600;
`;

const ManualDescription = styled.p`
  margin: 0 0 15px 0;
  color: ${theme.color.inkSoft};
  font-size: 14px;
`;

const FormatHint = styled.div`
  background: ${theme.color.surface};
  padding: 12px 16px;
  border-radius: ${theme.radius.input};
  margin-bottom: 15px;
  font-size: 13px;
  color: ${theme.color.inkSoft};
  text-align: left;
  line-height: 1.5;

  strong {
    color: ${theme.color.ink};
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  height: 120px;
  margin: 15px 0;
  padding: 14px 16px;
  border: none;
  background: ${theme.color.surface};
  border-radius: ${theme.radius.input};
  font-size: 14px;
  font-family: ${theme.font.stack};
  resize: vertical;
  outline: none;
  transition: box-shadow ${theme.motion.fast};

  &:focus {
    box-shadow: 0 0 0 2px ${theme.color.signal};
  }

  &::placeholder {
    color: ${theme.color.inkFaint};
  }
`;

const ErrorMessage = styled.div`
  color: ${theme.color.danger};
  background: ${theme.color.dangerWash};
  padding: 12px 16px;
  border-radius: ${theme.radius.input};
  margin-bottom: 10px;
  font-size: 14px;
`;

const NoWalletCard = styled.div`
  text-align: center;
  padding: 40px 20px;
  background: ${theme.color.paper};
  border-radius: ${theme.radius.card};
`;

const NoWalletTitle = styled.h3`
  margin: 0 0 12px 0;
  color: ${theme.color.ink};
  font-size: 18px;
  font-weight: 700;
`;

const NoWalletText = styled.p`
  margin: 0 0 24px 0;
  color: ${theme.color.inkSoft};
  font-size: 14px;
`;

const BackLink = styled.a`
  color: ${theme.color.inkSoft};
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;

  &:hover {
    color: ${theme.color.ink};
  }
`;

const QRScanner = () => {
  const { wallet, sendPayment, loading, createWallet } = useXRPL();
  const [paymentRequest, setPaymentRequest] = useState(null);
  const [manualInput, setManualInput] = useState('');
  const [showWalletCreation, setShowWalletCreation] = useState(false);
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleQRResult = (result) => {
    if (!result) return;

    const scannedText = typeof result === 'string' ? result : (result.text || result.data || result);

    try {
      const qrData = JSON.parse(scannedText);
      if (qrData.type === 'payment_request' && qrData.recipient && qrData.amount) {
        setPaymentRequest(qrData);
        notice.success('Payment request loaded');
        return;
      } else {
        notice.error('Invalid QR code. Please scan a payment request QR code.');
        return;
      }
    } catch (jsonError) {
      const parts = scannedText.split(',');
      if (parts.length >= 2) {
        const [recipient, amount, memo = ''] = parts;
        const numericAmount = parseFloat(amount);

        if (recipient && !isNaN(numericAmount) && numericAmount > 0) {
          const paymentData = {
            type: 'payment_request',
            recipient: recipient.trim(),
            amount: numericAmount,
            memo: memo.trim(),
            timestamp: new Date().toISOString()
          };

          setPaymentRequest(paymentData);
          notice.success('Payment request loaded');
          return;
        }
      }

      console.error('Error parsing QR code:', jsonError);
      notice.error('Invalid QR code format. Please scan a valid payment request QR code.');
    }
  };

  const processManualInput = () => {
    if (manualInput.trim()) {
      handleQRResult(manualInput.trim());
      setManualInput('');
    } else {
      notice.error('Please enter QR code data first.');
    }
  };

  const confirmPayment = async () => {
    if (!paymentRequest || !wallet) {
      notice.error('No payment request or wallet available.');
      return;
    }

    try {
      await sendPayment(
        paymentRequest.recipient,
        paymentRequest.amount,
        paymentRequest.memo || ''
      );

      setPaymentRequest(null);
    } catch (error) {
      console.error('Payment failed:', error);
    }
  };

  const cancelPayment = () => {
    setPaymentRequest(null);
    notice.info('Payment cancelled');
  };

  const handleCreateWallet = async () => {
    try {
      setIsCreatingWallet(true);
      await createWallet();
      setShowWalletCreation(false);
      notice.success('Wallet created successfully!');
    } catch (error) {
      console.error('Error creating wallet:', error);
      notice.error(`Error creating wallet: ${error.message}`);
    } finally {
      setIsCreatingWallet(false);
    }
  };

  useEffect(() => {
    if (!wallet) {
      setShowWalletCreation(true);
    } else {
      setShowWalletCreation(false);
    }
  }, [wallet]);

  if (showWalletCreation) {
    return (
      <ScannerContainer>
        <Title>QR Scanner</Title>
        <NoWalletCard>
          <NoWalletTitle>No Wallet Found</NoWalletTitle>
          <NoWalletText>
            You need a wallet to send payments. Create one now to get started.
          </NoWalletText>
          <PrimaryButton
            onClick={handleCreateWallet}
            disabled={isCreatingWallet || loading}
            style={{ width: '100%', marginBottom: '16px' }}
          >
            {isCreatingWallet ? 'Creating Wallet...' : 'Create New Wallet'}
          </PrimaryButton>
          <div>
            <BackLink href="/">← Back to Main App</BackLink>
          </div>
        </NoWalletCard>
      </ScannerContainer>
    );
  }

  return (
    <ScannerContainer>
      <Title>QR Scanner</Title>

      <ScannerSection>
        <ScannerBox>
          <Scanner
            onDecode={(result) => {
              handleQRResult(result);
            }}
            onError={(error) => {
              console.error('QR Scanner Error:', error);
              setErrorMessage(error.message || error.toString());
              if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                notice.error('Camera access denied. Please enable camera permissions in your browser or device settings.');
              } else if (error.name === 'NotFoundError') {
                notice.error('No camera found. Please check your device has a camera.');
              } else if (error.name === 'NotSupportedError') {
                notice.error('Camera not supported. Please try a different browser or device.');
              } else {
                notice.error(`Scanner error: ${error.message || error.toString()}`);
              }
            }}
            styles={{
              container: { width: '100%', height: '100%' },
              video: { width: '100%', height: '100%' }
            }}
            constraints={{
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }}
            scanDelay={300}
          />
          {errorMessage && <ErrorMessage>{errorMessage}</ErrorMessage>}
        </ScannerBox>
      </ScannerSection>

      <ManualInput>
        <ManualTitle>Manual QR Input</ManualTitle>
        <ManualDescription>
          Camera access not available? Enter QR code data manually:
        </ManualDescription>
        <FormatHint>
          <strong>Supported formats:</strong><br />
          • JSON: {"{"}"type":"payment_request","recipient":"rAddress...","amount":10.5,"memo":"Payment"{"}"}<br />
          • Simple: rAddress...,10.5,Payment memo
        </FormatHint>
        <TextArea
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          placeholder="Paste QR code data here (JSON or comma-separated format)..."
        />
        <PrimaryButton onClick={processManualInput}>
          Process QR Data
        </PrimaryButton>
      </ManualInput>

      <PaymentDetails show={!!paymentRequest}>
        <h3 style={{ margin: '0 0 16px 0', color: theme.color.ink, fontSize: '18px' }}>Payment Request</h3>
        <DetailItem>
          <DetailLabel>Amount:</DetailLabel>
          <DetailValue><Amount>{paymentRequest?.amount} XRP</Amount></DetailValue>
        </DetailItem>
        <DetailItem>
          <DetailLabel>To:</DetailLabel>
          <DetailValue style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{paymentRequest?.recipient}</DetailValue>
        </DetailItem>
        <DetailItem>
          <DetailLabel>Memo:</DetailLabel>
          <DetailValue>{paymentRequest?.memo || 'None'}</DetailValue>
        </DetailItem>

        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <SuccessButton
            onClick={confirmPayment}
            disabled={loading}
            style={{ width: '100%' }}
          >
            {loading ? 'Processing...' : 'Confirm & Send Payment'}
          </SuccessButton>
          <Link
            to={`/payment?to=${encodeURIComponent(paymentRequest?.recipient || '')}`}
            style={{ textDecoration: 'none', display: 'block' }}
          >
            <EditButton style={{ width: '100%' }}>
              Edit Payment Details
            </EditButton>
          </Link>
          <DangerButton
            onClick={cancelPayment}
            style={{ width: '100%' }}
          >
            Cancel
          </DangerButton>
        </div>
      </PaymentDetails>
    </ScannerContainer>
  );
};

export default QRScanner;
