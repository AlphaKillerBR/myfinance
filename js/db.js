/*
 * db.js — camada de armazenamento local usando IndexedDB.
 *
 * Modelo de dados:
 *
 * transaction: {
 *   id: string (uuid),
 *   date: 'YYYY-MM-DD',
 *   type: 'expense' | 'income',
 *   method: 'debito' | 'credito' | 'pix' | 'dinheiro',
 *   category: string,
 *   description: string,
 *   amount: number (sempre positivo),
 *   goalId: string | null,
 *   updatedAt: number (ms epoch),
 *   deleted: boolean
 * }
 *
 * goal: {
 *   id: string,
 *   name: string,
 *   targetAmount: number,
 *   targetCurrency: 'BRL' | 'USD' | 'EUR',
 *   balances: { BRL: number, USD: number, EUR: number },  // valores guardados em cada moeda
 *   deadline: string | null ('YYYY-MM-DD'),
 *   icon: string,
 *   color: string,
 *   updatedAt: number,
 *   deleted: boolean
 * }
 *
 * reminder: {
 *   id: string,
 *   name: string,
 *   amount: number,
 *   dueDate: string ('YYYY-MM-DD'),
 *   recurrence: 'none' | 'weekly' | 'monthly' | 'yearly',
 *   paid: boolean,
 *   category: string,
 *   updatedAt: number,
 *   deleted: boolean
 * }
 */

const DB_NAME = 'financeapp-db';
const DB_VERSION = 1;
const STORES = ['transactions', 'goals', 'reminders'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function tx(storeName, mode) {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

async function putRecord(storeName, record) {
  record.updatedAt = Date.now();
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getAll(storeName, { includeDeleted = false } = {}) {
  const store = await tx(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = (e) => {
      const all = e.target.result || [];
      resolve(includeDeleted ? all : all.filter((r) => !r.deleted));
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function softDelete(storeName, id) {
  const store = await tx(storeName, 'readonly');
  const record = await new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  if (!record) return;
  record.deleted = true;
  return putRecord(storeName, record);
}

// --- API pública por entidade ---

const DB = {
  uuid,

  async addTransaction(data) {
    const record = { id: uuid(), deleted: false, ...data };
    return putRecord('transactions', record);
  },
  async updateTransaction(id, patch) {
    const all = await getAll('transactions', { includeDeleted: true });
    const existing = all.find((r) => r.id === id);
    if (!existing) throw new Error('Transação não encontrada');
    return putRecord('transactions', { ...existing, ...patch, id });
  },
  async deleteTransaction(id) {
    return softDelete('transactions', id);
  },
  async listTransactions() {
    const all = await getAll('transactions');
    return all.sort((a, b) => (a.date < b.date ? 1 : -1));
  },

  async addGoal(data) {
    const record = {
      id: uuid(), deleted: false, currentAmount: 0,
      targetCurrency: 'BRL', balances: { BRL: 0, USD: 0, EUR: 0 },
      ...data,
    };
    return putRecord('goals', record);
  },
  async updateGoal(id, patch) {
    const all = await getAll('goals', { includeDeleted: true });
    const existing = all.find((r) => r.id === id);
    if (!existing) throw new Error('Meta não encontrada');
    return putRecord('goals', { ...existing, ...patch, id });
  },
  async deleteGoal(id) {
    return softDelete('goals', id);
  },
  async listGoals() {
    return getAll('goals');
  },

  async addReminder(data) {
    const record = { id: uuid(), deleted: false, paid: false, ...data };
    return putRecord('reminders', record);
  },
  async updateReminder(id, patch) {
    const all = await getAll('reminders', { includeDeleted: true });
    const existing = all.find((r) => r.id === id);
    if (!existing) throw new Error('Lembrete não encontrado');
    return putRecord('reminders', { ...existing, ...patch, id });
  },
  async deleteReminder(id) {
    return softDelete('reminders', id);
  },
  async listReminders() {
    return getAll('reminders');
  },

  // --- Exportar/Importar dataset completo (usado por backup manual e sync do Drive) ---

  async exportAll() {
    const [transactions, goals, reminders] = await Promise.all([
      getAll('transactions', { includeDeleted: true }),
      getAll('goals', { includeDeleted: true }),
      getAll('reminders', { includeDeleted: true }),
    ]);
    return {
      version: 1,
      exportedAt: Date.now(),
      transactions,
      goals,
      reminders,
    };
  },

  // Faz merge de um dataset externo (ex: vindo do Google Drive) com o local.
  // Estratégia: last-write-wins por registro, comparando updatedAt.
  async mergeDataset(dataset) {
    if (!dataset || typeof dataset !== 'object') return;
    const stores = { transactions: dataset.transactions, goals: dataset.goals, reminders: dataset.reminders };
    for (const [storeName, incoming] of Object.entries(stores)) {
      if (!Array.isArray(incoming)) continue;
      const localAll = await getAll(storeName, { includeDeleted: true });
      const localById = new Map(localAll.map((r) => [r.id, r]));
      for (const remoteRecord of incoming) {
        const localRecord = localById.get(remoteRecord.id);
        if (!localRecord || (remoteRecord.updatedAt || 0) > (localRecord.updatedAt || 0)) {
          const store = await tx(storeName, 'readwrite');
          store.put(remoteRecord);
        }
      }
    }
  },

  async replaceAll(dataset) {
    const db = await openDB();
    for (const storeName of STORES) {
      const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
      store.clear();
      const records = dataset[storeName] || [];
      records.forEach((r) => store.put(r));
    }
  },
};

window.DB = DB;
