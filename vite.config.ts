import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const telegramHost = (() => {
  try { return process.env.TELEGRAM_WEBHOOK_URL ? new URL(process.env.TELEGRAM_WEBHOOK_URL).hostname : undefined; }
  catch { return undefined; }
})();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": "/src" } },
  server: {
    allowedHosts: telegramHost ? [telegramHost] : [],
    proxy: { "/api": `http://127.0.0.1:${process.env.PORT || "3000"}` },
  },
});
