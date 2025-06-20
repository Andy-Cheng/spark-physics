# Three.js Rapier Room Demo

Simple first-person room built with Three.js + Rapier physics.

## Features

* Box-shaped room made of six static walls.
* Tavern environment loaded from GLB mesh.
* Gaussian splat scene rendered with Spark (`tavern_splats.ply`).
* Pointer-lock first-person controls (WASD + mouse look + R/F fly up/down).
* Click to shoot bouncing balls simulated by Rapier.

## Getting started

```bash
# Install dependencies
npm install

# Start dev server on http://localhost:5173
npm run dev
```

Build for production:

```bash
npm run build
npm run preview    # locally preview production build
``` 