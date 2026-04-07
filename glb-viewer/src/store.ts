// src/store.ts

export interface SelectionStore {
  checked: Set<string>;  // mesh UUIDs selected for export
  active: string | null; // UUID of the mesh currently held by TransformControls
}

export function createStore(): SelectionStore {
  return {
    checked: new Set(),
    active: null,
  };
}
