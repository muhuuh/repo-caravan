import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["clsx", "tailwind-merge"],
  },
  server: {
    watch: {
      usePolling: true,
    },
  },
});
