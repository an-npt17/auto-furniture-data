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
    
    // Serve the viewer script
    if (url.pathname === "/viewer.js") {
      const file = Bun.file("src/viewer.ts");
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
    
    // Serve GLB files from models directory
    if (url.pathname.startsWith("/models/") && url.pathname.endsWith(".glb")) {
      const file = Bun.file(url.pathname.slice(1));
      if (await file.exists()) {
        return new Response(file, {
          headers: { "Content-Type": "model/gltf-binary" },
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
console.log(`📂 Place your .glb files in the 'models' folder`);