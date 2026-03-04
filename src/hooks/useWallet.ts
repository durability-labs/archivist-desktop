import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface WalletInfo {
  address: string;
  network: string;
  hasKey: boolean;
  marketplaceActive: boolean;
}

export interface WalletBalances {
  ethBalance: string;
  tstBalance: string;
  ethBalanceRaw: string;
  tstBalanceRaw: string;
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState<'eth' | 'tst' | null>(null);
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await invoke<WalletInfo>('get_wallet_info');
      setWallet(info);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      const b = await invoke<WalletBalances>('get_wallet_balances');
      setBalances(b);
    } catch (e) {
      // Balances may fail if wallet isn't set up or node isn't running
      console.warn('Failed to fetch balances:', e);
    } finally {
      setBalancesLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-fetch balances when wallet has a key
  useEffect(() => {
    if (wallet?.hasKey && wallet.address !== '0x0000000000000000000000000000000000000000') {
      refreshBalances();
      const interval = setInterval(refreshBalances, 30000); // Refresh every 30s
      return () => clearInterval(interval);
    }
  }, [wallet?.hasKey, wallet?.address, refreshBalances]);

  const generateWallet = useCallback(async (password: string) => {
    const info = await invoke<WalletInfo>('generate_wallet', { password });
    setWallet(info);
    setError(null);
    return info;
  }, []);

  const importWallet = useCallback(async (privateKey: string, password: string) => {
    const info = await invoke<WalletInfo>('import_wallet', { privateKey, password });
    setWallet(info);
    setError(null);
    return info;
  }, []);

  const exportWallet = useCallback(async (password: string): Promise<string> => {
    return await invoke<string>('export_wallet', { password });
  }, []);

  const unlockWallet = useCallback(async (password: string) => {
    const info = await invoke<WalletInfo>('unlock_wallet', { password });
    setWallet(info);
    setError(null);
    return info;
  }, []);

  const deleteWallet = useCallback(async () => {
    await invoke('delete_wallet');
    setWallet(null);
    setBalances(null);
    await refresh();
  }, [refresh]);

  const requestEthFaucet = useCallback(async () => {
    setFaucetLoading('eth');
    setFaucetMessage(null);
    try {
      const result = await invoke<string>('request_eth_faucet');
      setFaucetMessage(`ETH faucet: ${result || 'Request sent successfully'}`);
      // Refresh balances after a delay to allow tx to confirm
      setTimeout(refreshBalances, 5000);
      return result;
    } catch (e) {
      setFaucetMessage(`ETH faucet error: ${String(e)}`);
      throw e;
    } finally {
      setFaucetLoading(null);
    }
  }, [refreshBalances]);

  const requestTstFaucet = useCallback(async () => {
    setFaucetLoading('tst');
    setFaucetMessage(null);
    try {
      const result = await invoke<string>('request_tst_faucet');
      setFaucetMessage(`TST faucet: ${result || 'Request sent successfully'}`);
      setTimeout(refreshBalances, 5000);
      return result;
    } catch (e) {
      setFaucetMessage(`TST faucet error: ${String(e)}`);
      throw e;
    } finally {
      setFaucetLoading(null);
    }
  }, [refreshBalances]);

  return {
    wallet,
    balances,
    loading,
    error,
    balancesLoading,
    faucetLoading,
    faucetMessage,
    refresh,
    refreshBalances,
    generateWallet,
    importWallet,
    exportWallet,
    unlockWallet,
    deleteWallet,
    requestEthFaucet,
    requestTstFaucet,
  };
}
