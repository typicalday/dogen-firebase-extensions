# Table of Contents<a name="table-of-contents" />

- [Table of Contents](#table-of-contents)
- [What does it do?](#what-does-it-do)
- [Who Is It For?](#who-is-it-for)
- [Aren't NoSQL Databases Schema-less?](#arent-nosql-databases-schema-less)
- [How do I get started?](#how-do-i-get-started)
- [How does it work?](#how-does-it-work)
- [How do I ensure data integrity with Dogen?](#how-do-i-ensure-data-integrity-with-dogen)
- [Will Dogen have access to my data?](#will-dogen-have-access-to-my-data)
- [How will this affect my Google billing?](#how-will-this-affect-my-google-billing)

# What does it do?<a name="what-does-it-do" />

Use this extension to integrate with Dogen's Application Platform, which is a tool that lets you manage your application's data and resources within the Firebase ecosystem.

||CMS|Firestore Clients|Dogen AP|
|--- |--- |--- |--- |
|Entity Schemas & Validations|&check;|&cross;|&check;|
|Natively Manage **Any** Firestore Data|&cross;|&check;|&check;|
|Compatible with Firestore Types & Paths|&cross;|&check;|&check;|
|Intuitive Relationship Management & Navigation|&cross;|&cross;|&check;|
|Cascading Configurations & Validations|&cross;|&cross;|&check;|
|JSON Diff View|&cross;|&cross;|&check;|

# Who Is It For?<a name="who-is-it-for" />

This extension is for developers building awesome applications.  The thing is, truly awesome applications typically leverage complex data structures such as arrays of maps, maps of objects, nested objects, and so on. If your go-to data management solution cannot natively handle these complex data structures it can lead to challenges and negative outcomes for your dev team.  Have you ever flattened a complex data structure just to make it easier to manage that data?  Have you ever substituted a map with one or two arrays?  Have you ever had to write custom code to manage a complex data structure?  These are all very real compromises that can lead to data integrity issues.

With Dogen we hope to eliminate data management compromises so you can focus on things that truly matter.  If you can store it in the database, we'll give you a way to manage it out of the box, its that simple.

# Aren't NoSQL Databases Schema-less?<a name="arent-nosql-databases-schema-less" />

Yes, NoSQL database engines are schema-less. This is what makes them fast, flexible, and incredibly powerful. However, this doesn't mean your application data should be unstructured. It simply means the database engine is deferring this responsibility to the application layer (aka.. "You deal with it").

NoSQL database clients subscribe to the same ideology. They only care that your input can be stored properly in the database engine. They do not care about the quality of your input. By default, these tools **trust user input**. As developers, we know we should never trust user input, yet we do it all the time by using NoSQL DB clients for data management. Dogen's Application Platform is designed to address this potentially disastrous validation gap. It's an added safety net to help you maintain the quality of your data.  There is a popular saying: "Data is the new gold", but in reality, its reliable data that is the new gold.

# How do I get started?<a name="how-do-i-get-started" />

1. **Create a Firestore Database**
   - Set up a Firestore database in your Firebase project.

2. **Create a New Web App**
   - Go to the Firebase console and click on **Project Settings**.
   - Under the **Your apps** section, click **Add app**.
   - Follow the instructions to register a new Web App for the Dogen client.
   - Copy the Firebase configuration object for the new Web App and paste it temporarily into your preferred text editor.

3. **Install and register the Dogen Application Platform extension**
   - In the Firebase console, navigate to **Extensions**.
   - Click **Explore extensions** and search for **Dogen Application Platform**.
   - Click **Install**.
   - On the Extension Configuration page, provide the following:
     - Your desired Dogen service registration email.
     - An invitation code, if you have one. If not, leave it blank to be added to the waitlist.
     - Your official Dogen API key, if you have one.
     - The remaining configuration values from the Firebase configuration object you copied earlier.
   - Finalize the installation and wait for it to complete. We will send you an email with further instructions.
   - **Note:** API keys and invitation codes work on a per project basis. If you have multiple Firebase projects, each one will need its own separate extension installation, API key, and invitation code.  This could also result in one project being on the waitlist while another is not.
4. **Update your Firestore Rules**
   - Dogen AP is a client like any other. It facilitates access to your Firestore data, but the underlying logged in user must have the appropriate permissions to access the data. You can use the following Firestore rules to grant global access to Dogen AP admins or you can create more granular rules to suit your needs.
     ```plaintext
        rules_version = '2';
        service cloud.firestore {
            function isAuthorized(role) {
                return request.auth != null && ('admin' in request.auth.token.dogenRoles || role in request.auth.token.dogenRoles);
            }
            match /databases/{database}/documents {
                match /{document=**} {
                    allow read, write: if isAuthorized('admin');
                }
            }
        }
     ```
     - **Note:** At the moment Dogen AP's UI is primarily designed for admin users. In the future we will add more capabilities for non admin roles.

# How does it work?<a name="how-does-it-work" />

The Dogen Application Platform is a data management solution unlike any you've likely encountered in the past. This is because your Dogen AP is custom-made for you through code generation. This in itself is not novel, however, we've made the code generation process iterative.  This means each version of your application is a stepping stone to the next version.

We achieve iteration by allowing each version of your application to act as a blueprint editor where you can define exactly what you need for the next version.  When you're ready, you create a generation in the Dogen AP and this Firestore change triggers a request to our API (containing your blueprints).  We build the application to your specifications, and when its ready, your old version will notify you that a new version is available.  You can then seamlessly load the new version from within the UI and carry on.  The end result is a custom made application which addresseses your needs.  

The iterative process mirrors a development workflow. It allows you to define exactly what you need, preview it, and if you're happy you keep it, if not you can try again (Or you can load a previous version and carry on from there!).

# How do I ensure data integrity with Dogen?<a name="how-do-i-ensure-data-integrity-with-dogen" />

The Dogen Application Platform is designed to help you manage your data efficiently, with a strong focus on improving data integrity. However, the extension is currently in its alpha stage, meaning its use is experimental.

As part of a responsible data management strategy, it's crucial to back up your data frequently. We recommend using the Firestore export feature for this purpose. You can learn more about Firestore exports [here](https://firebase.google.com/docs/firestore/manage-data/export-import).

While we plan to introduce more advanced data backup features in the future, we urge you to remain cautious and prioritize regular data backups in the meantime.

# Will Dogen have access to my data?<a name="will-dogen-have-access-to-my-data" />

In short, Dogen's services and team will never have direct access to your application data.  Information flows from the open source extension you install (which provides Firestore triggers to communicate **only blueprint data** to Dogen's API).  The API then generates a Firebase web application.  This application requires a logged in user to gain access to your database.  Its this logged in user who has the access, not the application itself.  The most important part here is the application platform only communicates with your Firebase project.  This means the data only flows in one direction.  The end result is we only receive blueprint data and we have no way to access your application data, and thats the best kind of privacy there is!

# How will this affect my Google billing?<a name="how-will-this-affect-my-google-billing" />

This extension uses Firebase and Google Cloud Platform services, which may have associated charges:

- Firestore Database
- Cloud Functions
- Secret Manager to store Dogen's official API key
- Task Queues

Dogen provides advanced administrative capabilities, allowing you to perform complex actions on these cloud resources. With great power comes great responsibility. Be aware and take care when using these features to avoid incurring unexpected charges. It is recommended to frequently monitor the usage of the extension in the Firebase console.

When you use Firebase Extensions, you're only charged for the underlying resources that you use. A paid-tier billing plan is only required if the extension uses a service that requires a paid-tier plan, for example, calling a Google Cloud Platform API or making outbound network requests to non-Google services. All Firebase services offer a free tier of usage. [Learn more about Firebase billing.](https://firebase.google.com/pricing)
