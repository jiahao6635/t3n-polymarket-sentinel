## Summary

`get_api_key()` currently double-encodes the tenant DID when constructing the secrets map name:

```rust
let tid = tenant_context::tenant_did();
let map_name = alloc::format!("z:{}:secrets", hex::encode(&tid));
```

The current Terminal 3 [Common Errors documentation](https://docs.terminal3.io/developers/adk/tips/common-errors#common-integration-gotchas) explicitly says `tenant_context::tenant_did()` already returns the string form. Applying `hex::encode` again produces a map path that does not match `z:<tid>:secrets`, so the `duffel_api_key` lookup cannot find the map entry.

## Impact

The contract can build and register successfully, but `book-offer` fails at runtime when it attempts to read `duffel_api_key`. This is especially confusing during the onboarding walkthrough because the error looks like a map-provisioning problem.

## Suggested fix

Use the returned DID value directly:

```rust
let tid = tenant_context::tenant_did();
let map_name = alloc::format!("z:{tid}:secrets");
```

It would also be useful to extract a small pure `secrets_map_name()` helper and add a native unit test so this does not regress.

## Related documentation drift

The repository README still introduces version `0.3.0`, while `Cargo.toml` is `0.4.1`. Its `book-offer` example also passes full passenger PII, whereas the current WIT/source accepts an opaque `passenger_id` and resolves PII with `http-with-placeholders`. Updating those sections would make the reference repository match the current walkthrough.
