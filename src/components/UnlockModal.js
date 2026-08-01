import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import theme from '../theme';

/**
 * UnlockModal — proper password/PIN entry replacing window.prompt (M1).
 * One component gates every password moment: wallet unlock, encrypted
 * export, first-save. Rendered by XRPLProvider; driven via askPassword().
 */
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 20, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 2000;
  @media (min-width: 640px) {
    align-items: center;
  }
`;

const Sheet = styled.div`
  background: ${theme.color.paper};
  width: 100%;
  max-width: 420px;
  border-radius: ${theme.radius.sheet} ${theme.radius.sheet} 0 0;
  padding: 32px 28px 36px;
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
  margin: 0 0 24px;
  white-space: pre-line;
`;

const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  height: 56px;
  border: none;
  border-radius: ${theme.radius.input};
  background: ${theme.color.surface};
  padding: 0 18px;
  font-size: 16px;
  font-family: ${theme.font.stack};
  color: ${theme.color.ink};
  outline: none;
  &:focus { box-shadow: 0 0 0 2px ${theme.color.signal}; }
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
`;

const UnlockModal = ({ title, description, confirmLabel = 'Confirm', allowEmpty = false, onSubmit, onCancel }) => {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue('');
  }, [title]);

  const submit = () => {
    if (!value && !allowEmpty) return;
    onSubmit(value);
  };

  return (
    <Overlay onClick={onCancel}>
      <Sheet onClick={(e) => e.stopPropagation()}>
        <Handle />
        <Title>{title}</Title>
        {description && <Description>{description}</Description>}
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Password"
            aria-label="Password"
          />
          <Actions>
            <Button type="button" onClick={onCancel}>Cancel</Button>
            <Button type="submit" $primary disabled={!value && !allowEmpty}>
              {confirmLabel}
            </Button>
          </Actions>
        </form>
      </Sheet>
    </Overlay>
  );
};

export default UnlockModal;
