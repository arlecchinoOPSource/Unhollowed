import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Module bundles are built into public/modules/<name>/ by scripts/build-modules.mjs and copied as-is.
export default defineConfig({ plugins: [react()], clearScreen: false, server: { host: '127.0.0.1', port: 1430, strictPort: true } });
