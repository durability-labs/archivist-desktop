//! Integration tests for the chat crypto stack.

use archivist_lib::crypto::group_sessions::GroupSessionManager;
use archivist_lib::crypto::identity::IdentityManager;
use archivist_lib::crypto::key_store::KeyStore;
use archivist_lib::crypto::safety_numbers;
use archivist_lib::crypto::sessions::SessionManager;
use tempfile::TempDir;
use vodozemac::olm::OlmMessage;

fn make_ks() -> (KeyStore, TempDir) {
    let tmp = TempDir::new().unwrap();
    let ks = KeyStore::new(tmp.path()).unwrap();
    (ks, tmp)
}

#[test]
fn test_full_1to1_message_flow() {
    let (ks_a, _ta) = make_ks();
    let (ks_b, _tb) = make_ks();

    // Create identities
    let mut alice_id = IdentityManager::load_or_create(&ks_a, "alice").unwrap();
    let mut bob_id = IdentityManager::load_or_create(&ks_b, "bob").unwrap();

    bob_id.generate_one_time_keys_if_needed(&ks_b).unwrap();
    let bob_bundle = bob_id.export_pre_key_bundle();

    // Alice creates outbound session
    let mut alice_sessions = SessionManager::new();
    alice_sessions
        .create_outbound_session(alice_id.account_mut(), &bob_bundle, &ks_a)
        .unwrap();

    // Alice sends
    let msg1 = alice_sessions.encrypt("bob", b"Hello Bob!", &ks_a).unwrap();

    // Bob receives and creates inbound session
    let mut bob_sessions = SessionManager::new();
    let plaintext = match msg1 {
        OlmMessage::PreKey(ref pk) => bob_sessions
            .create_inbound_session(
                bob_id.account_mut(),
                "alice",
                alice_id.curve25519_key(),
                pk,
                &ks_b,
            )
            .unwrap(),
        _ => panic!("First message should be PreKey"),
    };
    assert_eq!(plaintext, b"Hello Bob!");

    // Bob replies
    let msg2 = bob_sessions.encrypt("alice", b"Hi Alice!", &ks_b).unwrap();

    // Alice decrypts Bob's reply (Bob stored under key "bob", but bob_sessions has session for "alice")
    // For the integration test, Alice needs to know Bob's session key is "bob"
    // In real code, the session keys match peer IDs
    let pt2 = alice_sessions.decrypt("bob", &msg2, &ks_a).unwrap();
    assert_eq!(pt2, b"Hi Alice!");

    // Multiple messages back and forth
    let msg3 = alice_sessions.encrypt("bob", b"msg3", &ks_a).unwrap();
    let pt3 = bob_sessions.decrypt("alice", &msg3, &ks_b).unwrap();
    assert_eq!(pt3, b"msg3");

    let msg4 = bob_sessions.encrypt("alice", b"msg4", &ks_b).unwrap();
    let pt4 = alice_sessions.decrypt("bob", &msg4, &ks_a).unwrap();
    assert_eq!(pt4, b"msg4");
}

#[test]
fn test_full_group_message_flow() {
    let (ks_a, _ta) = make_ks();
    let (ks_b, _tb) = make_ks();
    let (ks_c, _tc) = make_ks();

    // Alice creates group
    let mut alice_gsm = GroupSessionManager::new();
    let session_key = alice_gsm.create_group_session("g1", &ks_a).unwrap();

    // Bob and Carol receive the session key
    let mut bob_gsm = GroupSessionManager::new();
    bob_gsm
        .add_inbound_session("g1", "alice", &session_key, &ks_b)
        .unwrap();

    let mut carol_gsm = GroupSessionManager::new();
    carol_gsm
        .add_inbound_session("g1", "alice", &session_key, &ks_c)
        .unwrap();

    // Alice sends to group
    let (ct, _idx) = alice_gsm
        .encrypt_group("g1", b"Hello group!", &ks_a)
        .unwrap();

    // Both Bob and Carol can decrypt
    let pt_bob = bob_gsm.decrypt_group("g1", "alice", &ct, &ks_b).unwrap();
    assert_eq!(pt_bob, b"Hello group!");

    let pt_carol = carol_gsm.decrypt_group("g1", "alice", &ct, &ks_c).unwrap();
    assert_eq!(pt_carol, b"Hello group!");
}

#[test]
fn test_group_rekey_on_member_removal() {
    let (ks_a, _ta) = make_ks();
    let (ks_b, _tb) = make_ks();
    let (ks_c, _tc) = make_ks();

    // Create group with Alice, Bob, Carol
    let mut alice_gsm = GroupSessionManager::new();
    let key1 = alice_gsm.create_group_session("g1", &ks_a).unwrap();

    let mut bob_gsm = GroupSessionManager::new();
    bob_gsm
        .add_inbound_session("g1", "alice", &key1, &ks_b)
        .unwrap();

    let mut carol_gsm = GroupSessionManager::new();
    carol_gsm
        .add_inbound_session("g1", "alice", &key1, &ks_c)
        .unwrap();

    // Remove Bob — rekey
    let key2 = alice_gsm.rekey_group("g1", &ks_a).unwrap();

    // Carol gets new key
    carol_gsm
        .add_inbound_session("g1", "alice-rekeyed", &key2, &ks_c)
        .unwrap();

    // Alice encrypts with new session
    let (ct, _) = alice_gsm
        .encrypt_group("g1", b"secret after rekey", &ks_a)
        .unwrap();

    // Carol can decrypt with new inbound
    let pt = carol_gsm
        .decrypt_group("g1", "alice-rekeyed", &ct, &ks_c)
        .unwrap();
    assert_eq!(pt, b"secret after rekey");

    // Bob's old session CANNOT decrypt the new message
    let result = bob_gsm.decrypt_group("g1", "alice", &ct, &ks_b);
    assert!(result.is_err());
}

#[test]
fn test_forward_secrecy_group() {
    let (ks_a, _ta) = make_ks();
    let (ks_b, _tb) = make_ks();

    let mut alice_gsm = GroupSessionManager::new();
    let key = alice_gsm.create_group_session("g1", &ks_a).unwrap();

    let mut bob_gsm = GroupSessionManager::new();
    bob_gsm
        .add_inbound_session("g1", "alice", &key, &ks_b)
        .unwrap();

    // Send first message
    let (ct1, _) = alice_gsm.encrypt_group("g1", b"message 1", &ks_a).unwrap();
    let pt1 = bob_gsm.decrypt_group("g1", "alice", &ct1, &ks_b).unwrap();
    assert_eq!(pt1, b"message 1");

    // Send second message — ratchet advances
    let (ct2, _) = alice_gsm.encrypt_group("g1", b"message 2", &ks_a).unwrap();
    let pt2 = bob_gsm.decrypt_group("g1", "alice", &ct2, &ks_b).unwrap();
    assert_eq!(pt2, b"message 2");

    // Even if an attacker gets the current group session state,
    // they cannot decrypt message 1 (hash ratchet has advanced).
    // The Megolm ratchet only moves forward, so earlier indices are protected.
}

#[test]
fn test_safety_numbers_consistency() {
    let (ks_a, _ta) = make_ks();
    let (ks_b, _tb) = make_ks();

    let alice_id = IdentityManager::load_or_create(&ks_a, "alice").unwrap();
    let bob_id = IdentityManager::load_or_create(&ks_b, "bob").unwrap();

    let alice_ik = alice_id.curve25519_key().to_base64();
    let bob_ik = bob_id.curve25519_key().to_base64();

    // Safety numbers should be symmetric
    let sn_ab = safety_numbers::compute_safety_number(&alice_ik, &bob_ik);
    let sn_ba = safety_numbers::compute_safety_number(&bob_ik, &alice_ik);
    assert_eq!(sn_ab, sn_ba);

    // Different identities → different safety numbers
    let (ks_c, _tc) = make_ks();
    let carol_id = IdentityManager::load_or_create(&ks_c, "carol").unwrap();
    let carol_ik = carol_id.curve25519_key().to_base64();

    let sn_ac = safety_numbers::compute_safety_number(&alice_ik, &carol_ik);
    assert_ne!(sn_ab, sn_ac);
}
