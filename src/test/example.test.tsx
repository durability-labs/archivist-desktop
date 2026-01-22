import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

// Mock the useFeatures hook
vi.mock('../hooks/useFeatures', () => ({
  useFeatures: () => ({ marketplaceEnabled: false }),
}));

// Mock the useOnboarding hook to skip onboarding
vi.mock('../hooks/useOnboarding', () => ({
  useOnboarding: () => ({
    showOnboarding: false,
    loading: false,
    completeOnboarding: vi.fn(),
    skipOnboarding: vi.fn(),
  }),
}));

// Mock the useSoundNotifications hook
vi.mock('../hooks/useSoundNotifications', () => ({
  useSoundNotifications: () => {},
}));

// Mock the page components to avoid complex rendering
vi.mock('../pages/Dashboard', () => ({
  default: () => <div data-testid="dashboard">Dashboard</div>,
}));

vi.mock('../pages/Files', () => ({
  default: () => <div data-testid="files">Files</div>,
}));

vi.mock('../pages/Sync', () => ({
  default: () => <div data-testid="sync">Sync</div>,
}));

vi.mock('../pages/Peers', () => ({
  default: () => <div data-testid="peers">Peers</div>,
}));

vi.mock('../pages/Logs', () => ({
  default: () => <div data-testid="logs">Logs</div>,
}));

vi.mock('../pages/BackupServer', () => ({
  default: () => <div data-testid="backup-server">Backup Server</div>,
}));

vi.mock('../pages/Settings', () => ({
  default: () => <div data-testid="settings">Settings</div>,
}));

vi.mock('../pages/Devices', () => ({
  default: () => <div data-testid="devices">Devices</div>,
}));

vi.mock('../pages/AddDevice', () => ({
  default: () => <div data-testid="add-device">Add Device</div>,
}));

vi.mock('../pages/Onboarding', () => ({
  default: () => <div data-testid="onboarding">Onboarding</div>,
}));

describe('App', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  it('renders without crashing', () => {
    // App component contains its own Router, so we don't wrap it
    render(<App />);
    // Basic smoke test - just verify the app renders
    expect(document.body).toBeTruthy();
  });

  it('has navigation elements', () => {
    render(<App />);
    // Check for navigation links
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
  });

  it('shows the logo', () => {
    render(<App />);
    expect(screen.getByText('Archivist')).toBeInTheDocument();
  });

  it('has primary navigation links', () => {
    render(<App />);
    // Check primary navigation links (renamed in UI/UX overhaul)
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Backups' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Devices' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add Device' })).toBeInTheDocument();
  });

  it('renders Dashboard by default', () => {
    render(<App />);
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });
});
