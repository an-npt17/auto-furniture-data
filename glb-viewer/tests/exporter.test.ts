import { test, expect } from "bun:test";
import { buildPositionEntries } from "../src/exporter";

test("buildPositionEntries maps raw entries to PositionEntry shape", () => {
  const entries = buildPositionEntries([
    {
      name: "Chair",
      uuid: "uuid-1",
      position: { x: 1, y: 2, z: 3 },
      rotationDeg: { x: 0, y: 45, z: 0 },
    },
  ]);
  expect(entries).toHaveLength(1);
  const entry = entries[0]!;
  expect(entry.name).toBe("Chair");
  expect(entry.uuid).toBe("uuid-1");
  expect(entry.position.x).toBe(1);
  expect(entry.rotation.y).toBe(45);
});

test("buildPositionEntries rounds values to 4 decimal places", () => {
  const entries = buildPositionEntries([
    {
      name: "Leg",
      uuid: "uuid-2",
      position: { x: 1.23456789, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
    },
  ]);
  expect(entries[0]!.position.x).toBe(1.2346);
});

test("buildPositionEntries handles empty array", () => {
  expect(buildPositionEntries([])).toHaveLength(0);
});
