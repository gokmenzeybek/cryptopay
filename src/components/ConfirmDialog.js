import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import theme from '../theme';

/**
 * ConfirmDialog — token-styled bottom sheet for quick decisions, replacing
 * browser chrome dialogs (window.confirm / window.prompt). UI_DESIGN §6:
 * sub-tasks live in bottom sheets, never in browser chrome.
 * Optional single text input (e.g. an optional cancel reason).
 */
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 20, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 2200;
  @media (min-width: 640px) {
    align-items: center;
  }
`;

const Sheet = styled.div`
  background: ${theme.color.paper};
  width: 100%;
  max-width: 420px;
  border-radius: ${theme.radius.sheet} ${theme.radius.sheet} 0 0;
  padding: 28px 24px 32px;
  @media (min-width: 640px) {
    border-radius: ${theme.radius.sheet};
  }
`;

const Handle = styled.div`
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: ${theme.color.line};
  margin: 0 auto 24px;
  @media (min-width: 640px) { display: none; }
`;

const Title = styled.h2`
  font-family: ${theme.font.stack};
  font-size: 20px;
  font-weight: 700;
  color: ${theme.color.ink};
  margin: 0 0 8px;
`;

const Description = styled.p`
  font-size: 14px;
  line-height: 1.5;
  color: ${theme.color.inkSoft};
  margin: 0 0 20px;
  white-space: pre-line;
`;

const Label = styled.div`
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${theme.color.inkSoft};
  margin-bottom: 8px;
`;

const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  height: 52px;
  border: none;
  border-radius: ${theme.radius.input};
  background: ${theme.color.surface};
  padding: 0 16px;
  font-size: 15px;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  outline: none;
  &:focus { box-shadow: 0 0 0 2px ${theme.color.signal}; }
  &::placeholder { color: ${theme.color.inkFaint}; }
`;

const Actions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 24px;
`;

const Button = styled.button`
  flex: 1;
  height: 56px;
  border: none;
  border-radius: ${theme.radius.pill};
  font-size: 16px;
  font-weight: 600;
  font-family: ${theme.font.stack};
  cursor: pointer;
  transition: opacity ${theme.motion.fast};
  ${p => p.$primary
    ? `background: ${theme.color.ink}; color: ${theme.color.paper};`
    : `background: ${theme.color.surface}; color: ${theme.color.ink};`}
  &:hover { opacity: 0.88; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const ConfirmDialog = ({
  title,
  description,
  confirmLabel = 'Confirm',
  inputLabel,
  placeholder,
  allowEmpty = true,
  onSubmit,
  onCancel
}) => {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue('');
  }, [title]);

  const submit = (e) => {
    e.preventDefault();
    if (!allowEmpty && !value.trim()) return;
    onSubmit(value);
  };

  return (
    <Overlay onClick={onCancel}>
      <Sheet onClick={(e) => e.stopPropagation()}>
        <Handle />
        <Title>{title}</Title>
        {description && <Description>{description}</Description>}
        <form onSubmit={submit}>
          {inputLabel !== undefined && (
            <>
              <Label>{inputLabel}</Label>
              <Input
                type="text"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                aria-label={inputLabel}
              />
            </>
          )}
          <Actions>
            <Button type="button" onClick={onCancel}>Cancel</Button>
            <Button type="submit" $primary disabled={!allowEmpty && !value.trim()}>
              {confirmLabel}
            </Button>
          </Actions>
        </form>
      </Sheet>
    </Overlay>
  );
};

export default ConfirmDialog;
