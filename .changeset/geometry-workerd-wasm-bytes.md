---
"@ifc-lite/geometry": patch
---

`GeometryProcessor.init()` works in Cloudflare workerd after the host has instantiated the wasm with `initSync`. The Node wasm loader treated every runtime with `process.versions.node` as Node and imported `node:module`, which workerd without nodejs_compat cannot load, so hosts had to fake a `window` global around `init()`. It now takes the built-ins from `process.getBuiltinModule` and falls back to wasm-bindgen's own init where they are missing.
