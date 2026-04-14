import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { adminDb } from '../src/config/firebaseAdmin';
import { previewService } from '../src/services/previewService';
import { Template } from '../src/types/template';

const logFile = path.resolve(__dirname, 'debug_log.txt');
function log(msg: string) {
    fs.appendFileSync(logFile, msg + '\n');
    console.log(msg);
}

async function debugPreviewGen() {
    log('[Debug] Starting limited preview generation...');

    try {
        const templatesSnap = await adminDb.collection('templates').limit(1).get();
        if (templatesSnap.empty) {
            log('[Debug] No templates found.');
            return;
        }

        const templates = templatesSnap.docs.map(doc => doc.data() as Template);
        log(`[Debug] Found ${templates.length} templates.`);

        for (const template of templates) {
            log(`[Debug] Processing: ${template.name} (${template.id})`);
            try {
                const url = await previewService.generatePreview(template);
                log(`[Debug] Success: ${url}`);
            } catch (err: any) {
                log(`[Debug] Failed for ${template.id}: ${err.message}`);
                if (err.stack) log(err.stack);
            }
        }
    } catch (error) {
        log(`[Debug] Fatal error: ${error}`);
    }
    process.exit(0);
}

// Clear log file
fs.writeFileSync(logFile, '');
debugPreviewGen();
