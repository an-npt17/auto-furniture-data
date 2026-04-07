import { test, expect } from "bun:test";
import { createStore } from "../src/store";

test("createStore returns empty checked set and null active", () => {
  const store = createStore();
  expect(store.checked.size).toBe(0);
  expect(store.active).toBeNull();
});

test("store.checked can add and remove UUIDs", () => {
  const store = createStore();
  store.checked.add("uuid-1");
  expect(store.checked.has("uuid-1")).toBe(true);
  store.checked.delete("uuid-1");
  expect(store.checked.has("uuid-1")).toBe(false);
});

test("store.active can be set and cleared", () => {
  const store = createStore();
  store.active = "uuid-abc";
  expect(store.active).toBe("uuid-abc");
  store.active = null;
  expect(store.active).toBeNull();
});
