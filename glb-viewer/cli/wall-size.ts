// cli/wall-size.ts
import type { Node } from '@gltf-transform/core';

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

function trsToMat4(
  t: ArrayLike<number>,
  r: ArrayLike<number>,
  s: ArrayLike<number>,
): Mat4 {
  const [qx, qy, qz, qw] = [r[0]!, r[1]!, r[2]!, r[3]!];
  const [sx, sy, sz] = [s[0]!, s[1]!, s[2]!];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx, (2 * (qx * qy - qz * qw)) * sy, (2 * (qx * qz + qy * qw)) * sz, t[0]!,
    (2 * (qx * qy + qz * qw)) * sx, (1 - 2 * (qx * qx + qz * qz)) * sy, (2 * (qy * qz - qx * qw)) * sz, t[1]!,
    (2 * (qx * qz - qy * qw)) * sx, (2 * (qy * qz + qx * qw)) * sy, (1 - 2 * (qx * qx + qy * qy)) * sz, t[2]!,
    0, 0, 0, 1,
  ];
}

function mulMat4(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16) as Mat4;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[row * 4 + k]! * b[k * 4 + col]!;
      o[row * 4 + col] = v;
    }
  }
  return o;
}

function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[1]! * y + m[2]! * z + m[3]!,
    m[4]! * x + m[5]! * y + m[6]! * z + m[7]!,
    m[8]! * x + m[9]! * y + m[10]! * z + m[11]!,
  ];
}

export function computeGroupSize(groupNode: Node): [number, number, number] {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const rootMatrix = trsToMat4(groupNode.getTranslation(), groupNode.getRotation(), groupNode.getScale());

  function traverse(node: Node, parentMatrix: Mat4): void {
    const localMatrix = trsToMat4(node.getTranslation(), node.getRotation(), node.getScale());
    const matrix = mulMat4(parentMatrix, localMatrix);

    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const posAcc = prim.getAttribute('POSITION');
        if (!posAcc) continue;
        const arr = posAcc.getArray();
        if (!arr) continue;

        for (let i = 0; i + 2 < arr.length; i += 3) {
          const [px, py, pz] = transformPoint(matrix, arr[i]!, arr[i + 1]!, arr[i + 2]!);
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
          if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
        }
      }
    }

    for (const child of node.listChildren()) {
      traverse(child, matrix);
    }
  }

  traverse(groupNode, rootMatrix);

  if (!isFinite(minX)) return [0, 0, 0];

  return [round4(maxX - minX), round4(maxZ - minZ), round4(maxY - minY)];
}

export function detectCategory(size: [number, number, number]): 'wall' | 'furniture' {
  const [xSize, zSize, ySize] = size;
  const dims = [xSize, zSize, ySize].sort((a, b) => b - a);
  const thickest = dims[0]!;
  const thinnest = dims[2]!;

  if (
    ySize >= 2.5 &&
    thickest >= 2.0 &&
    thinnest < 0.4 &&
    thickest / thinnest > 5
  ) {
    return 'wall';
  }

  return 'furniture';
}
