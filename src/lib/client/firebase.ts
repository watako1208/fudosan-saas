"use client";
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, Auth, inMemoryPersistence, setPersistence } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp;
let auth: Auth;

export function clientAuth(): Auth {
  if (!auth) {
    app = getApps()[0] ?? initializeApp(config);
    auth = getAuth(app);
    // 認証状態はサーバーのセッションCookieで管理するため、ブラウザには保持しない
    void setPersistence(auth, inMemoryPersistence);
    // 本番ビルドではエミュレータへ接続しない（.env.local が混入しても安全にする）
    if (process.env.NEXT_PUBLIC_USE_EMULATOR === "1" && process.env.NODE_ENV !== "production") {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    }
  }
  return auth;
}
