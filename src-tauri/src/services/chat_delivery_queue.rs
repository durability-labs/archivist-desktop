//! Delivery queue with exponential backoff retry.
//!
//! Follows the retry pattern from `backup_daemon.rs`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// A pending delivery attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDelivery {
    pub message_id: String,
    pub conversation_id: String,
    pub target_peer_id: String,
    pub target_address: String,
    pub target_port: u16,
    pub endpoint: String,
    pub payload: String,
    pub retry_count: u32,
    pub max_retries: u32,
    pub last_attempt: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl PendingDelivery {
    /// Compute backoff delay: 5s, 15s, 45s, 2min, 5min, then capped at 5min.
    fn backoff_duration(&self) -> Duration {
        let secs = match self.retry_count {
            0 => 0,
            1 => 5,
            2 => 15,
            3 => 45,
            4 => 120,
            _ => 300,
        };
        Duration::from_secs(secs)
    }

    fn is_ready_for_retry(&self) -> bool {
        if let Some(last) = self.last_attempt {
            let elapsed = Utc::now().signed_duration_since(last);
            elapsed.to_std().unwrap_or(Duration::ZERO) >= self.backoff_duration()
        } else {
            true // Never attempted
        }
    }
}

/// Manages a queue of pending message deliveries.
pub struct DeliveryQueue {
    pending: Vec<PendingDelivery>,
    client: reqwest::Client,
}

impl DeliveryQueue {
    pub fn new() -> Self {
        // Build a client that accepts self-signed certs (we verify via TOFU)
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Failed to create delivery HTTP client");

        Self {
            pending: Vec::new(),
            client,
        }
    }

    /// Enqueue a delivery.
    pub fn enqueue(&mut self, delivery: PendingDelivery) {
        log::info!(
            "Enqueued delivery {} to {} (endpoint: {})",
            delivery.message_id,
            delivery.target_peer_id,
            delivery.endpoint
        );
        self.pending.push(delivery);
    }

    /// Process the queue: attempt delivery for all ready items.
    /// Returns (delivered_msg_ids, failed_msg_ids_with_errors).
    pub async fn process(&mut self) -> (Vec<(String, String)>, Vec<(String, String, String)>) {
        let mut delivered = Vec::new();
        let mut failed = Vec::new();

        let mut i = 0;
        while i < self.pending.len() {
            let item = &self.pending[i];
            if !item.is_ready_for_retry() {
                i += 1;
                continue;
            }

            let url = format!(
                "https://{}:{}/{}",
                item.target_address, item.target_port, item.endpoint
            );

            let result = self
                .client
                .post(&url)
                .header("Content-Type", "application/json")
                .body(item.payload.clone())
                .send()
                .await;

            match result {
                Ok(resp) if resp.status().is_success() => {
                    log::info!(
                        "Delivered message {} to {}",
                        item.message_id,
                        item.target_peer_id
                    );
                    delivered.push((item.message_id.clone(), item.conversation_id.clone()));
                    self.pending.remove(i);
                    // Don't increment i — next item shifted into this slot
                }
                Ok(resp) => {
                    let status = resp.status();
                    log::warn!(
                        "Delivery of {} failed: HTTP {} (retry {}/{})",
                        item.message_id,
                        status,
                        item.retry_count + 1,
                        item.max_retries
                    );
                    let item = &mut self.pending[i];
                    item.retry_count += 1;
                    item.last_attempt = Some(Utc::now());
                    if item.retry_count >= item.max_retries {
                        let msg_id = item.message_id.clone();
                        let conv_id = item.conversation_id.clone();
                        let err = format!("HTTP {}", status);
                        failed.push((msg_id, conv_id, err));
                        self.pending.remove(i);
                    } else {
                        i += 1;
                    }
                }
                Err(e) => {
                    log::warn!(
                        "Delivery of {} failed: {} (retry {}/{})",
                        self.pending[i].message_id,
                        e,
                        self.pending[i].retry_count + 1,
                        self.pending[i].max_retries
                    );
                    let item = &mut self.pending[i];
                    item.retry_count += 1;
                    item.last_attempt = Some(Utc::now());
                    if item.retry_count >= item.max_retries {
                        let msg_id = item.message_id.clone();
                        let conv_id = item.conversation_id.clone();
                        let err = e.to_string();
                        failed.push((msg_id, conv_id, err));
                        self.pending.remove(i);
                    } else {
                        i += 1;
                    }
                }
            }
        }

        (delivered, failed)
    }

    #[allow(dead_code)]
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    #[allow(dead_code)]
    pub fn has_pending_for(&self, peer_id: &str) -> bool {
        self.pending.iter().any(|p| p.target_peer_id == peer_id)
    }
}

impl Default for DeliveryQueue {
    fn default() -> Self {
        Self::new()
    }
}
