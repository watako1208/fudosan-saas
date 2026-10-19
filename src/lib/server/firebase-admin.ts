import "server-only";
import { getApps, initializeApp, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

let app: App;
let db: Firestore;

function projectId(): string | undefined {
  return (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    (process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG).projectId : undefined)
  );
}

export function adminApp(): App {
  if (!app) {
    app =
      getApps()[0] ??
      initializeApp({
        projectId: projectId(),
        storageBucket:
          process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
          (process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG).storageBucket : undefined),
      });
  }
  return app;
}

export function adminDb(): Firestore {
  if (!db) {
    db = getFirestore(adminApp());
    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // settings は初回のみ
    }
  }
  return db;
}

export const adminAuth = () => getAuth(adminApp());
export const adminBucket = () => getStorage(adminApp()).bucket();
