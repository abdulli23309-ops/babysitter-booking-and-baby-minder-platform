import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const pocSsl = 'E:/MiroTalkPOC/app/ssl'

export default defineConfig(({ command }) => {
  const httpsOptions = command === 'serve' && process.env.VITE_HTTPS !== 'false'
    ? {
        key: fs.readFileSync(process.env.VITE_TLS_KEY || path.join(pocSsl, 'key.pem')),
        cert: fs.readFileSync(process.env.VITE_TLS_CERT || path.join(pocSsl, 'cert.pem')),
      }
    : undefined

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      https: httpsOptions,
      proxy: {
        '/api': {
          target: 'https://localhost:44368',
          changeOrigin: true,
          secure: true,
        },
      },
    },
  }
})
