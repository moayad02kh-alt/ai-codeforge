/// <reference types="vite/client" />

/* Side-effect stylesheet imports (Vite handles these at build time). */
declare module '*.css';
declare module '*.svg' {
  const src: string;
  export default src;
}
