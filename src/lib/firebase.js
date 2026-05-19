import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim(),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim(),
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim(),
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim(),
};

const requiredConfig = [
  ["VITE_FIREBASE_API_KEY", firebaseConfig.apiKey],
  ["VITE_FIREBASE_AUTH_DOMAIN", firebaseConfig.authDomain],
  ["VITE_FIREBASE_PROJECT_ID", firebaseConfig.projectId],
  ["VITE_FIREBASE_APP_ID", firebaseConfig.appId],
];

export const missingFirebaseConfig = requiredConfig
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const isFirebaseConfigured = missingFirebaseConfig.length === 0;
export const firebaseConfigError = isFirebaseConfigured
  ? ""
  : `Faltan variables de Firebase: ${missingFirebaseConfig.join(", ")}`;

export const firebaseNamespace =
  import.meta.env.VITE_FIREBASE_NAMESPACE?.trim() ||
  "csm-granada-horas-extras";

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;

export const firebaseAuth = app ? getAuth(app) : null;
export const firestoreDb = app ? getFirestore(app) : null;
