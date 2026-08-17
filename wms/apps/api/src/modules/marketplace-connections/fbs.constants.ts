// The billing calculator still uses the client's average physical box size.
export const DEFAULT_FBS_ITEMS_PER_CARGO_PLACE = 14;

// Operational FBS packing is unlimited. The large persisted value keeps the
// existing integer fields and cargo-place calculations backward compatible.
export const FBS_UNLIMITED_CARGO_PLACE_CAPACITY = 2_000_000_000;
