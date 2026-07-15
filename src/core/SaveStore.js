// 存档存储:三级降级 indexedDB → localStorage → 内存。
// 4399 的 iframe 环境里 localStorage 可能被禁用或随时清空(风险清单#4),
// 所以优先 indexedDB、逐级探测降级;内存层永远兜底写一份(本次会话内可靠)。
const DB_NAME = 'tw-save'
const STORE = 'kv'

class SaveStoreImpl {
  constructor() {
    this.backend = 'memory'
    this.mem = {}
    this.db = null
  }

  async init() {
    try {
      this.db = await new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE)
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      })
      this.backend = 'indexedDB'
      return this
    } catch { /* 降级 */ }
    try {
      localStorage.setItem('tw-probe', '1')
      localStorage.removeItem('tw-probe')
      this.backend = 'localStorage'
    } catch {
      this.backend = 'memory'
    }
    return this
  }

  async get(key) {
    if (this.backend === 'indexedDB') {
      try {
        return await new Promise((res, rej) => {
          const req = this.db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
          req.onsuccess = () => res(req.result ?? null)
          req.onerror = () => rej(req.error)
        })
      } catch { return this.mem[key] ?? null }
    }
    if (this.backend === 'localStorage') {
      try { const v = localStorage.getItem('tw:' + key); return v ? JSON.parse(v) : null } catch { return null }
    }
    return this.mem[key] ?? null
  }

  async set(key, value) {
    this.mem[key] = value // 内存兜底永远写
    if (this.backend === 'indexedDB') {
      try {
        await new Promise((res, rej) => {
          const req = this.db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key)
          req.onsuccess = () => res()
          req.onerror = () => rej(req.error)
        })
        return
      } catch { /* 掉到下一层 */ }
    }
    try { localStorage.setItem('tw:' + key, JSON.stringify(value)) } catch { /* 内存已兜底 */ }
  }

  async remove(key) {
    delete this.mem[key]
    if (this.backend === 'indexedDB') {
      try {
        await new Promise((res, rej) => {
          const req = this.db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key)
          req.onsuccess = () => res()
          req.onerror = () => rej(req.error)
        })
      } catch { /* 忽略 */ }
    }
    try { localStorage.removeItem('tw:' + key) } catch { /* 忽略 */ }
  }
}

export const SaveStore = new SaveStoreImpl()
