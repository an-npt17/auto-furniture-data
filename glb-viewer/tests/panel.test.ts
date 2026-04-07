import { test, expect } from "bun:test";
import { resolveMeshName } from "../src/panel";

test("resolveMeshName returns the mesh name when non-empty", () => {
  expect(resolveMeshName("Chair_Seat", 0)).toBe("Chair_Seat");
});

test("resolveMeshName falls back to Mesh_<index> for empty name", () => {
  expect(resolveMeshName("", 3)).toBe("Mesh_3");
});

test("resolveMeshName falls back to Mesh_<index> for whitespace-only name", () => {
  expect(resolveMeshName("   ", 7)).toBe("Mesh_7");
});
