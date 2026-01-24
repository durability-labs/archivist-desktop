import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useFeatures } from './hooks/useFeatures';
import { useSoundNotifications } from './hooks/useSoundNotifications';
import { useOnboarding } from './hooks/useOnboarding';
import NavAccordion from './components/NavAccordion';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Files from './pages/Files';
import Sync from './pages/Sync';
import Peers from './pages/Peers';
import Logs from './pages/Logs';
import BackupServer from './pages/BackupServer';
import Settings from './pages/Settings';
import Devices from './pages/Devices';
import AddDevice from './pages/AddDevice';
import logoSvg from './assets/logo.svg';
import './styles/App.css';

const REDIRECT_AFTER_ONBOARDING_KEY = 'archivist_redirect_to_dashboard';

// Component that handles redirect after onboarding (must be inside Router)
function OnboardingRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const shouldRedirect = localStorage.getItem(REDIRECT_AFTER_ONBOARDING_KEY);
    if (shouldRedirect === 'true') {
      localStorage.removeItem(REDIRECT_AFTER_ONBOARDING_KEY);
      // Only redirect if not already on dashboard
      if (location.pathname !== '/') {
        navigate('/', { replace: true });
      }
    }
  }, [navigate, location.pathname]);

  return null;
}

function App() {
  const { marketplaceEnabled } = useFeatures();
  useSoundNotifications(); // Enable sound notifications globally
  const { showOnboarding, loading, completeOnboarding, skipOnboarding } = useOnboarding();

  // Wrapper for completeOnboarding that sets redirect flag
  const handleCompleteOnboarding = () => {
    localStorage.setItem(REDIRECT_AFTER_ONBOARDING_KEY, 'true');
    completeOnboarding();
  };

  // Wrapper for skipOnboarding that sets redirect flag
  const handleSkipOnboarding = () => {
    localStorage.setItem(REDIRECT_AFTER_ONBOARDING_KEY, 'true');
    skipOnboarding();
  };

  // Show loading state while checking onboarding status
  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  // Show onboarding for first-run users
  if (showOnboarding) {
    return (
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Onboarding onComplete={handleCompleteOnboarding} onSkip={handleSkipOnboarding} />
      </Router>
    );
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <OnboardingRedirect />
      <div className="app">
        <aside className="sidebar">
          <div className="logo">
            <img src={logoSvg} alt="Archivist" className="logo-img" />
            <span className="logo-text">Archivist</span>
          </div>
          <nav className="nav">
            {/* Primary navigation */}
            <NavLink to="/" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Dashboard
            </NavLink>
            <NavLink to="/sync" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Backups
            </NavLink>
            <NavLink to="/files" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Restore
            </NavLink>

            {/* Devices section */}
            <div className="nav-section-label">Devices</div>
            <NavLink to="/devices" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              My Devices
            </NavLink>
            <NavLink to="/devices/add" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              Add Device
            </NavLink>

            {/* Advanced section - collapsible */}
            <NavAccordion title="Advanced" storageKey="nav-advanced-open" defaultOpen={false}>
              <NavLink to="/logs" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                Logs
              </NavLink>
              <NavLink to="/backup-server" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                Backup Server
              </NavLink>
              <NavLink to="/settings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                Settings
              </NavLink>
            </NavAccordion>

            {/* V2 - Only shown when marketplace feature enabled */}
            {marketplaceEnabled && (
              <NavAccordion title="Marketplace" storageKey="nav-marketplace-open" defaultOpen={false}>
                <NavLink to="/marketplace" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                  Browse
                </NavLink>
                <NavLink to="/marketplace/deals" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                  My Deals
                </NavLink>
                <NavLink to="/wallet" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
                  Wallet
                </NavLink>
              </NavAccordion>
            )}
          </nav>
        </aside>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/files" element={<Files />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/devices/add" element={<AddDevice />} />
            <Route path="/peers" element={<Peers />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/backup-server" element={<BackupServer />} />
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
