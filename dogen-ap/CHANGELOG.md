## Version 4.1.8
- Fix registry firestore paths validations.
- Add support for logAiResponses flag to ai orchestrate validations.
- Add vertex AI API to extension.yaml.

## Version 4.1.7
- Add verbose flag to job and ai orchestrate task.
- Include dependency task results in AI orchestrate prompt.

## Version 4.1.6
- Fix import errors.

## Version 4.1.5
- Fixed issue with dependencies.

## Version 4.1.4
- Added support for AI orchestration.

## Version 4.1.3
- Fixed issue where Storage Security Rules were not being updated properly.
  
## Version 4.1.2
- Updated Firestore Security Rules role to firebaserules.admin since the Firebase docs were incorrect.

## Version 4.1.1
- Fixed issue with error when deploying Firestore and Storage Security Rules.
 
## Version 4.1.0
- Added support for configuring Dogen security rules automatically.

## Version 4.0.0
- Removed legacy Dogen account management.
- Added Authentication job to support Firebase Authentication user management.
- Added AI job to allow for AI services in the Dogen client.
- Fixed backup document creation paths.

## Version 3.2.1
- Fixed potential issue with onApplicationUpdate function not triggering properly.

## Version 3.2.0
- Added support for specifying the Firestore database ID where the Dogen will be installed.
- Added updatedAt to getUserData function.

## Version 3.1.0
- Added support for multiple project aliases (subdomains) to be able to access storage files.

## Version 3.0.1
- Added support for free dogen projects on storage CORS.

## Version 3.0.0
- Simplified the extension installation flow to perform registration through website.
- Added support for multiple databases.
- Added support for free tier (Optional API KEY).
- Added support for Firebase storage path prefix deletion.

## Version 2.2.0
- Update extension.yaml with Firebase extension review team's suggestions where possible.  Note: storage.admin is still required for CORS updates on buckets (https://cloud.google.com/storage/docs/using-cors).
  
## Version 2.1.2
- Use a custom authorization header for registration.

## Version 2.1.1
- Fixed issue with case sensitive import of JSONStream.

## Version 2.1.0
- Added import and export CSV + JSON functionality.

## Version 2.0.0
- Added Identity Token to registration. 

## Version 1.1.0
- Simplifying account/user management.

## Version 1.0.0
- Added the WEBHOOK_VALIDATION_SALT to enhance security of the webhook.