// Tauri command handlers

pub mod files;
pub mod media;
pub mod node;
pub mod peers;
pub mod streaming;
pub mod sync;
pub mod system;

// Re-export all commands for registration
pub use files::*;
pub use media::*;
pub use node::*;
pub use peers::*;
pub use streaming::*;
pub use sync::*;
pub use system::*;

// V2 Marketplace commands (conditionally compiled)
#[cfg(feature = "marketplace")]
pub mod marketplace;
#[cfg(feature = "marketplace")]
pub mod wallet;

#[allow(unused_imports)]
#[cfg(feature = "marketplace")]
pub use marketplace::*;
#[allow(unused_imports)]
#[cfg(feature = "marketplace")]
pub use wallet::*;
