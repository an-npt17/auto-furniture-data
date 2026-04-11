import { test, expect } from "bun:test";
import { Document } from "@gltf-transform/core";
import { buildFurnitureClusterDocument, buildGroupDocument, clusterFurnitureEntries, resolveGroupNodes, resolveRootEntries } from "../cli/mesh-extractor";

test("resolveGroupNodes preserves translated multi-child container nodes", () => {
  const doc = new Document();
  const scene = doc.createScene("Scene");

  const wrapper = doc.createNode("Wrapper");
  wrapper.setTranslation([1, 2, 3]);
  scene.addChild(wrapper);

  const childA = doc.createNode("ChildA");
  childA.setTranslation([4, 0, 0]);
  wrapper.addChild(childA);

  const childB = doc.createNode("ChildB");
  childB.setTranslation([0, 5, 0]);
  wrapper.addChild(childB);

  const nodes = resolveGroupNodes(doc);
  expect(nodes).toHaveLength(1);
  expect(nodes[0]?.getName()).toBe("Wrapper");
  expect(nodes[0]?.getTranslation()).toEqual([1, 2, 3]);
});

test("resolveGroupNodes returns scene top-level nodes without unwrapping", () => {
  const doc = new Document();
  const scene = doc.createScene("Scene");

  const parent = doc.createNode("Parent");
  parent.setTranslation([10, 20, 30]);
  scene.addChild(parent);

  const child = doc.createNode("Child");
  child.setTranslation([1, 2, 3]);
  parent.addChild(child);

  const nodes = resolveGroupNodes(doc);
  expect(nodes).toHaveLength(1);
  expect(nodes[0]?.getName()).toBe("Parent");
  expect(nodes[0]?.getTranslation()).toEqual([10, 20, 30]);
});

test("buildGroupDocument keeps the original root node", () => {
  const doc = new Document();
  const scene = doc.createScene("Scene");

  const group = doc.createNode("Group");
  group.setTranslation([7, 8, 9]);
  scene.addChild(group);

  const out = buildGroupDocument(group);
  const outScene = out.getRoot().listScenes()[0]!;
  const rootChild = outScene.listChildren()[0]!;

  expect(rootChild.getName()).toBe("Group");
  expect(rootChild.getTranslation()).toEqual([7, 8, 9]);
});

test("clusterFurnitureEntries groups nearby furniture into a set", () => {
  const doc = new Document();
  const scene = doc.createScene("Scene");

  const makeEntry = (name: string, x: number, y: number, z: number) => {
    const node = doc.createNode(name);
    node.setTranslation([x, y, z]);
    const mesh = doc.createMesh(`${name}Mesh`);
    mesh.addPrimitive(doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))));
    node.setMesh(mesh);
    scene.addChild(node);
    return {
      name,
      rootName: name,
      node,
      location: { x, y, z },
      size: [0.2, 0.2, 0.2] as [number, number, number],
      category: "furniture" as const,
    };
  };

  const clusters = clusterFurnitureEntries([
    makeEntry("ChairA", 0, 0, 0),
    makeEntry("ChairB", 1.2, 0, 0.3),
    makeEntry("Lamp", 10, 0, 10),
  ]);

  expect(clusters).toHaveLength(2);
  expect(clusters[0]!.members.length).toBe(2);
  expect(clusters[1]!.members.length).toBe(1);
});

test("buildFurnitureClusterDocument keeps all cluster members under one root", () => {
  const doc = new Document();
  const scene = doc.createScene("Scene");

  const nodeA = doc.createNode("A");
  nodeA.setTranslation([0, 0, 0]);
  nodeA.setMesh(doc.createMesh("AMesh"));
  scene.addChild(nodeA);

  const nodeB = doc.createNode("B");
  nodeB.setTranslation([1, 0, 0]);
  nodeB.setMesh(doc.createMesh("BMesh"));
  scene.addChild(nodeB);

  const out = buildFurnitureClusterDocument({
    id: "furniture_set_001",
    members: [
      { name: "A", rootName: "A", node: nodeA, location: { x: 0, y: 0, z: 0 }, size: [1, 1, 1], category: "furniture" },
      { name: "B", rootName: "B", node: nodeB, location: { x: 1, y: 0, z: 0 }, size: [1, 1, 1], category: "furniture" },
    ],
    location: { x: 0.5, y: 0, z: 0 },
  });

  const outScene = out.getRoot().listScenes()[0]!;
  const rootChild = outScene.listChildren()[0]!;
  expect(rootChild.getName()).toBe("furniture_set_001");
  expect(rootChild.listChildren()).toHaveLength(2);
});

test("resolveRootEntries uses a descendant name when the root is unnamed", () => {
  const doc = new Document();
  const scene = doc.createScene("Scene");

  const wrapper = doc.createNode("");
  wrapper.setTranslation([2, 3, 4]);
  scene.addChild(wrapper);

  const child = doc.createNode("NamedChild");
  child.setMesh(doc.createMesh("ChildMesh"));
  wrapper.addChild(child);

  const entries = resolveRootEntries(doc);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.name).toBe("NamedChild");
});
