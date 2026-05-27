import { signInAnonymously } from "firebase/auth";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import {
  firebaseAuth,
  firebaseConfigError,
  firebaseNamespace,
  firestoreDb,
  isFirebaseConfigured,
} from "../lib/firebase";

function getSettingsRef() {
  return doc(firestoreDb, "apps", firebaseNamespace, "meta", "settings");
}

function getRecordsCollectionRef() {
  return collection(firestoreDb, "apps", firebaseNamespace, "records");
}

function getRecordRef(recordId) {
  return doc(firestoreDb, "apps", firebaseNamespace, "records", recordId);
}

function normalizeSettings(settings, fallbackSettings) {
  const fallbackWeeklyHours =
    fallbackSettings?.standardHoursPerWeek ??
    Number(fallbackSettings?.standardHoursPerDay || 8) * 6;
  const weeklyHours =
    settings?.standardHoursPerWeek ??
    (settings?.standardHoursPerDay != null
      ? Number(settings.standardHoursPerDay || 8) * 6
      : fallbackWeeklyHours);

  return {
    weekStart: settings?.weekStart || fallbackSettings.weekStart,
    standardHoursPerWeek: Number(weeklyHours),
    overtimeMultiplier: Number(
      settings?.overtimeMultiplier ?? fallbackSettings.overtimeMultiplier
    ),
  };
}

function normalizeRecord(record, docId = record?.id) {
  return {
    id: docId,
    employeeId: record?.employeeId || "",
    date: record?.date || "",
    checkIn: record?.checkIn || "",
    checkOut: record?.checkOut || "",
    breakMinutes: Number(record?.breakMinutes || 0),
    source: record?.source || "manual",
    createdAt: record?.createdAt || new Date().toISOString(),
    updatedAt: record?.updatedAt || new Date().toISOString(),
  };
}

export function isCloudSyncEnabled() {
  return isFirebaseConfigured;
}

export function getCloudSyncError() {
  return firebaseConfigError;
}

export async function ensureCloudSession() {
  if (!isFirebaseConfigured || !firebaseAuth) {
    throw new Error(firebaseConfigError || "Firebase no esta configurado.");
  }

  if (firebaseAuth.currentUser) {
    return firebaseAuth.currentUser;
  }

  const credential = await signInAnonymously(firebaseAuth);
  return credential.user;
}

export function subscribeToCloudData({
  defaultSettings,
  onSettings,
  onRecords,
  onError,
}) {
  if (!firestoreDb) {
    return () => {};
  }

  const unsubscribeSettings = onSnapshot(
    getSettingsRef(),
    async (snapshot) => {
      try {
        if (!snapshot.exists()) {
          await setDoc(getSettingsRef(), normalizeSettings(defaultSettings, defaultSettings));
          return;
        }

        onSettings(normalizeSettings(snapshot.data(), defaultSettings));
      } catch (error) {
        onError(error);
      }
    },
    onError
  );

  const unsubscribeRecords = onSnapshot(
    getRecordsCollectionRef(),
    (snapshot) => {
      const nextRecords = snapshot.docs.map((recordDoc) =>
        normalizeRecord(recordDoc.data(), recordDoc.id)
      );
      onRecords(nextRecords);
    },
    onError
  );

  return () => {
    unsubscribeSettings();
    unsubscribeRecords();
  };
}

export async function saveSettingsToCloud(settings) {
  await setDoc(getSettingsRef(), normalizeSettings(settings, settings), {
    merge: true,
  });
}

export async function saveRecordToCloud(record) {
  const payload = normalizeRecord(record);
  await setDoc(getRecordRef(payload.id), payload, { merge: true });
}

export async function deleteRecordFromCloud(recordId) {
  await deleteDoc(getRecordRef(recordId));
}
