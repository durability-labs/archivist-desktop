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

    /// Publish a new availability offer.
    ///
    /// archivist-node main branch (ba37d61+) only supports three required
    /// fields plus an optional `availableUntil`. `totalSize` and
    /// `totalCollateral` from the v0.2.0 API are no longer accepted.
    pub async fn set_availability(
        &self,
        maximum_duration: String,
        minimum_price_per_byte_per_second: String,
        maximum_collateral_per_byte: String,
        available_until: Option<u64>,
    ) -> Result<Availability> {
        let req = AvailabilityRequest {
            maximum_duration,
            minimum_price_per_byte_per_second,
            maximum_collateral_per_byte,
            available_until: available_until.unwrap_or(0),
        };
        self.api_client.post_availability(&req).await
    }

    // ── Client (purchasing) ─────────────────────────────────────────

    /// Create a storage request for a CID (returns request ID string)
    pub async fn create_storage_request(
        &self,
        cid: &str,
        params: StorageRequestParams,
    ) -> Result<String> {
        self.api_client.create_storage_request(cid, &params).await
    }

    /// List all purchases (returns list of purchase ID strings)
    pub async fn get_purchases(&self) -> Result<Vec<String>> {
        self.api_client.get_purchases().await
    }

    /// Get a specific purchase
    pub async fn get_purchase(&self, id: &str) -> Result<Purchase> {
        self.api_client.get_purchase(id).await
    }
}
