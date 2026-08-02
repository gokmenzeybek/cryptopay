import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import styled from 'styled-components';
import Header from './components/Header';
import TabBar from './components/TabBar';
import Home from './components/Home';
import Activity from './components/Activity';
import SendFlow from './components/SendFlow';
import Wallet from './components/Wallet';
import RequestFlow from './components/RequestFlow';
import Dashboard from './components/Dashboard';
import P2PExchange from './components/P2PExchange';
import InlineNotice from './components/InlineNotice';
import { XRPLProvider } from './hooks/useXRPL';
import theme from './theme';
import { SpeedInsights } from '@vercel/speed-insights/react';

// Paper-first shell (M1, UI_DESIGN §3/§11): the app is mobile-first and
// centers in a readable column on desktop; legacy wide screens (Convert)
// still get room via the larger max-width on wide viewports.
const AppContainer = styled.div`
  min-height: 100vh;
  background: ${theme.color.paper};
  font-family: ${theme.font.stack};
  padding: 20px;
`;

const MainContent = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  background: ${theme.color.paper};
`;

const Content = styled.div`
  padding: 1.5rem 0.5rem 6rem;
`;

function App() {
  return (
    <XRPLProvider>
      <AppContainer>
        <MainContent>
          <Header />
          <Content>
            <InlineNotice />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/pay" element={<SendFlow />} />
              <Route path="/request" element={<RequestFlow />} />
              <Route path="/p2p" element={<P2PExchange />} />
              <Route path="/settings" element={<Wallet />} />
              {/* Legacy routes kept as redirects (M1 navigation rework) */}
              <Route path="/payment" element={<Navigate to="/pay" replace />} />
              <Route path="/scanner" element={<Navigate to="/pay?scan=1" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
            </Routes>
          </Content>
          <TabBar />
          <SpeedInsights />
        </MainContent>
      </AppContainer>
    </XRPLProvider>
  );
}

export default App;
