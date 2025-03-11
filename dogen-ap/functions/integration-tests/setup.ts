import * as admin from "firebase-admin";

// Set environment variables for emulators
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:5080";
process.env.GCLOUD_PROJECT = "demo-test";

// Uncomment this block to silence console logs during tests
// If you need to see all logs, keep this commented out
/*
if (process.env.TEST_QUIET !== "false") {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  // Store original functions to use for important messages
  console.log = function(...args) {
    if (args[0] === "IMPORTANT:") {
      originalConsoleLog.apply(console, args);
    }
  };
  
  console.error = function(...args) {
    if (args[0] === "IMPORTANT:") {
      originalConsoleError.apply(console, args);
    }
  };
}
*/

// Initialize Firebase Admin SDK for testing only if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "demo-test",
    storageBucket: "demo-test.appspot.com"
  });
  console.log("Firebase initialized for testing");
}

export { admin };
