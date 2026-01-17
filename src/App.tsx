import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import { useFeatures } from './hooks/useFeatures';
import Dashboard from './pages/Dashboard';
import Files from './pages/Files';
import Sync from './pages/Sync';
import Peers from './pages/Peers';
import Settings from './pages/Settings';
import logoSvg from './assets/logo.svg';
import './styles/App.css';

function App() {
  const { marketplaceEnabled } = useFeatures();

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app">
        <aside className="sidebar">
          <div className="logo">
            <img src={logoSvg} alt="Archivist" className="logo-img" />
            <span className="logo-text">Archivist</span>
          </div>
          <nav className="nav">
            <NavLink to="/" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Dashboard
            </NavLink>
            <NavLink to="/files" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Files
            </NavLink>
            <NavLink to="/sync" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Sync
            </NavLink>
            <NavLink to="/peers" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Peers
            </NavLink>

            {/* V2 - Only shown when marketplace feature enabled */}
            {marketplaceEnabled && (
              <>
                <div className="nav-divider">Marketplace</div>
                <NavLink to="/marketplace" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                  Browse
                </NavLink>
                <NavLink to="/marketplace/deals" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                  My Deals
                </NavLink>
                <NavLink to="/wallet" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                  Wallet
                </NavLink>
              </>
            )}

            <NavLink to="/settings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Settings
            </NavLink>
          </nav>
        </aside>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/files" element={<Files />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="/peers" element={<Peers />} />
            <Route path="/settings" element={<Settings />} />

            {/* V2 routes - placeholder for marketplace */}
            {marketplaceEnabled && (
              <>
                <Route path="/marketplace" element={<div>Marketplace - Coming in v2</div>} />
                <Route path="/marketplace/deals" element={<div>My Deals - Coming in v2</div>} />
                <Route path="/wallet" element={<div>Wallet - Coming in v2</div>} />
              </>
            )}
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
