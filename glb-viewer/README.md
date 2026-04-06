# GLB Viewer

A simple, lightweight 3D model viewer for GLB/GLTF files built with TypeScript, Three.js, and Bun.

## Features

- 🎨 Interactive 3D model viewing with orbit controls
- 📁 Load models via file upload or URL
- 🎨 Customizable background color
- 🔄 Automatic model centering and scaling
- ⚡ Fast development server powered by Bun

## Prerequisites

- [Bun](https://bun.sh) installed on your system

## Installation

Dependencies are already installed. If you need to reinstall:

```bash
bun install
```

## Usage

1. Start the development server:

```bash
bun run index.ts
```

2. Open your browser and navigate to:

```
http://localhost:3000
```

3. Load a GLB model:
   - **Upload**: Click "Upload GLB" and select a `.glb` file from your computer
   - **URL**: Enter a URL to a GLB file (or local path like `/models/sample.glb`) and click "Load"
   - **Models folder**: Place `.glb` files in the `models/` directory and load them via URL: `/models/your-file.glb`

## Controls

- **Rotate**: Left mouse button + drag
- **Pan**: Right mouse button + drag
- **Zoom**: Mouse wheel scroll

## Project Structure

```
glb-viewer/
├── src/
│   └── viewer.ts         # Main viewer logic (Three.js)
├── public/
│   └── index.html        # Web interface
├── models/               # Place your .glb files here
├── index.ts              # Bun development server
├── package.json
├── tsconfig.json
└── README.md
```

## Technologies

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **3D Engine**: [Three.js](https://threejs.org)
- **Loaders**: GLTFLoader
- **Controls**: OrbitControls

## Finding GLB Models

You can find free GLB models from:
- [Sketchfab](https://sketchfab.com/feed)
- [Poly Haven](https://polyhaven.com/)
- [Google Poly Archive](https://poly.pizza/)
- [Three.js Examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf)

## License

MIT

---

This project was created using `bun init` in bun v1.3.10. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
