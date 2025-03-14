# How do I install it?

IMPORTANT: This extension has requirements that must be met before installation.  

Follow the installation steps from the [Getting Started Docs](https://www.dogen.io/docs/getting-started).

# What does it do?

Dogen is a next generation Firestore client (like a CMS web client) which turbocharges your Firestore experience with its own custom types (Color, Email, Image, etc.), import/export CSV/JSON jobs, structured data (schemas), validations, and more.  For more details, please visit the [Dogen website](https://dogen.io).

# How will this affect my Google billing?

This extension uses Firebase and Google Cloud Platform services which may have associated charges:

- Firestore Database to store your application data.
- Cloud Functions for reacting to changes in your Firestore database.
- Secret Manager to store Dogen's official API key.
- Task Queues to manage batch processes.

Dogen provides advanced administrative capabilities, allowing you to perform complex actions (like import/export CSV/JSON jobs, batch deletions, etc.) on your cloud resources. Be mindful when using these features to avoid incurring unexpected charges. It is recommended to frequently monitor the usage of the extension in the Firebase console.

When you use Firebase Extensions, you're only charged for the underlying resources that you use. A paid-tier billing plan is only required if the extension uses a service that requires a paid-tier plan, for example, calling a Google Cloud Platform API or making outbound network requests to non-Google services. All Firebase services offer a free tier of usage. [Learn more about Firebase billing.](https://firebase.google.com/pricing)
