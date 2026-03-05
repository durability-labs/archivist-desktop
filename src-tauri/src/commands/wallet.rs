use crate::error::Result;
use crate::services::wallet::{WalletBalances, WalletInfo};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_wallet_info(state: State<'_, AppState>) -> Result<WalletInfo> {
    let wallet = state.wallet.read().await;
    let mut info = wallet.get_wallet_info().await?;
    drop(wallet);

    // If wallet is unlocked but marketplace isn't active, check if the contract exists on-chain
    if info.has_key && info.is_unlocked && !info.marketplace_active {
        let config = state.config.read().await;
        let app_config = config.get();
        let rpc_url = app_config.blockchain.rpc_url.clone();
        let contract = app_config.blockchain.marketplace_contract.clone();
        drop(config);

        let available = super::node::is_marketplace_contract_available(&rpc_url, &contract).await;
        info.marketplace_unavailable = !available;
    }

    Ok(info)
}

#[tauri::command]
pub async fn generate_wallet(state: State<'_, AppState>, password: String) -> Result<WalletInfo> {
    let mut wallet = state.wallet.write().await;
    wallet.generate_wallet(&password)
}

#[tauri::command]
pub async fn import_wallet(
    state: State<'_, AppState>,
    private_key: String,
    password: String,
) -> Result<WalletInfo> {
    let mut wallet = state.wallet.write().await;
    wallet.import_wallet(&private_key, &password)
}

#[tauri::command]
pub async fn export_wallet(state: State<'_, AppState>, password: String) -> Result<String> {
    let wallet = state.wallet.read().await;
    wallet.export_wallet(&password)
}

#[tauri::command]
pub async fn unlock_wallet(state: State<'_, AppState>, password: String) -> Result<WalletInfo> {
    let mut wallet = state.wallet.write().await;
    wallet.unlock_wallet(&password)
}

#[tauri::command]
pub async fn delete_wallet(state: State<'_, AppState>) -> Result<()> {
    let mut wallet = state.wallet.write().await;
    wallet.delete_wallet()
}

#[tauri::command]
pub async fn get_wallet_balances(state: State<'_, AppState>) -> Result<WalletBalances> {
    let wallet = state.wallet.read().await;
    wallet.get_balances().await
}
