/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import OrderForm from '../OrderForm';
import { useXRPL } from '../../hooks/useXRPL';
import authService from '../../services/authService';

jest.mock('../../hooks/useXRPL');
jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: { authFetch: jest.fn() }
}));

const ADDR = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

const renderForm = (props = {}) => {
  useXRPL.mockReturnValue({
    apiBaseUrl: 'http://localhost:5001',
    isPrivileged: props.isPrivileged || false
  });
  const onOrderCreated = jest.fn();
  render(
    <OrderForm
      currentRate={{ rate: 40 }}
      onOrderCreated={onOrderCreated}
      userAddress={ADDR}
      {...props}
    />
  );
  return { onOrderCreated };
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.useRealTimers();
  global.fetch = jest.fn().mockResolvedValue({
    json: () => Promise.resolve({ success: true, paymentMethods: ['bank_transfer', 'papara', 'ininal'] })
  });
  authService.authFetch.mockResolvedValue({
    json: () => Promise.resolve({ success: true, order: { id: 42 } })
  });
});

const fillValidForm = () => {
  fireEvent.change(screen.getByPlaceholderText('0.00', { exact: true }), { target: { value: '100', name: 'tryAmount' } });
};

describe('OrderForm', () => {
  test('renders with rate display and payment methods from the API', async () => {
    renderForm();
    expect(screen.getByText('₺40.00')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('BANK TRANSFER')).toBeInTheDocument());
    expect(screen.getByText('PAPARA')).toBeInTheDocument();
  });

  test('shows the Papara account field only when papara is selected', async () => {
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    // papara selected by default
    expect(screen.getByPlaceholderText('1234567890')).toBeInTheDocument();
    fireEvent.click(screen.getByText('PAPARA'));
    expect(screen.queryByPlaceholderText('1234567890')).not.toBeInTheDocument();
  });

  test('TRY amount auto-calculates XRP via the rate', async () => {
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    fireEvent.change(document.querySelector('input[name="tryAmount"]'), { target: { name: 'tryAmount', value: '400' } });
    expect(screen.getByPlaceholderText('0.000000')).toHaveValue(10);
  });

  test('XRP amount auto-calculates TRY via the rate', async () => {
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    fireEvent.change(screen.getByPlaceholderText('0.000000'), { target: { name: 'xrpAmount', value: '5' } });
    expect(document.querySelector('input[name="tryAmount"]')).toHaveValue(200);
  });

  test('rate change recalculates from the TRY amount', async () => {
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    fireEvent.change(document.querySelector('input[name="tryAmount"]'), { target: { name: 'tryAmount', value: '100' } });
    fireEvent.change(document.querySelector('input[name="rate"]'), { target: { name: 'rate', value: '50' } });
    expect(screen.getByPlaceholderText('0.000000')).toHaveValue(2);
  });

  test('submit creates the order and resets the form', async () => {
    const { onOrderCreated } = renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    const form = document.querySelector('form');
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(authService.authFetch).toHaveBeenCalledWith(
      'http://localhost:5001/api/p2p/create-order',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(authService.authFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      type: 'buy',
      tryAmount: 100,
      xrpAmount: 1,
      xrplAddress: ADDR,
      paymentMethods: ['papara'],
      timeLimit: 30
    });
    expect(onOrderCreated).toHaveBeenCalledWith({ id: 42 });
  });

  test('submit shows server error message', async () => {
    authService.authFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: false, error: 'rate out of range' })
    });
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText('rate out of range')).toBeInTheDocument();
  });

  test('submit shows network error on fetch failure', async () => {
    authService.authFetch.mockRejectedValue(new Error('boom'));
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  test('buyer (non-privileged) sees only Buy order type', async () => {
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    expect(screen.getByText('Buy XRP with TRY')).toBeInTheDocument();
    expect(screen.queryByText('Sell XRP for TRY')).not.toBeInTheDocument();
  });

  test('seller/admin sees both Buy and Sell order types', async () => {
    renderForm({ isPrivileged: true });
    await waitFor(() => screen.getByText('PAPARA'));
    expect(screen.getByText('Buy XRP with TRY')).toBeInTheDocument();
    expect(screen.getByText('Sell XRP for TRY')).toBeInTheDocument();
  });

  test('rejects a bad XRPL address', async () => {    renderForm({ userAddress: 'short' });
    await waitFor(() => screen.getByText('PAPARA'));
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText(/must be 25-34 characters/)).toBeInTheDocument();
    expect(authService.authFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('create-order'), expect.anything()
    );
  });

  test('rejects an address without the r prefix', async () => {
    renderForm({ userAddress: 'xHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh' });
    await waitFor(() => screen.getByText('PAPARA'));
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText(/must start with "r"/)).toBeInTheDocument();
  });

  test('requires at least one payment method', async () => {
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    fireEvent.click(screen.getByText('PAPARA')); // deselect the default
    await act(async () => {
      fireEvent.submit(document.querySelector('form'));
    });
    expect(screen.getByText('Please select at least one payment method')).toBeInTheDocument();
  });

  test('papara account validation success shows the account holder', async () => {
    jest.useFakeTimers();
    authService.authFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: true, accountExists: true, accountHolder: 'Ada Lovelace' })
    });
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    fireEvent.change(screen.getByPlaceholderText('1234567890'), {
      target: { name: 'paparaAccountNumber', value: '1234567890' }
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await waitFor(() => expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument());
    jest.useRealTimers();
  });

  test('papara account validation failure shows the error', async () => {
    jest.useFakeTimers();
    authService.authFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: false, message: 'Account not found' })
    });
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    fireEvent.change(screen.getByPlaceholderText('1234567890'), {
      target: { name: 'paparaAccountNumber', value: '1234567890' }
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await waitFor(() => expect(screen.getByText(/Account not found/)).toBeInTheDocument());
    jest.useRealTimers();
  });

  test('short papara number resets validation state without calling the API', async () => {
    jest.useFakeTimers();
    renderForm();
    await waitFor(() => screen.getByText('PAPARA'));
    fireEvent.change(screen.getByPlaceholderText('1234567890'), {
      target: { name: 'paparaAccountNumber', value: '123' }
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(authService.authFetch).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
