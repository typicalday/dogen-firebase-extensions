import * as admin from "firebase-admin";

// Set environment variables for emulators
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:5080";
process.env.GCLOUD_PROJECT = "demo-test";

// Initialize Firebase Admin SDK for testing only if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "demo-test",
    storageBucket: "demo-test.appspot.com"
  });
  console.log("Firebase initialized for testing");
}

export { admin };
