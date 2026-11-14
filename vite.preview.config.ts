// Ein-Datei-Build nur für die Vorschau (ohne Service Worker), z. B. zum Ausprobieren auf dem Handy
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), viteSingleFile(), VitePWA({ disable: true, injectRegister: false })],
  define: { 'import.meta.env.VITE_PREVIEW': JSON.stringify('1') },
  build: { outDir: 'dist-preview' }
});
