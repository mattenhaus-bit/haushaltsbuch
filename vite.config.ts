import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // Neue Version erst nach Bestätigung aktivieren (Hinweis in der App), nie mitten in einer Eingabe
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Haushaltsbuch',
        short_name: 'Haushalt',
        description: 'Persönliches Haushaltsbuch',
        lang: 'de',
        start_url: '.',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f766e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  test: { environment: 'node' }
});
