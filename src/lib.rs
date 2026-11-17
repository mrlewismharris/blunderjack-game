pub mod engine;

pub mod client_assets;
pub mod music_catalog;

pub const GAME_VERSION: &str = concat!("v", env!("CARGO_PKG_VERSION"));
