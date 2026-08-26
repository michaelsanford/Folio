/// <reference types="vite/client" />

// Vite's client types declare the ambient modules for CSS side-effect imports,
// static assets, and import.meta.env. The project had never included them;
// TypeScript 7 is strict enough about untyped side-effect imports to notice.
