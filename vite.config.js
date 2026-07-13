import { defineConfig } from 'vite'

// base './' 让构建产物用相对路径 —— 4399 上传 zip 后托管在任意子路径下都能跑
export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  build: { target: 'es2018', assetsInlineLimit: 0 },
})
