use crate::error::Result;
use crate::services::wallet::WalletInfo;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_wallet_info(state: State<'_, AppState>) -> Result<WalletInfo> {
    let wallet = state.wallet.read().await;
    wallet.get_wallet_info().await
}
