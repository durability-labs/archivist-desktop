use sha2::{Digest, Sha256};

/// Compute a 60-digit safety number from two identity keys.
///
/// The result is deterministic and symmetric: compute(A, B) == compute(B, A).
/// Displayed as 12 groups of 5 digits.
pub fn compute_safety_number(our_identity_key: &str, their_identity_key: &str) -> String {
    // Sort keys for symmetry
    let (first, second) = if our_identity_key <= their_identity_key {
        (our_identity_key, their_identity_key)
    } else {
        (their_identity_key, our_identity_key)
    };

    let mut hasher = Sha256::new();
    hasher.update(first.as_bytes());
    hasher.update(second.as_bytes());
    let hash = hasher.finalize();

    // Convert hash bytes to 60 decimal digits (12 groups of 5)
    let mut digits = String::with_capacity(71); // 60 digits + 11 spaces
    for (i, chunk) in hash.chunks(2).enumerate() {
        if i >= 12 {
            break;
        }
        if i > 0 {
            digits.push(' ');
        }
        let val = u16::from_be_bytes([chunk[0], chunk.get(1).copied().unwrap_or(0)]);
        // Map to 5 digits (00000–99999)
        let num = (val as u64 * 100000) / 65536;
        digits.push_str(&format!("{:05}", num));
    }

    digits
}

/// Format safety number for display.
pub fn format_safety_number(safety_number: &str) -> Vec<String> {
    safety_number
        .split_whitespace()
        .map(|s| s.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic() {
        let a = "keyAAAA";
        let b = "keyBBBB";
        let sn1 = compute_safety_number(a, b);
        let sn2 = compute_safety_number(a, b);
        assert_eq!(sn1, sn2);
    }

    #[test]
    fn test_symmetric() {
        let a = "key_alice_identity";
        let b = "key_bob_identity";
        let sn_ab = compute_safety_number(a, b);
        let sn_ba = compute_safety_number(b, a);
        assert_eq!(sn_ab, sn_ba);
    }

    #[test]
    fn test_different_keys_different_numbers() {
        let sn1 = compute_safety_number("keyA", "keyB");
        let sn2 = compute_safety_number("keyC", "keyD");
        assert_ne!(sn1, sn2);
    }

    #[test]
    fn test_format() {
        let sn = compute_safety_number("test1", "test2");
        let groups = format_safety_number(&sn);
        assert_eq!(groups.len(), 12);
        for g in &groups {
            assert_eq!(g.len(), 5);
            assert!(g.chars().all(|c| c.is_ascii_digit()));
        }
    }
}
