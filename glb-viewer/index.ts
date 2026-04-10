import { serve } from "bun";

const server = serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    
    // Serve the main HTML page
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(await Bun.file("public/index.html").text(), {
        headers: { "Content-Type": "text/html" },
      });
    }
    
    // Serve the scene viewer HTML page
    if (url.pathname === "/scene-viewer" || url.pathname === "/scene-viewer.html") {
      return new Response(await Bun.file("public/scene-viewer.html").text(), {
        headers: { "Content-Type": "text/html" },
      });
    }
    
    // Serve the test scene HTML page
    if (url.pathname === "/test-scene" || url.pathname === "/test-scene.html") {
      return new Response(await Bun.file("public/test-scene.html").text(), {
        headers: { "Content-Type": "text/html" },
      });
    }
    
    // Serve the viewer script
    if (url.pathname === "/viewer.js") {
      const transpiled = await Bun.build({
        entrypoints: ["src/main.ts"],
        outdir: "./build",
        target: "browser",
      });
      
      if (transpiled.outputs.length > 0) {
        return new Response(transpiled.outputs[0], {
          headers: { "Content-Type": "application/javascript" },
        });
      }
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

console.log(`🎨 GLB Viewer running at http://localhost:${server.port}`);
console.log(`📂 Single model viewer: http://localhost:${server.port}/`);
console.log(`🏗️  Scene viewer (manifest): http://localhost:${server.port}/scene-viewer`);
console.log(`🧪 Test scene (debug): http://localhost:${server.port}/test-scene`);
