const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");

module.exports = defineConfig({
  plugins: [react()],
  server: {
    port: 5183,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:5184",
      "/media": "http://localhost:5184"
    }
  }
});
