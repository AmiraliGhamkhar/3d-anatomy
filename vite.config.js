import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Bind to all interfaces and allow any host so the app works behind a
    // reverse proxy / preview host, not just localhost.
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    // three is the only substantial dependency; splitting it out keeps the
    // app chunk small and lets the browser cache three between deploys.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          'three-addons': [
            'three/addons/controls/OrbitControls.js',
            'three/addons/environments/RoomEnvironment.js',
            'three/addons/postprocessing/EffectComposer.js',
            'three/addons/postprocessing/RenderPass.js',
            'three/addons/postprocessing/OutputPass.js',
            'three/addons/postprocessing/SAOPass.js',
            'three/addons/postprocessing/FXAAPass.js',
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
