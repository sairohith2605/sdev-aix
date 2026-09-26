import type { Plan } from "@/features/plans/model"

const DB_NAME = "sdev-aix"
const DB_VERSION = 1
const STORE_NAME = "plans"

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined"
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () =>
      reject(
        request.error instanceof Error
          ? request.error
          : new Error("Failed to open database")
      )
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
        store.createIndex("workItemId", "workItemId", { unique: false })
        store.createIndex("updatedAt", "updatedAt", { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const request = callback(store)

    request.onerror = () =>
      reject(
        request.error instanceof Error
          ? request.error
          : new Error("Database request failed")
      )
    request.onsuccess = () => resolve(request.result)
    tx.onerror = () =>
      reject(
        tx.error instanceof Error
          ? tx.error
          : new Error("Database transaction failed")
      )
  })
}

export async function getPlan(planId: string): Promise<Plan | undefined> {
  if (!hasIndexedDb()) return undefined
  const db = await openDatabase()
  try {
    const result = await transaction<unknown>(db, "readonly", (store) =>
      store.get(planId)
    )
    return result as Plan | undefined
  } finally {
    db.close()
  }
}

export async function listPlans(): Promise<Plan[]> {
  if (!hasIndexedDb()) return []
  const db = await openDatabase()
  try {
    const result = await transaction<Plan[]>(
      db,
      "readonly",
      (store) => store.getAll() as IDBRequest<Plan[]>
    )
    const plans = result
    return plans.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  } finally {
    db.close()
  }
}

export async function listPlansByWorkItem(workItemId: number): Promise<Plan[]> {
  if (!hasIndexedDb()) return []
  const db = await openDatabase()
  try {
    const index = db
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .index("workItemId")
    const plans = await new Promise<Plan[]>((resolve, reject) => {
      const request = index.getAll(workItemId)
      request.onerror = () =>
        reject(
          request.error instanceof Error
            ? request.error
            : new Error("Database request failed")
        )
      request.onsuccess = () => resolve(request.result)
    })
    return plans.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  } finally {
    db.close()
  }
}

export async function savePlan(plan: Plan): Promise<Plan> {
  if (!hasIndexedDb()) return plan
  const db = await openDatabase()
  try {
    await transaction(db, "readwrite", (store) => store.put(plan))
    return plan
  } finally {
    db.close()
  }
}

export async function deletePlan(planId: string): Promise<void> {
  if (!hasIndexedDb()) return
  const db = await openDatabase()
  try {
    await transaction(db, "readwrite", (store) => store.delete(planId))
  } finally {
    db.close()
  }
}
