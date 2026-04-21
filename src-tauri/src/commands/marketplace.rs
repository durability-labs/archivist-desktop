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
    maximum_duration: String,
    minimum_price_per_byte_per_second: String,
    maximum_collateral_per_byte: String,
    available_until: Option<u64>,
) -> Result<Availability> {
    let marketplace = state.marketplace.read().await;
    marketplace
        .set_availability(
            maximum_duration,
            minimum_price_per_byte_per_second,
            maximum_collateral_per_byte,
            available_until,
        )
        .await
}

// ── Client commands ─────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_storage_request(
    state: State<'_, AppState>,
    cid: String,
    duration: String,
    proof_probability: String,
    price_per_byte_per_second: String,
    collateral_per_byte: String,
    nodes: u64,
    tolerance: u64,
    expiry: u64,
) -> Result<String> {
    let params = StorageRequestParams {
        duration,
        proof_probability,
        price_per_byte_per_second,
        collateral_per_byte,
        nodes,
        tolerance,
        expiry,
    };
    let marketplace = state.marketplace.read().await;
    marketplace.create_storage_request(&cid, params).await
}

#[tauri::command]
pub async fn get_purchases(state: State<'_, AppState>) -> Result<Vec<String>> {
    let marketplace = state.marketplace.read().await;
    marketplace.get_purchases().await
}

#[tauri::command]
pub async fn get_purchase(state: State<'_, AppState>, id: String) -> Result<Purchase> {
    let marketplace = state.marketplace.read().await;
    marketplace.get_purchase(&id).await
}
