import * as admin from "firebase-admin";
import {firestore, logger} from "firebase-functions";

export default firestore
  .document("config_parameter_updates/{documentId}")
  .onWrite(async (change, context) => {
    // If the document is deleted, there's nothing to do
    if (!change.after.exists) {
      return null;
    }

    // Get the document ID and 'value' field
    const documentId = context.params.documentId;
    const newValue = change.after.data();

    // Interact with Firebase Remote Config
    const remoteConfig = admin.remoteConfig();

    const template = await remoteConfig.getTemplate();
    if (!template.parameters) {
      template.parameters = {};
    }

    // Update the parameter with the document ID and the new value
    template.parameters[documentId] = {
      defaultValue: {
        value: JSON.stringify(newValue),
      },
      valueType: "JSON",
      description: newValue?.description,
    };

    // Publish the updated template
    try {
      await remoteConfig.publishTemplate(template);

      logger.log(
        `Successfully updated remote config parameter: ${documentId}`,
        {newValue},
      );

      // After a successful update, delete the document
      await change.after.ref.delete();
      logger.log(`Document deleted: ${documentId}`);
    } catch (error) {
      logger.error(
        `Failed to update remote config parameter: ${documentId}.`,
        {error},
      );
    }

    return null;
  });
