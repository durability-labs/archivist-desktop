use crate::error::Result;
use crate::node_api::{
    Availability, AvailabilityRequest, NodeApiClient, Purchase, SalesSlot, StorageRequestParams,
};

/// Service layer for marketplace operations.
/// Thin wrapper around NodeApiClient marketplace endpoints.
pub struct MarketplaceService {
    api_client: NodeApiClient,
}

impl MarketplaceService {
    pub fn new(api_client: NodeApiClient) -> Self {
        Self { api_client }
    }

    // ── Provider (sales) ────────────────────────────────────────────

    /// List active sales slots
    pub async fn get_sales_slots(&self) -> Result<Vec<SalesSlot>> {
        self.api_client.get_sales_slots().await
    }

    /// Get availability offers
    pub async fn get_availability(&self) -> Result<Vec<Availability>> {
        self.api_client.get_availability().await
    }

    /// Publish a new availability offer
    pub async fn set_availability(
        &self,
        total_size: String,
        duration: String,
        min_price: String,
        max_collateral: String,
    ) -> Result<Availability> {
        let req = AvailabilityRequest {
            total_size,
            duration,
            min_price,
            max_collateral,
        };
        self.api_client.post_availability(&req).await
    }

    // ── Client (purchasing) ─────────────────────────────────────────

    /// Create a storage request for a CID
    pub async fn create_storage_request(
        &self,
        cid: &str,
        params: StorageRequestParams,
    ) -> Result<Purchase> {
        self.api_client.create_storage_request(cid, &params).await
    }

    /// List all purchases
    pub async fn get_purchases(&self) -> Result<Vec<Purchase>> {
        self.api_client.get_purchases().await
    }

    /// Get a specific purchase
    pub async fn get_purchase(&self, id: &str) -> Result<Purchase> {
        self.api_client.get_purchase(id).await
    }
}
