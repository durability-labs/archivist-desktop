use crate::error::{ArchivistError, Result};
use crate::node_api::NodeApiClient;
use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use k256::ecdsa::SigningKey;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest as Sha2Digest, Sha256};
use sha3::Keccak256;
use std::path::PathBuf;
use zeroize::Zeroize;

const KEYSTORE_FILENAME: &str = "keystore.json";
const KDF_ITERATIONS: u32 = 100_000;
const KEYSTORE_VERSION: u32 = 1;

/// Wallet info returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletInfo {
    pub address: String,
    pub network: String,
    pub has_key: bool,
    pub marketplace_active: bool,
    pub is_unlocked: bool,
}

/// Token balances returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletBalances {
    /// ETH balance formatted (e.g., "0.05")
    pub eth_balance: String,
    /// TST token balance formatted (e.g., "100.0")
    pub tst_balance: String,
    /// Raw ETH balance in wei (hex)
    pub eth_balance_raw: String,
    /// Raw TST balance in smallest unit (hex)
    pub tst_balance_raw: String,
}

/// Encrypted keystore file format
#[derive(Debug, Clone, Serialize, Deserialize)]
struct EncryptedKeystore {
    version: u32,
    address: String,
    salt: String,
    nonce: String,
    ciphertext: String,
    iterations: u32,
}

/// Wallet service: key generation, encrypted storage, balance queries, faucet
pub struct WalletService {
    api_client: NodeApiClient,
    network: String,
    rpc_url: String,
    token_contract: String,
    keystore_dir: PathBuf,
    /// Cached decrypted private key (hex, without 0x prefix)
    cached_private_key: Option<String>,
    /// Cached ETH address (with 0x prefix)
    cached_address: Option<String>,
}

impl WalletService {
    pub fn new(
        api_client: NodeApiClient,
        network: String,
        rpc_url: String,
        token_contract: String,
        keystore_dir: PathBuf,
    ) -> Self {
        let mut svc = Self {
            api_client,
            network,
            rpc_url,
            token_contract,
            keystore_dir,
            cached_private_key: None,
            cached_address: None,
        };

        // Try to load existing keystore address (not the key itself)
        if let Ok(ks) = svc.load_keystore() {
            svc.cached_address = Some(ks.address);
        }

        svc
    }

    // ── Key Generation ──────────────────────────────────────────────

    /// Generate a new ETH keypair and store it encrypted
    pub fn generate_wallet(&mut self, password: &str) -> Result<WalletInfo> {
        if self.keystore_exists() {
            return Err(ArchivistError::WalletError(
                "Wallet already exists. Import or delete the existing wallet first.".into(),
            ));
        }

        // Generate random 32-byte private key
        let mut key_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key_bytes);

        let private_key_hex = hex::encode(key_bytes);
        let address = Self::derive_eth_address(&key_bytes)?;

        // Encrypt and store
        self.save_keystore(&private_key_hex, &address, password)?;

        // Cache in memory
        self.cached_private_key = Some(private_key_hex);
        self.cached_address = Some(address.clone());

        // Zeroize the raw bytes
        key_bytes.zeroize();

        log::info!("Generated new wallet with address: {}", address);

        Ok(WalletInfo {
            address,
            network: self.network.clone(),
            has_key: true,
            marketplace_active: false, // Will be true after node restart with key
            is_unlocked: true,
        })
    }

    /// Import an existing private key (hex, with or without 0x prefix)
    pub fn import_wallet(&mut self, private_key_hex: &str, password: &str) -> Result<WalletInfo> {
        if self.keystore_exists() {
            return Err(ArchivistError::WalletError(
                "Wallet already exists. Delete the existing wallet first.".into(),
            ));
        }

        let clean_key = private_key_hex
            .strip_prefix("0x")
            .unwrap_or(private_key_hex);

        // Validate key format
        if clean_key.len() != 64 {
            return Err(ArchivistError::WalletError(
                "Private key must be 64 hex characters (32 bytes)".into(),
            ));
        }

        let key_bytes = hex::decode(clean_key)
            .map_err(|_| ArchivistError::WalletError("Invalid hex in private key".into()))?;

        // Verify it's a valid secp256k1 key
        SigningKey::from_bytes(key_bytes.as_slice().into())
            .map_err(|_| ArchivistError::WalletError("Invalid secp256k1 private key".into()))?;

        let address = Self::derive_eth_address(&key_bytes)?;
        self.save_keystore(clean_key, &address, password)?;

        self.cached_private_key = Some(clean_key.to_string());
        self.cached_address = Some(address.clone());

        log::info!("Imported wallet with address: {}", address);

        Ok(WalletInfo {
            address,
            network: self.network.clone(),
            has_key: true,
            marketplace_active: false,
            is_unlocked: true,
        })
    }

    /// Unlock the wallet with password (load private key into memory)
    pub fn unlock_wallet(&mut self, password: &str) -> Result<WalletInfo> {
        let ks = self.load_keystore()?;
        let private_key_hex = self.decrypt_keystore(&ks, password)?;

        self.cached_private_key = Some(private_key_hex);
        self.cached_address = Some(ks.address.clone());

        log::info!("Wallet unlocked: {}", ks.address);

        Ok(WalletInfo {
            address: ks.address,
            network: self.network.clone(),
            has_key: true,
            marketplace_active: false,
            is_unlocked: true,
        })
    }

    /// Export the private key (requires password to decrypt)
    pub fn export_wallet(&self, password: &str) -> Result<String> {
        let ks = self.load_keystore()?;
        let private_key_hex = self.decrypt_keystore(&ks, password)?;
        Ok(format!("0x{}", private_key_hex))
    }

    /// Delete the wallet keystore
    pub fn delete_wallet(&mut self) -> Result<()> {
        let path = self.keystore_path();
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| {
                ArchivistError::WalletError(format!("Failed to delete keystore: {}", e))
            })?;
        }
        self.cached_private_key = None;
        self.cached_address = None;
        log::info!("Wallet deleted");
        Ok(())
    }

    // ── Wallet Info ─────────────────────────────────────────────────

    /// Get wallet info, combining local keystore with node API data
    pub async fn get_wallet_info(&self) -> Result<WalletInfo> {
        let has_key = self.keystore_exists();
        let address = if let Some(ref addr) = self.cached_address {
            addr.clone()
        } else if has_key {
            // Read address from keystore file (doesn't need password)
            match self.load_keystore() {
                Ok(ks) => ks.address,
                Err(_) => "0x0000000000000000000000000000000000000000".to_string(),
            }
        } else {
            "0x0000000000000000000000000000000000000000".to_string()
        };

        // Check if the node has marketplace active by querying /debug/info
        let marketplace_active = if has_key {
            match self.api_client.get_info().await {
                Ok(info) => {
                    // Node is marketplace-active if it has a non-zero eth address
                    info.eth_address
                        .map(|a| a != "0x0000000000000000000000000000000000000000" && !a.is_empty())
                        .unwrap_or(false)
                }
                Err(_) => false,
            }
        } else {
            false
        };

        Ok(WalletInfo {
            address,
            network: self.network.clone(),
            has_key,
            marketplace_active,
            is_unlocked: self.cached_private_key.is_some(),
        })
    }

    /// Get the cached private key (for passing to sidecar)
    pub fn get_private_key(&self) -> Option<&str> {
        self.cached_private_key.as_deref()
    }

    /// Get the cached ETH address
    #[allow(dead_code)]
    pub fn get_address(&self) -> Option<&str> {
        self.cached_address.as_deref()
    }

    /// Check if a keystore file exists
    pub fn keystore_exists(&self) -> bool {
        self.keystore_path().exists()
    }

    /// Check if the wallet is unlocked (private key in memory)
    pub fn is_unlocked(&self) -> bool {
        self.cached_private_key.is_some()
    }

    // ── Balance Queries ─────────────────────────────────────────────

    /// Get ETH and TST balances via JSON-RPC
    pub async fn get_balances(&self) -> Result<WalletBalances> {
        let address = self
            .cached_address
            .as_deref()
            .ok_or_else(|| ArchivistError::WalletError("No wallet address available".into()))?;

        let client = reqwest::Client::new();

        // Query ETH balance
        let eth_balance_raw = self.rpc_eth_get_balance(&client, address).await?;
        let eth_balance = Self::format_wei_to_eth(&eth_balance_raw);

        // Query TST token balance (ERC-20 balanceOf)
        let tst_balance_raw = self
            .rpc_erc20_balance_of(&client, &self.token_contract, address)
            .await?;
        let tst_balance = Self::format_token_balance(&tst_balance_raw, 18);

        Ok(WalletBalances {
            eth_balance,
            tst_balance,
            eth_balance_raw,
            tst_balance_raw,
        })
    }

    /// Call eth_getBalance via JSON-RPC
    async fn rpc_eth_get_balance(&self, client: &reqwest::Client, address: &str) -> Result<String> {
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_getBalance",
            "params": [address, "latest"],
            "id": 1
        });

        let response = client
            .post(&self.rpc_url)
            .json(&body)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| ArchivistError::WalletError(format!("RPC request failed: {}", e)))?;

        let json: serde_json::Value = response.json().await.map_err(|e| {
            ArchivistError::WalletError(format!("Failed to parse RPC response: {}", e))
        })?;

        json["result"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| {
                let err = json["error"]
                    .as_object()
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                ArchivistError::WalletError(format!("eth_getBalance failed: {}", err))
            })
    }

    /// Call ERC-20 balanceOf via eth_call
    async fn rpc_erc20_balance_of(
        &self,
        client: &reqwest::Client,
        token_contract: &str,
        address: &str,
    ) -> Result<String> {
        // balanceOf(address) selector: 0x70a08231
        // Pad address to 32 bytes (remove 0x prefix, left-pad with zeros)
        let addr_clean = address.strip_prefix("0x").unwrap_or(address);
        let data = format!("0x70a08231{:0>64}", addr_clean);

        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{
                "to": token_contract,
                "data": data
            }, "latest"],
            "id": 2
        });

        let response = client
            .post(&self.rpc_url)
            .json(&body)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| ArchivistError::WalletError(format!("RPC request failed: {}", e)))?;

        let json: serde_json::Value = response.json().await.map_err(|e| {
            ArchivistError::WalletError(format!("Failed to parse RPC response: {}", e))
        })?;

        json["result"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| {
                let err = json["error"]
                    .as_object()
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                ArchivistError::WalletError(format!("balanceOf call failed: {}", err))
            })
    }

    // ── Crypto Helpers ──────────────────────────────────────────────

    /// Derive ETH address from raw 32-byte private key
    fn derive_eth_address(private_key_bytes: &[u8]) -> Result<String> {
        let signing_key = SigningKey::from_bytes(private_key_bytes.into())
            .map_err(|e| ArchivistError::WalletError(format!("Invalid private key: {}", e)))?;

        let verifying_key = signing_key.verifying_key();
        let public_key = verifying_key.to_encoded_point(false); // Uncompressed (65 bytes: 0x04 + 64)
        let public_key_bytes = public_key.as_bytes();

        // Keccak256 hash of the 64-byte public key (skip the 0x04 prefix)
        let hash = Keccak256::digest(&public_key_bytes[1..]);

        // Take last 20 bytes as the ETH address
        let address_bytes = &hash[12..];
        let address = format!("0x{}", hex::encode(address_bytes));

        // Apply EIP-55 checksum
        Ok(Self::to_checksum_address(&address))
    }

    /// EIP-55 checksum encoding for ETH addresses
    fn to_checksum_address(address: &str) -> String {
        let addr_lower = address.strip_prefix("0x").unwrap_or(address).to_lowercase();
        let hash = Keccak256::digest(addr_lower.as_bytes());
        let hash_hex = hex::encode(hash);

        let mut checksummed = String::from("0x");
        for (i, c) in addr_lower.chars().enumerate() {
            if c.is_ascii_alphabetic() {
                // If the corresponding nibble in the hash is >= 8, uppercase
                let nibble = u8::from_str_radix(&hash_hex[i..i + 1], 16).unwrap_or(0);
                if nibble >= 8 {
                    checksummed.push(c.to_ascii_uppercase());
                } else {
                    checksummed.push(c);
                }
            } else {
                checksummed.push(c);
            }
        }

        checksummed
    }

    // ── Keystore Encryption ─────────────────────────────────────────

    fn keystore_path(&self) -> PathBuf {
        self.keystore_dir.join(KEYSTORE_FILENAME)
    }

    /// Derive a 32-byte encryption key from password + salt using iterated SHA-256
    fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
        let mut key = Sha256::new();
        key.update(password.as_bytes());
        key.update(salt);
        let mut result: [u8; 32] = key.finalize().into();

        for _ in 1..iterations {
            let mut hasher = Sha256::new();
            hasher.update(result);
            hasher.update(salt);
            result = hasher.finalize().into();
        }

        result
    }

    /// Encrypt and save the private key to the keystore file
    fn save_keystore(&self, private_key_hex: &str, address: &str, password: &str) -> Result<()> {
        // Generate random salt and nonce
        let mut salt = [0u8; 16];
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut salt);
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        // Derive encryption key
        let mut enc_key = Self::derive_key(password, &salt, KDF_ITERATIONS);

        // Encrypt the private key
        let cipher = Aes256Gcm::new_from_slice(&enc_key)
            .map_err(|e| ArchivistError::WalletError(format!("Cipher init failed: {}", e)))?;

        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, private_key_hex.as_bytes())
            .map_err(|e| ArchivistError::WalletError(format!("Encryption failed: {}", e)))?;

        // Zeroize the key material
        enc_key.zeroize();

        let keystore = EncryptedKeystore {
            version: KEYSTORE_VERSION,
            address: address.to_string(),
            salt: hex::encode(salt),
            nonce: hex::encode(nonce_bytes),
            ciphertext: hex::encode(ciphertext),
            iterations: KDF_ITERATIONS,
        };

        // Ensure directory exists
        if let Some(parent) = self.keystore_path().parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                ArchivistError::WalletError(format!("Failed to create keystore directory: {}", e))
            })?;
        }

        let json = serde_json::to_string_pretty(&keystore).map_err(|e| {
            ArchivistError::WalletError(format!("Failed to serialize keystore: {}", e))
        })?;

        std::fs::write(self.keystore_path(), json)
            .map_err(|e| ArchivistError::WalletError(format!("Failed to write keystore: {}", e)))?;

        log::info!("Keystore saved to {:?}", self.keystore_path());
        Ok(())
    }

    /// Load the keystore file
    fn load_keystore(&self) -> Result<EncryptedKeystore> {
        let path = self.keystore_path();
        if !path.exists() {
            return Err(ArchivistError::WalletError("No keystore found".into()));
        }

        let json = std::fs::read_to_string(&path)
            .map_err(|e| ArchivistError::WalletError(format!("Failed to read keystore: {}", e)))?;

        serde_json::from_str(&json)
            .map_err(|e| ArchivistError::WalletError(format!("Failed to parse keystore: {}", e)))
    }

    /// Decrypt the keystore and return the private key hex
    fn decrypt_keystore(&self, ks: &EncryptedKeystore, password: &str) -> Result<String> {
        let salt = hex::decode(&ks.salt)
            .map_err(|_| ArchivistError::WalletError("Invalid salt in keystore".into()))?;
        let nonce_bytes = hex::decode(&ks.nonce)
            .map_err(|_| ArchivistError::WalletError("Invalid nonce in keystore".into()))?;
        let ciphertext = hex::decode(&ks.ciphertext)
            .map_err(|_| ArchivistError::WalletError("Invalid ciphertext in keystore".into()))?;

        // Derive the encryption key
        let mut enc_key = Self::derive_key(password, &salt, ks.iterations);

        // Decrypt
        let cipher = Aes256Gcm::new_from_slice(&enc_key)
            .map_err(|e| ArchivistError::WalletError(format!("Cipher init failed: {}", e)))?;

        let nonce = Nonce::from_slice(&nonce_bytes);
        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
            ArchivistError::WalletError("Wrong password or corrupted keystore".into())
        })?;

        // Zeroize key material
        enc_key.zeroize();

        String::from_utf8(plaintext)
            .map_err(|_| ArchivistError::WalletError("Decrypted key is not valid UTF-8".into()))
    }

    // ── Formatting Helpers ──────────────────────────────────────────

    /// Convert hex wei value to ETH string with up to 6 decimal places
    fn format_wei_to_eth(hex_wei: &str) -> String {
        Self::format_token_balance(hex_wei, 18)
    }

    /// Format a hex token balance with the given number of decimals
    fn format_token_balance(hex_value: &str, decimals: u32) -> String {
        let clean = hex_value.strip_prefix("0x").unwrap_or(hex_value);
        if clean.is_empty() || clean == "0" {
            return "0".to_string();
        }

        // Parse hex to u128 (sufficient for most balances)
        let value = u128::from_str_radix(clean, 16).unwrap_or(0);
        if value == 0 {
            return "0".to_string();
        }

        let divisor = 10u128.pow(decimals);
        let whole = value / divisor;
        let frac = value % divisor;

        if frac == 0 {
            format!("{}", whole)
        } else {
            // Show up to 6 decimal places
            let frac_str = format!("{:0>width$}", frac, width = decimals as usize);
            let trimmed = frac_str.trim_end_matches('0');
            let display_frac = if trimmed.len() > 6 {
                &trimmed[..6]
            } else {
                trimmed
            };
            format!("{}.{}", whole, display_frac)
        }
    }
}
