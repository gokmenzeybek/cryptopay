/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OrderBook from '../OrderBook';

const ORDERS = [
  {
    id: 1, type: 'buy', status: 'open', tryAmount: '1000', xrpAmount: '25',
    rate: '40', paymentMethods: ['papara', 'bank_transfer'],
    createdAt: '2026-01-02T00:00:00Z'
  },
  {
    id: 2, type: 'sell', status: 'matched', tryAmount: '500', xrpAmount: '10',
    rate: '50', paymentMethods: ['ininal'],
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 3, type: 'sell', status: 'completed', tryAmount: '200', xrpAmount: '5',
    rate: '40', paymentMethods: ['mefete', 'qr_havale', 'unknown_method'],
    createdAt: '2026-01-03T00:00:00Z'
  }
];

describe('OrderBook', () => {
  test('empty state for the market', () => {
    render(<OrderBook orders={[]} />);
    expect(screen.getByText('No orders found')).toBeInTheDocument();
    expect(screen.getByText(/No orders available/)).toBeInTheDocument();
  });

  test('empty state for my orders', () => {
    render(<OrderBook orders={[]} isMyOrders />);
    expect(screen.getByText(/haven't created any orders/)).toBeInTheDocument();
  });

  test('renders all orders with mapped payment method names', () => {
    render(<OrderBook orders={ORDERS} />);
    expect(screen.getByText('Papara')).toBeInTheDocument();
    expect(screen.getByText('Bank')).toBeInTheDocument();
    expect(screen.getByText('İninal')).toBeInTheDocument();
    expect(screen.getByText('Mefete')).toBeInTheDocument();
    expect(screen.getByText('QR Havale')).toBeInTheDocument();
    expect(screen.getByText('unknown_method')).toBeInTheDocument();
    expect(screen.getByText('payment confirmed'.replace('payment confirmed', 'matched'))).toBeInTheDocument();
  });

  test('filters by type and status', () => {
    render(<OrderBook orders={ORDERS} />);
    fireEvent.click(screen.getByText('Buy Orders'));
    expect(screen.getByText('₺1000.00')).toBeInTheDocument();
    expect(screen.queryByText('₺500.00')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Completed'));
    expect(screen.getByText('₺200.00')).toBeInTheDocument();
    expect(screen.queryByText('₺1000.00')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('All Orders'));
    expect(screen.getByText('₺1000.00')).toBeInTheDocument();
  });

  test('row click calls onOrderSelect', () => {
    const onOrderSelect = jest.fn();
    render(<OrderBook orders={ORDERS} onOrderSelect={onOrderSelect} />);
    fireEvent.click(screen.getByText('₺1000.00'));
    expect(onOrderSelect).toHaveBeenCalledWith(ORDERS[0]);
  });

  test('match button confirms via window.confirm', () => {
    const onOrderMatch = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);
    render(<OrderBook orders={ORDERS} onOrderMatch={onOrderMatch} />);
    fireEvent.click(screen.getByText('Match'));
    expect(window.confirm).toHaveBeenCalled();
    expect(onOrderMatch).toHaveBeenCalledWith(1);
  });

  test('declined confirmation does not match', () => {
    const onOrderMatch = jest.fn();
    window.confirm = jest.fn().mockReturnValue(false);
    render(<OrderBook orders={ORDERS} onOrderMatch={onOrderMatch} />);
    fireEvent.click(screen.getByText('Match'));
    expect(onOrderMatch).not.toHaveBeenCalled();
  });

  test('no match buttons for my orders; View button on matched', () => {
    const onOrderSelect = jest.fn();
    render(<OrderBook orders={ORDERS} isMyOrders onOrderSelect={onOrderSelect} />);
    expect(screen.queryByText('Match')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('View'));
    expect(onOrderSelect).toHaveBeenCalledWith(ORDERS[1]);
  });

  test('handles orders with missing paymentMethods array', () => {
    render(<OrderBook orders={[{ id: 9, type: 'buy', status: 'open', tryAmount: '1', xrpAmount: '1', rate: '2', createdAt: '2026-01-01' }]} />);
    expect(screen.getByText('₺1.00')).toBeInTheDocument();
    expect(screen.getByText('₺2.00')).toBeInTheDocument();
  });
});
