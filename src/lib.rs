//! Terminal 3 TEE contract for read-only Polymarket market screening.
//!
//! The contract deliberately imports no host capabilities. It cannot access a
//! wallet, place an order, read secrets, write storage, or call the network.
//! Public market data is normalized by the TypeScript adapter and then passed
//! into `analyze-market` for deterministic validation and scoring.
#![warn(clippy::style, missing_debug_implementations)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

mod analysis;

pub const CONTRACT_VERSION: &str = "0.1.0";

wit_bindgen::generate!({
    world: "polymarket-sentinel",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::polymarket_sentinel::contracts::Guest for Component {
    fn analyze_market(
        req: exports::z::polymarket_sentinel::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("analyze-market: missing input")?;
        analysis::analyze_market(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::CONTRACT_VERSION;

    #[test]
    fn contract_version_is_semver() {
        let parts: Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert!(parts.iter().all(|part| part.parse::<u32>().is_ok()));
    }
}
