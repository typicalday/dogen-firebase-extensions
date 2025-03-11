import * as admin from "firebase-admin";

// Initialize Firebase only once
export function initializeFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.GCLOUD_PROJECT || "demo-test",
      storageBucket: `${process.env.GCLOUD_PROJECT || "demo-test"}.appspot.com`,
    });
    console.log("Firebase initialized successfully");
  }
  return admin;
}

export { admin }; 