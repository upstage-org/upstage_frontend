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
            // CRITICAL: All Vue-dependent libraries must be in vue-core to avoid initialization issues
            // Check in order of dependency to ensure proper initialization
            
            // 1. Vue core libraries (must be first)
            if (id.includes('/vue/') || id.includes('\\vue\\') || 
                id.includes('@vue/runtime') || id.includes('@vue/reactivity') ||
                id.includes('@vue/shared') || id.includes('vue-demi')) {
              return 'vue-core';
            }
            
            // 2. Vue ecosystem that depends on Vue core
            if (id.includes('vue-router') || id.includes('vuex') ||
                id.includes('@vue/apollo') || id.includes('@vueuse') ||
                id.includes('vue-i18n') || id.includes('ant-design-vue') ||
                id.includes('@ant-design')) {
              return 'vue-core';
            }
            
            // 3. Vue-related utilities and plugins
            if (id.includes('@tiptap/vue') || id.includes('vue-slicksort') ||
                id.includes('vue-stripe') || id.includes('vue-turnstile') ||
                id.includes('vue-masonry') || id.includes('unplugin-vue')) {
              return 'vue-core';
            }
            
            // 4. GraphQL and Apollo - keep all Apollo Client modules together
            if (id.includes('@apollo/client') || id.includes('apollo-client') ||
                id.includes('/graphql/') || id.includes('\\graphql\\') || 
                id.includes('graphql-tag') || id.includes('graphql-request')) {
              return 'graphql-vendor';
            }
            
            // 5. TipTap editor (non-Vue parts)
            if (id.includes('@tiptap') && !id.includes('@tiptap/vue')) {
              return 'tiptap-vendor';
            }
            
            // 6. Utilities (non-Vue dependent)
            if (id.includes('/lodash/') || id.includes('\\lodash\\') || 
                id.includes('/axios/') || id.includes('\\axios\\') ||
                id.includes('/dayjs/') || id.includes('\\dayjs\\') ||
                id.includes('/moment/') || id.includes('\\moment\\')) {
              return 'utils-vendor';
            }
            
            // 7. Media libraries
            if (id.includes('html2canvas') || id.includes('flv.js') || id.includes('qr-code')) {
              return 'media-vendor';
            }
            
            // 8. Stripe
            if (id.includes('stripe') || id.includes('@stripe')) {
              return 'stripe-vendor';
            }
            
            // 9. MQTT
            if (id.includes('mqtt')) {
              return 'mqtt-vendor';
            }
            
            // 10. All other node_modules go into vendor chunk
            // This includes moveable, @daybrush, and other libraries
            return 'vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 3000, // Increased to 3MB since major dependencies are already split into separate vendor chunks
  },
});
