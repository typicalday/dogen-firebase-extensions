Dogen is a next generation Firebase client (like a CMS web client) which elevates your Firebase experience with its own custom types (Color, Email, Image, etc.), import/export CSV/JSON jobs, structured data (schemas), validations, relationships, and more.  For more details, please visit the [Dogen website](https://dogen.io).

IMPORTANT: This extension has requirements that must be met before installation.  

Follow the installation steps from the [Getting Started Docs](https://www.dogen.io/docs/getting-started).

#### How will this affect my Google billing?

This extension uses Firebase and Google Cloud Platform services which may have associated charges:

- Firestore Database to store your application data.
- Cloud Functions for reacting to changes in your Firestore database.
- Secret Manager to store Dogen's API key.
- Task Queues to manage batch processes.

Dogen provides advanced administrative capabilities, allowing you to perform complex actions (like import/export CSV/JSON jobs, batch deletions, etc.) on your cloud resources. While the extension itself has minimal billing impact, your actions using the extension and associated client will incur standard Firebase and Google Cloud Platform charges. It is recommended to frequently monitor your Firebase project's usage in the Firebase console.

#### Note from Firebase

To install this extension, your Firebase project must be on the Blaze (pay-as-you-go) plan. You will only be charged for the resources you use. Most Firebase services offer a free tier for low-volume use. [Learn more about Firebase billing.](https://firebase.google.com/pricing)

You will be billed a small amount (typically less than $0.10) when you install or reconfigure this extension. See Cloud Functions under [Firebase Pricing](https://firebase.google.com/pricing) for a detailed explanation.