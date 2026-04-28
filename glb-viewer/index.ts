import { serve } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function listDataFolders(): Promise<string[]> {
  const entries = await readdir(".", { withFileTypes: true });
  const folders: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const metaFile = Bun.file(join(entry.name, "metadata.json"));
    if (await metaFile.exists()) {
      folders.push(entry.name);
    }
  }

  return folders;
}

const server = serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve the scene viewer HTML page
    if (
      url.pathname === "/" ||
      url.pathname === "/scene-viewer" ||
      url.pathname === "/scene-viewer.html"
    ) {
      return new Response(await Bun.file("public/scene-viewer.html").text(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // API: list available data folders (those containing metadata.json)
    if (url.pathname === "/api/folders") {
      const folders = await listDataFolders();
      return new Response(JSON.stringify(folders), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // API: save metadata.json for a data folder
    if (url.pathname === "/api/save-metadata" && req.method === "POST") {
      const body = await req.json() as { folder: string; data: unknown };
      const folder = body.folder;
      const data = body.data;
      if (!folder || !data) {
        return new Response(JSON.stringify({ error: "Missing folder or data" }), { status: 400 });
      }
      const normalizedData = Array.isArray(data)
        ? data
        : typeof data === "object" && data !== null && Array.isArray((data as { objects?: unknown }).objects)
        ? data
        : null;

      if (!normalizedData) {
        return new Response(JSON.stringify({ error: "Invalid metadata payload" }), { status: 400 });
      }

      const allowedFolders = new Set(await listDataFolders());
      if (!allowedFolders.has(folder)) {
        return new Response(JSON.stringify({ error: "Unknown folder" }), { status: 400 });
      }

      const metaPath = join(folder, "metadata.json");
      const metaFile = Bun.file(metaPath);
      if (!(await metaFile.exists())) {
        return new Response(JSON.stringify({ error: "metadata.json not found in folder" }), { status: 404 });
      }
      await Bun.write(metaPath, JSON.stringify(normalizedData, null, 2));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Serve the scene viewer script
    if (url.pathname === "/scene-viewer.js") {
      const transpiled = await Bun.build({
        entrypoints: ["src/scene-viewer.ts"],
        outdir: "./build",
        target: "browser",
      });

      if (transpiled.outputs.length > 0) {
        return new Response(transpiled.outputs[0], {
          headers: { "Content-Type": "application/javascript" },
        });
      }
    }

    // Serve GLB files from models directory
    if (url.pathname.startsWith("/models/") && url.pathname.endsWith(".glb")) {
      const file = Bun.file(url.pathname.slice(1));
      if (await file.exists()) {
        return new Response(file, {
          headers: { "Content-Type": "model/gltf-binary" },
        });
      }
    }

    // Serve files from data folders (e.g. /data/ngu/metadata.json or /data/ngu/SomeModel.glb)
    if (url.pathname.startsWith("/data/")) {
      const relativePath = decodeURIComponent(url.pathname.slice("/data/".length));
      const file = Bun.file(relativePath);
      if (await file.exists()) {
        const contentType = url.pathname.endsWith(".json")
          ? "application/json"
          : url.pathname.endsWith(".glb")
          ? "model/gltf-binary"
          : "application/octet-stream";
        return new Response(file, {
          headers: { "Content-Type": contentType },
        });
      }
    }

    // Serve files from output directory (manifest.json and extracted GLBs)
    if (url.pathname.startsWith("/output/")) {
      const file = Bun.file(url.pathname.slice(1));
      if (await file.exists()) {
        const contentType = url.pathname.endsWith(".json")
          ? "application/json"
          : url.pathname.endsWith(".glb")
          ? "model/gltf-binary"
          : "application/octet-stream";
        return new Response(file, {
          headers: { "Content-Type": contentType },
        });
      }
    }

    // Serve static files
    if (url.pathname.startsWith("/node_modules/")) {
      const file = Bun.file(url.pathname.slice(1));
      if (await file.exists()) {
        return new Response(file);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`GLB Viewer running at http://localhost:${server.port}`);
console.log(`Scene viewer: http://localhost:${server.port}/`);
