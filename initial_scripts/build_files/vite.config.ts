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
          // Simplified chunking strategy to avoid initialization order issues
          // Group by dependency relationships, not by library type
          if (id.includes('node_modules')) {
            // Group 1: Vue and ALL Vue-dependent libraries (critical - must be together)
            // This includes Vue core, Vue ecosystem, Vue plugins, and Vue UI libraries
            if (id.includes('vue') || 
                id.includes('@vue') || 
                id.includes('vue-router') || 
                id.includes('vuex') ||
                id.includes('vue-i18n') ||
                id.includes('ant-design-vue') ||
                id.includes('@ant-design') ||
                id.includes('@vueuse') ||
                id.includes('@vue/apollo') ||
                id.includes('vue-slicksort') ||
                id.includes('vue-stripe') ||
                id.includes('vue-turnstile') ||
                id.includes('vue-masonry') ||
                id.includes('unplugin-vue') ||
                id.includes('vue-demi') ||
                id.includes('@tiptap/vue')) {
              return 'vue-core';
            }
            
            // Group 2: GraphQL and Apollo (keep together as they have internal dependencies)
            if (id.includes('@apollo') || 
                id.includes('graphql') || 
                id.includes('apollo-client')) {
              return 'graphql-vendor';
            }
            
            // Group 3: TipTap editor (non-Vue parts only)
            if (id.includes('@tiptap') && !id.includes('@tiptap/vue')) {
              return 'tiptap-vendor';
            }
            
            // Group 4: Everything else goes to vendor
            // This ensures no circular dependencies between vendor and vue-core
            return 'vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 3000, // Increased to 3MB since major dependencies are already split into separate vendor chunks
  },
});
