# We're on it!

We are setting up your Dogen Application Platform. You will receive an email shortly with detailed instructions on how to proceed.

# Additional Details

In the meantime, you may notice a `dogen_application` collection in your Firestore database. This collection is used to store basic installation details, including a temporary (unsecure) API key for convenience purposes to get you started.  You should never need to modify this collection.  

When we provide you an official Dogen API key, please ensure it is stored in the extension configuration under the `Dogen API Key` parameter.  This parameter uses Google Secret Manager for enhanced security.

# Troubleshooting

If you encounter any issues, please check out the [troubleshooting documentation](https://www.dogen.io/docs/troubleshooting#firebase-extension-issues).

# Monitoring

As a best practice, you can [monitor the activity](https://firebase.google.com/docs/extensions/manage-installed-extensions#monitor) of your installed extension, including checks on its health, usage, and logs.
