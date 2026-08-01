import React from 'react';
import styled from 'styled-components';
import ActivityList from './ActivityList';
import theme from '../theme';

/**
 * Activity — standalone receipt-style activity feed (UI_DESIGN §5.1 tab bar).
 * Renders the same merged list as Home, but as its own destination so the
 * Home and Activity tabs highlight independently.
 */
const Wrap = styled.div`
  max-width: 26.25rem;
  margin: 0 auto;
  font-family: ${theme.font.stack};
`;

const Title = styled.h2`
  font-size: 1.375rem;
  font-weight: 700;
  color: ${theme.color.ink};
  margin-bottom: 1rem;
`;

const Activity = () => (
  <Wrap>
    <Title>Activity</Title>
    <ActivityList />
  </Wrap>
);

export default Activity;
