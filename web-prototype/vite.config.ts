import { defineConfig } from 'vitest/config';
import basicSsl from '@vitejs/plugin-basic-ssl';

const tunnelHosts = ['.trycloudflare.com'];

export default defineConfig(({ mode }) => {
  // `npm run dev:laptop` → plain http://localhost:5173 on this PC only.
  // Browsers treat localhost as secure, so the webcam works with no
  // certificate warning. The phone can't reach it.
  //
  // `npm run dev` → https on the local network for the iPhone. Safari only
  // allows camera access on HTTPS pages, so this uses a self-signed
  // certificate (hence Safari's one-time "not private" warning) and listens
  // on the network (host: true) so the phone can reach https://<PC-IP>:5173.
  const laptop = mode === 'laptop';

  return {
    // A year-long certificate means the warning only comes back if the
    // certificate is deleted, not every month.
    plugins: laptop ? [] : [basicSsl({ name: 'doomscroll-blocker', ttlDays: 365 })],
    server: {
      host: !laptop,
      port: 5173,
      // Keep the same port every time so the phone's saved camera permission
      // and certificate exception keep working.
      strictPort: true,
      // Allow a Cloudflare quick tunnel (npm run tunnel) as a fallback when
      // the phone can't reach this PC over Wi-Fi.
      allowedHosts: tunnelHosts,
      // Show errors from the phone's browser in this terminal.
      forwardConsole: true,
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: true,
      allowedHosts: tunnelHosts,
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
