use crate::error::Result;
use crate::node_api::{Availability, Purchase, SalesSlot, StorageRequestParams};
use crate::state::AppState;
use tauri::State;

// ── Provider commands ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_sales_slots(state: State<'_, AppState>) -> Result<Vec<SalesSlot>> {
    let marketplace = state.marketplace.read().await;
    marketplace.get_sales_slots().await
}

#[tauri::command]
pub async fn get_availability(state: State<'_, AppState>) -> Result<Vec<Availability>> {
    let marketplace = state.marketplace.read().await;
    marketplace.get_availability().await
}

#[tauri::command]
pub async fn set_availability(
    state: State<'_, AppState>,
    total_size: String,
    duration: String,
    min_price: String,
    max_collateral: String,
) -> Result<Availability> {
    let marketplace = state.marketplace.read().await;
    marketplace
        .set_availability(total_size, duration, min_price, max_collateral)
        .await
}

// ── Client commands ─────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_storage_request(
    state: State<'_, AppState>,
    cid: String,
    duration: String,
    price_per_byte_per_second: String,
    collateral_per_byte: String,
    slots: u64,
    slot_size: u64,
    max_slot_loss: u64,
    expiry: u64,
) -> Result<Purchase> {
    let params = StorageRequestParams {
        duration,
        price_per_byte_per_second,
        collateral_per_byte,
        slots,
        slot_size,
        max_slot_loss,
        expiry,
    };
    let marketplace = state.marketplace.read().await;
    marketplace.create_storage_request(&cid, params).await
}

#[tauri::command]
pub async fn get_purchases(state: State<'_, AppState>) -> Result<Vec<Purchase>> {
    let marketplace = state.marketplace.read().await;
    marketplace.get_purchases().await
}

#[tauri::command]
pub async fn get_purchase(state: State<'_, AppState>, id: String) -> Result<Purchase> {
    let marketplace = state.marketplace.read().await;
    marketplace.get_purchase(&id).await
}
