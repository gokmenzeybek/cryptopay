/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import UnlockModal from '../UnlockModal';

const setup = (props = {}) => {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  render(
    <UnlockModal
      title="Unlock wallet"
      description="Enter your password"
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onSubmit, onCancel };
};

describe('UnlockModal', () => {
  test('renders title, description and default confirm label', () => {
    setup();
    expect(screen.getByText('Unlock wallet')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  test('submits the typed password via the confirm button', () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 's3cret' } });
    fireEvent.click(screen.getByText('Confirm'));
    expect(onSubmit).toHaveBeenCalledWith('s3cret');
  });

  test('submits on form submit (Enter key)', () => {
    const { onSubmit } = setup();
    const input = screen.getByLabelText('Password');
    fireEvent.change(input, { target: { value: 'pw' } });
    fireEvent.submit(input.closest('form'));
    expect(onSubmit).toHaveBeenCalledWith('pw');
  });

  test('does not submit an empty value by default', () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByText('Confirm'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm')).toBeDisabled();
  });

  test('allowEmpty permits submitting a blank value', () => {
    const { onSubmit } = setup({ allowEmpty: true });
    fireEvent.click(screen.getByText('Confirm'));
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  test('cancel button and overlay click call onCancel', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Overlay is the outermost element; clicking the sheet must not cancel
    // Overlay is the Sheet's parent (outermost fixed-position div)
    const overlay = screen.getByText('Unlock wallet').closest('div').parentElement;
    fireEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  test('clicking inside the sheet does not cancel', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByLabelText('Password'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('resets the value when the title changes', () => {
    const onSubmit = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = render(
      <UnlockModal title="One" onSubmit={onSubmit} onCancel={onCancel} />
    );
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    rerender(<UnlockModal title="Two" onSubmit={onSubmit} onCancel={onCancel} />);
    expect(screen.getByLabelText('Password').value).toBe('');
  });

  test('custom confirmLabel is rendered', () => {
    setup({ confirmLabel: 'Unlock' });
    expect(screen.getByText('Unlock')).toBeInTheDocument();
  });
});
