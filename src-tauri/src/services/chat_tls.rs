use rcgen::{CertificateParams, KeyPair, PKCS_ED25519};
use sha2::{Digest, Sha256};
use std::path::Path;

use crate::error::{ArchivistError, Result};

/// TLS identity: self-signed cert + private key + fingerprint.
pub struct TlsIdentity {
    pub cert_pem: String,
    pub key_pem: String,
    /// SHA-256 fingerprint of the DER-encoded certificate.
    pub fingerprint: String,
}

/// Generate a self-signed Ed25519 TLS certificate for the chat server.
/// Valid for 10 years. The Subject CN is set to the peer ID.
pub fn generate_self_signed_cert(peer_id: &str) -> Result<TlsIdentity> {
    let key_pair = KeyPair::generate_for(&PKCS_ED25519)
        .map_err(|e| ArchivistError::TlsError(format!("Generate key pair: {}", e)))?;

    let mut params = CertificateParams::new(vec!["localhost".to_string(), "0.0.0.0".to_string()])
        .map_err(|e| ArchivistError::TlsError(format!("Cert params: {}", e)))?;

    params.distinguished_name.push(
        rcgen::DnType::CommonName,
        rcgen::DnValue::Utf8String(format!(
            "archivist-chat-{}",
            &peer_id[..8.min(peer_id.len())]
        )),
    );

    // 10-year validity
    params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    params.not_after = rcgen::date_time_ymd(2034, 1, 1);

    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| ArchivistError::TlsError(format!("Self-sign cert: {}", e)))?;

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();

    // Compute SHA-256 fingerprint of DER
    let der = cert.der();
    let fingerprint = sha256_fingerprint(der.as_ref());

    Ok(TlsIdentity {
        cert_pem,
        key_pem,
        fingerprint,
    })
}

/// Load existing TLS identity from disk, or generate and save a new one.
pub fn load_or_create_tls_identity(
    cert_path: &Path,
    key_path: &Path,
    peer_id: &str,
) -> Result<TlsIdentity> {
    if cert_path.exists() && key_path.exists() {
        let cert_pem = std::fs::read_to_string(cert_path)
            .map_err(|e| ArchivistError::TlsError(format!("Read cert: {}", e)))?;
        let key_pem = std::fs::read_to_string(key_path)
            .map_err(|e| ArchivistError::TlsError(format!("Read key: {}", e)))?;

        // Parse cert to compute fingerprint
        let cert_der = pem_to_der(&cert_pem)?;
        let fingerprint = sha256_fingerprint(&cert_der);

        log::info!(
            "Loaded existing TLS identity (fingerprint: {})",
            fingerprint
        );
        Ok(TlsIdentity {
            cert_pem,
            key_pem,
            fingerprint,
        })
    } else {
        let identity = generate_self_signed_cert(peer_id)?;
        std::fs::write(cert_path, &identity.cert_pem)
            .map_err(|e| ArchivistError::TlsError(format!("Write cert: {}", e)))?;
        std::fs::write(key_path, &identity.key_pem)
            .map_err(|e| ArchivistError::TlsError(format!("Write key: {}", e)))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(key_path, std::fs::Permissions::from_mode(0o600));
        }
        log::info!(
            "Generated new TLS identity (fingerprint: {})",
            identity.fingerprint
        );
        Ok(identity)
    }
}

fn pem_to_der(pem: &str) -> Result<Vec<u8>> {
    let mut cursor = std::io::Cursor::new(pem.as_bytes());
    let certs = rustls_pemfile::certs(&mut cursor)
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| ArchivistError::TlsError(format!("Parse PEM: {}", e)))?;
    certs
        .into_iter()
        .next()
        .map(|c| c.to_vec())
        .ok_or_else(|| ArchivistError::TlsError("No certificate in PEM".to_string()))
}

fn sha256_fingerprint(der: &[u8]) -> String {
    let hash = Sha256::digest(der);
    hash.iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(":")
}
