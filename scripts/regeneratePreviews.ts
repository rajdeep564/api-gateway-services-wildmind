import path from 'path';
import dotenv from 'dotenv';
// Load env before imports
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { adminDb } from '../src/config/firebaseAdmin';
import { previewService } from '../src/services/previewService';
import { Template } from '../src/types/template';

async function regeneratePreviews() {
    console.log('[Regenerate] Starting preview regeneration...');

    try {
        const templatesSnap = await adminDb.collection('templates').get();
        if (templatesSnap.empty) {
            console.log('[Regenerate] No templates found.');
            return;
        }

        const templates = templatesSnap.docs.map(doc => doc.data() as Template);
        console.log(`[Regenerate] Found ${templates.length} templates.`);

        for (const template of templates) {
            console.log(`[Regenerate] Processing: ${template.name} (${template.id})`);
            try {
                // Await the generation!
                const url = await previewService.generatePreview(template);
                console.log(`[Regenerate] Success: ${url}`);
            } catch (err) {
                console.error(`[Regenerate] Failed for ${template.id}:`, err);
            }
        }

        console.log('[Regenerate] All done!');
        process.exit(0);

    } catch (error) {
        console.error('[Regenerate] Fatal error:', error);
        process.exit(1);
    }
}

regeneratePreviews();
