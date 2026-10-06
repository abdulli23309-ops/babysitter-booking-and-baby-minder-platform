import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const pocSsl = 'E:/MiroTalkPOC/app/ssl'

export default defineConfig(({ command }) => {
  const httpsOptions = command === 'serve'
    ? {
        key: fs.readFileSync(process.env.VITE_TLS_KEY || path.join(pocSsl, 'key.pem')),
        cert: fs.readFileSync(process.env.VITE_TLS_CERT || path.join(pocSsl, 'cert.pem')),
      }
    : undefined

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      // Avoid Vite silently moving to 5174+ when the expected LAN port is busy;
      // the launcher, firewall rule, and phone URL all use port 5173.
      strictPort: true,
      https: httpsOptions,
      proxy: {
        '/api': {
          target: 'https://localhost:44368',
          changeOrigin: true,
          // DEV ONLY: the backend runs under IIS Express with its own self-signed
          // certificate, which Node cannot verify (DEPTH_ZERO_SELF_SIGNED_CERT).
          // Verifying it makes every /api call fail as a 502 from the proxy before
          // it reaches the API, so verification is off for this localhost hop only.
          // The browser must still trust the certificate for the app->backend leg,
          // and none of this weakens the MiroTalk/media path. Do not copy to a deploy.
          secure: false,
        },
      },
    },
  }
})
