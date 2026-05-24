export const DB_NAME = "SkinWiseDB";
export const STORE_NAME = "userProfile";

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {

    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => reject(request.error);
  });
}

export async function saveProfile(profile: any) {

  const db = await openDB();

  const tx = db.transaction(STORE_NAME, "readwrite");

  const store = tx.objectStore(STORE_NAME);

  store.put({
    id: "profile",
    ...profile
  });
}

export async function getProfile() {

  const db = await openDB();

  const tx = db.transaction(STORE_NAME, "readonly");

  const store = tx.objectStore(STORE_NAME);

  const request = store.get("profile");

  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
  });
}