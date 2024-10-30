import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as utils from "../utils/utils";

export const updateGenerationWebhook = functions.https.onRequest(async (req, res) => {
    // Only allow POST requests
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    try {
        const { generationId, generationAppVersion, status, templateVersion, outputMessage, } = req.body;

        const key = req.query.key as string;

        // Validate the required fields
        if (!generationId || !generationAppVersion || !key || !status) {
            functions.logger.error('Missing required fields:', {
                generationId, 
                generationAppVersion, 
                key, 
                status 
            });
            res.status(400).send('Missing required fields');
            return;
        }

        // Retrieve the generation document
        const generationRef = admin.firestore().collection(utils.generationCollectionId).doc(generationId);
        const generationDoc = await generationRef.get();

        if (!generationDoc.exists) {
            functions.logger.error('Generation not found:', { generationId });
            res.status(404).send('Generation not found');
            return;
        }

        // Validate the webhook key
        const generationData = generationDoc.data();

        if (generationData?.webhookKey !== key) {
            functions.logger.error('Invalid webhook key:', { generationId, key });
            res.status(403).send('Invalid webhook key!');
            return;
        }

        // Prepare the update object
        const updateData: { 
            status: string,
            appVersion: string, 
            outputMessage?: string, 
            templateVersion?: string 
        } = { status, appVersion: generationAppVersion };

        if (outputMessage !== undefined) {
            updateData.outputMessage = outputMessage;
        }

        if (templateVersion != undefined) {
            updateData.templateVersion = templateVersion;
        }

        // Update the Firestore document
        await generationRef.update(updateData);

        functions.logger.info('Generation updated successfully!', { id: generationId });

        res.status(200).send('Generation updated successfully!');
    } catch (error) {
        functions.logger.error('Error updating document:', error);
        res.status(500).send('Internal Server Error');
    }
});
