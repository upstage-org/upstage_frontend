import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tsconfigPaths from "vite-tsconfig-paths";
import Components from "unplugin-vue-components/vite";
import { AntDesignVueResolver } from "unplugin-vue-components/resolvers";

// https://vitejs.dev/config/
export default defineConfig({
  base: "/",
  plugins: [
    vue(),
    tsconfigPaths(),
    Components({
      resolvers: [
        AntDesignVueResolver({ importStyle: "less", resolveIcons: true }),
      ],
    }),
  ],
  server: {
    fs: {
      // Allow serving files from one level up to the project root
      allow: [".."],
    },
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Node modules chunking
          if (id.includes('node_modules')) {
            // Vue core and Ant Design Vue must be together to avoid initialization order issues
            // Check Vue first, then Ant Design Vue
            if (id.includes('/vue/') || id.includes('\\vue\\') || id.includes('@vue/')) {
              return 'vue-core';
            }
            
            // Ant Design Vue - keep with Vue core
            if (id.includes('ant-design-vue') || id.includes('@ant-design')) {
              return 'vue-core';
            }
            
            // Vue ecosystem (router, vuex, etc.)
            if (id.includes('vue-router') || id.includes('vuex')) {
              return 'vue-ecosystem';
            }
            
            // @vue/apollo-composable needs Vue, so keep with Vue core
            if (id.includes('@vue/apollo-composable')) {
              return 'vue-core';
            }
            
            // GraphQL and Apollo - keep all Apollo Client modules together (including subpath exports)
            // This ensures /core, /link/*, etc. all stay in the same chunk
            if (id.includes('@apollo/client') || id.includes('apollo-client')) {
              return 'graphql-vendor';
            }
            
            // Other GraphQL libraries
            if (id.includes('/graphql/') || id.includes('\\graphql\\') || 
                id.includes('graphql-tag') || id.includes('graphql-request')) {
              return 'graphql-vendor';
            }
            
            // TipTap editor
            if (id.includes('@tiptap') || id.includes('/tiptap/') || id.includes('\\tiptap\\')) {
              return 'tiptap-vendor';
            }
            
            // Large UI libraries
            if (id.includes('moveable') || id.includes('@daybrush')) {
              return 'moveable-vendor';
            }
            
            // Utilities
            if (id.includes('/lodash/') || id.includes('\\lodash\\') || 
                id.includes('/axios/') || id.includes('\\axios\\') ||
                id.includes('/dayjs/') || id.includes('\\dayjs\\') ||
                id.includes('/moment/') || id.includes('\\moment\\')) {
              return 'utils-vendor';
            }
            
            // Media libraries
            if (id.includes('html2canvas') || id.includes('flv.js') || id.includes('qr-code')) {
              return 'media-vendor';
            }
            
            // Stripe
            if (id.includes('stripe') || id.includes('@stripe')) {
              return 'stripe-vendor';
            }
            
            // MQTT
            if (id.includes('mqtt')) {
              return 'mqtt-vendor';
            }
            
            // VueUse
            if (id.includes('@vueuse')) {
              return 'vueuse-vendor';
            }
            
            // All other node_modules go into vendor chunk
            return 'vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 3000, // Increased to 3MB since major dependencies are already split into separate vendor chunks
  },
});
