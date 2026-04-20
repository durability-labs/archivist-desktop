/**
 * Regression tests for the Marketplace "Publish Availability" flow.
 *
 * Background: archivist-node main branch (commit ba37d61) replaced the v0.2.0
 * availability schema. The old shape with `duration`, `totalSize`,
 * `totalCollateral`, `minPricePerBytePerSecond`, `maxCollateralPerByte` causes
 * the API to return "HTTP 422 Unprocessable Entity — maximumDuration must be
 * larger than zero". These tests pin the wire format so that regression can't
 * silently reappear.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { ToastProvider } from '../contexts/ToastContext';
import Marketplace from '../pages/Marketplace';

vi.mock('../hooks/useWallet', () => ({
  useWallet: () => ({
    wallet: { hasKey: true, marketplaceActive: true, isUnlocked: true, marketplaceUnavailable: false },
    loading: false,
  }),
}));

const mockedInvoke = vi.mocked(invoke);

function renderMarketplace() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case 'get_sales_slots':
        return Promise.resolve([]);
      case 'get_availability':
        return Promise.resolve([]);
      case 'get_purchases':
        return Promise.resolve([]);
      case 'list_files':
        return Promise.resolve({ files: [] });
      case 'set_availability':
        return Promise.resolve({
          maximumDuration: '86400',
          minimumPricePerBytePerSecond: '1',
          maximumCollateralPerByte: '1',
          availableUntil: 0,
        });
      default:
        return Promise.reject(new Error(`unmocked command: ${cmd}`));
    }
  });
});

describe('Marketplace — Publish Availability wire format', () => {
  it('sends maximumDuration (not duration) when submitting availability', async () => {
    renderMarketplace();

    // Wait for initial load
    await act(async () => {
      await Promise.resolve();
    });

    const publishBtn = await screen.findByRole('button', { name: /publish availability/i });
    await userEvent.click(publishBtn);

    // Find the set_availability call among all invocations
    const call = mockedInvoke.mock.calls.find(([cmd]) => cmd === 'set_availability');
    expect(call, 'set_availability should have been invoked').toBeTruthy();

    const payload = call![1] as Record<string, unknown>;

    // REQUIRED new-schema fields
    expect(payload).toHaveProperty('maximumDuration');
    expect(payload).toHaveProperty('minimumPricePerBytePerSecond');
    expect(payload).toHaveProperty('maximumCollateralPerByte');

    // REMOVED v0.2.0 fields — these MUST NOT appear
    expect(payload).not.toHaveProperty('duration');
    expect(payload).not.toHaveProperty('totalSize');
    expect(payload).not.toHaveProperty('totalCollateral');
    expect(payload).not.toHaveProperty('minPricePerBytePerSecond');
    expect(payload).not.toHaveProperty('maxCollateralPerByte');
  });

  it('sends a non-zero maximumDuration by default (422 guard)', async () => {
    renderMarketplace();

    await act(async () => {
      await Promise.resolve();
    });

    const publishBtn = await screen.findByRole('button', { name: /publish availability/i });
    await userEvent.click(publishBtn);

    const call = mockedInvoke.mock.calls.find(([cmd]) => cmd === 'set_availability');
    const payload = call![1] as Record<string, unknown>;

    // The v0.2.0 bug symptom was an API error:
    //   "maximumDuration must be larger than zero"
    // Default form value must be a positive integer (seconds).
    const duration = Number(payload.maximumDuration);
    expect(duration).toBeGreaterThan(0);
  });

  it('renders the Current Availability table with new-schema columns', async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_availability') {
        return Promise.resolve([
          {
            maximumDuration: '86400',
            minimumPricePerBytePerSecond: '2',
            maximumCollateralPerByte: '5',
            availableUntil: 0,
          },
        ]);
      }
      if (cmd === 'get_sales_slots') return Promise.resolve([]);
      if (cmd === 'get_purchases') return Promise.resolve([]);
      if (cmd === 'list_files') return Promise.resolve({ files: [] });
      return Promise.reject(new Error(`unmocked: ${cmd}`));
    });

    renderMarketplace();

    // New columns — present
    expect(await screen.findByText(/max duration/i)).toBeInTheDocument();
    expect(await screen.findByText(/min price\/byte\/s/i)).toBeInTheDocument();
    expect(await screen.findByText(/max collateral\/byte/i)).toBeInTheDocument();
    expect(await screen.findByText(/available until/i)).toBeInTheDocument();

    // Old columns — must not be present
    expect(screen.queryByText(/^ID$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/total size/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/free size/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/total collateral/i)).not.toBeInTheDocument();
  });
});
