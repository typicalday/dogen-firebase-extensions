# What does it do?

Dogen is a no-code CMS web client which manages any data structure out of the box. For more details, please visit the [Dogen website](https://dogen.io).

# How do I install it?

For the latest installation details and requirements, please visit the [Getting Started Docs](https://www.dogen.io/docs/getting-started).

# How will this affect my Google billing?

This extension uses Firebase and Google Cloud Platform services which may have associated charges:

- Firestore Database to store your application data.
- Cloud Functions for reacting to changes in your Firestore database.
- Secret Manager to store Dogen's official API key.
- Task Queues to manage batch processes.

Dogen provides advanced administrative capabilities, allowing you to perform complex actions on these cloud resources. Be mindful when using these features to avoid incurring unexpected charges. It is recommended to frequently monitor the usage of the extension in the Firebase console.

When you use Firebase Extensions, you're only charged for the underlying resources that you use. A paid-tier billing plan is only required if the extension uses a service that requires a paid-tier plan, for example, calling a Google Cloud Platform API or making outbound network requests to non-Google services. All Firebase services offer a free tier of usage. [Learn more about Firebase billing.](https://firebase.google.com/pricing)
