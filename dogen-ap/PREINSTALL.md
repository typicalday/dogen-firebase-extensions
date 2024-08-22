<div style="text-align: center;">
    <svg width="100" height="100" viewBox="0 0 1333.000000 1333.000000"
       preserveAspectRatio="xMidYMid meet">
       <g transform="translate(0.000000,1333.000000) scale(0.100000,-0.100000)" fill="#ddd" stroke="none" id="g659">
          <path
          d="M1870 11786 l0 -974 933 -540 c910 -527 2894 -1673 5120 -2957 609 -352 1106 -644 1104 -649 -4 -13 -62 -48 -457 -279 -179 -104 -374 -222 -435 -262 -188 -124 -698 -415 -728 -415 -13 0 -4149 -2443 -4184 -2472 -10 -8 -11 -213 -6 -957 3 -520 7 -948 9 -950 2 -2 12 3 22 12 10 10 23 17 29 17 6 0 13 3 15 8 6 13 63 48 148 91 47 23 126 66 175 96 50 30 95 54 101 55 6 0 19 9 29 20 10 11 24 20 31 20 7 0 17 6 21 13 4 6 24 20 43 29 73 36 246 130 280 152 51 34 143 91 160 100 8 4 33 18 55 31 22 13 76 42 120 65 44 23 87 47 95 54 8 7 30 18 48 26 17 7 32 16 32 20 0 4 24 20 53 35 28 15 59 33 67 40 8 8 27 16 42 20 15 4 32 13 39 21 6 8 18 14 25 14 8 0 14 4 14 9 0 5 37 28 83 51 45 23 89 47 97 54 8 6 31 20 50 29 19 10 62 36 95 57 33 22 71 44 85 50 14 5 32 15 40 20 8 6 25 14 38 20 12 5 22 14 22 19 0 5 17 16 38 25 20 9 51 25 67 36 17 11 50 30 75 41 40 19 111 60 238 136 20 13 47 27 59 32 11 5 24 14 27 19 6 9 82 51 199 109 26 13 47 28 47 32 0 5 14 14 30 20 17 5 54 26 83 45 28 19 63 40 77 46 30 13 69 35 90 50 36 26 148 91 183 106 20 9 37 20 37 24 0 5 20 16 45 26 25 9 45 21 45 25 0 5 9 9 20 9 11 0 20 5 20 11 0 5 19 19 43 30 23 11 60 31 82 44 22 13 57 31 78 40 20 10 37 21 37 26 0 5 9 9 20 9 11 0 20 5 20 11 0 5 20 19 45 30 24 11 47 24 50 29 3 5 38 26 78 46 110 55 141 72 153 82 6 5 20 13 32 16 12 4 22 11 22 17 0 5 16 15 35 23 19 8 59 30 88 48 95 60 182 110 292 168 44 23 88 50 98 61 10 10 23 19 30 19 7 0 43 20 82 45 38 25 73 45 76 45 4 0 31 16 60 35 30 19 59 35 65 35 6 0 24 10 39 22 15 11 58 36 96 54 39 19 143 76 232 128 219 127 762 441 1271 735 230 133 511 299 625 368 434 265 539 328 981 583 711 411 932 542 923 550 -18 17 -494 293 -2313 1342 -2027 1170 -3772 2178 -5960 3443 -1683 973 -2259 1305 -2265 1305 -3 0 -5 -438 -5 -974z"
          id="path655" />
       </g>
       <path style="fill:#ccc;stroke-width:15.0621"
          d="m 625.0791,895.16502 c 0,-160.97353 3.16119,-292.67914 7.02487,-292.67914 3.86368,0 97.06071,52.02899 207.10453,115.61997 110.0438,63.59099 218.6762,126.28717 241.4053,139.32486 22.7291,13.03769 41.2354,27.09387 41.125,31.23596 -0.11,4.14209 -111.904,73.15151 -248.43019,153.35433 L 625.0791,1187.8442 Z"
          id="path922" transform="scale(0.75)" />
    </svg>
</div>

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

1. **Accept the Terms of Service**
   - **Important**: Dogen is currently in its alpha testing phase and is provided "as is" without any warranties. We advise using it with caution, regularly backing up your data, and reviewing your Firebase billing to avoid unexpected charges.
   - By installing this extension and using Dogen services, you agree to our [Terms of Service](https://dogen.io/terms-of-service).
2. **Enable the Blaze Billing plan**
   - **Note**: In order to use Firebase Extensions, you must enable the Blaze plan for your Firebase project.  This is a Firebase requirement, not a Dogen one.
   - To enable the Blaze plan, go to the Firebase console and click on the cog next to Project Overview.  
   - In the dropdown menu choose **Usage and billing**.
   - Click the **Details & settings** tab.
   - Enable the Blaze plan.
  
3. **Create a Firestore Database**
   - Set up a Firestore database in your Firebase project.
  
4. **Enable Authentication**
   - Enable Firebase Authentication in your Firebase project.
   - Enable the **Email/Password** sign-in method.
   - Create a new user account if you don't have one so that you can administer your project.

5. **Create a New Web App**
   - Go to the Firebase console and click on **Project Settings**.
   - Under the **Your apps** section, click **Add app**.
   - Follow the instructions to register a new Web App for the Dogen AP client.
   - Copy the Firebase configuration object for the new Web App and paste it temporarily into your preferred text editor.  You will reference these values in a minute.

6. **Install and register the Dogen Application Platform extension**
   - In the Firebase console, navigate to **Extensions**.
   - Click **Explore extensions** and search for **Dogen Application Platform**.
   - Click **Install**.
   - On the Extension Configuration page, provide the following:
     - Your desired Dogen service registration email.
     - An invitation code, if you have one. If not, leave it blank to be added to the waitlist.
     - Your official Dogen API key, if you have one.  If not, leave it blank.
     - The remaining configuration values from the Firebase configuration object you copied earlier.
   - Finalize the installation and wait for it to complete. We will send you an email with further instructions.
   - **Note:** API keys and invitation codes work on a per project basis. If you have multiple Firebase projects, each one will need its own separate extension installation, API key, and invitation code (or waitlist entry if left blank).
7. **Update your Firestore Rules**
   - Dogen AP is a Firebase client application like any other. It facilitates access to your Firestore data, but the underlying logged in user must have the appropriate permissions to access the data. You can use the following Firestore rules to grant global access to Dogen AP admins or you can create more granular rules to suit your needs.
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

We achieve iteration by allowing each version of your application to act as a blueprint editor where you can define exactly what you need for the next version.  When you're ready, you create a generation in the Dogen AP and this Firestore change triggers a request to our API (containing your blueprints).  We build the application to your specifications, and when its ready, your previous version will notify you that a new version is available.  You can then seamlessly load the new version from within the UI and carry on.  The end result is a custom made application which addresseses your needs.  

The iterative process mirrors a development workflow. It allows you to define exactly what you need, preview it, and if you're happy you keep it, if not you can try again (Or you can load a previous version and carry on from there!).

# How do I ensure data integrity with Dogen?<a name="how-do-i-ensure-data-integrity-with-dogen" />

The Dogen Application Platform is designed to help you manage your data efficiently, with a strong focus on improving data integrity. However, the extension is currently in its alpha stage, meaning its use is experimental.

As part of a responsible data management strategy, it's crucial to back up your data frequently. We recommend using the Firestore export feature for this purpose. You can learn more about Firestore exports [here](https://firebase.google.com/docs/firestore/manage-data/export-import).

While we plan to introduce more advanced data backup features in the future, we urge you to remain cautious and prioritize regular data backups in the meantime.

# Will Dogen have access to my data?<a name="will-dogen-have-access-to-my-data" />

In short, Dogen's services and team will never have direct access to your project resources or application data.  Information flows from the open source extension you install (which provides Firestore triggers to communicate **only blueprint data** to Dogen's API).  The API then generates a Firebase web application.  This application requires a logged in user to gain access to your database.  Its this logged in user who has the access, not the application itself.  

The biggest takeaway here is the application platform only communicates with your Firebase project.  This means the data only flows in one direction.  The end result is we only receive blueprint data and we have no way to access your application data, and thats the best kind of privacy there is!

# How will this affect my Google billing?<a name="how-will-this-affect-my-google-billing" />

This extension uses Firebase and Google Cloud Platform services which may have associated charges:

- Firestore Database
- Cloud Functions
- Secret Manager to store Dogen's official API key
- Task Queues

Dogen provides advanced administrative capabilities, allowing you to perform complex actions on these cloud resources. With great power comes great responsibility. Be aware and take care when using these features to avoid incurring unexpected charges. It is recommended to frequently monitor the usage of the extension in the Firebase console.

When you use Firebase Extensions, you're only charged for the underlying resources that you use. A paid-tier billing plan is only required if the extension uses a service that requires a paid-tier plan, for example, calling a Google Cloud Platform API or making outbound network requests to non-Google services. All Firebase services offer a free tier of usage. [Learn more about Firebase billing.](https://firebase.google.com/pricing)
