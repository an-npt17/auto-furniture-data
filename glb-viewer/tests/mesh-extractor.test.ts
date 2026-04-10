import { test, expect } from "bun:test";
import { Document } from "@gltf-transform/core";
import { buildGroupDocument, resolveGroupNodes } from "../cli/mesh-extractor";

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
