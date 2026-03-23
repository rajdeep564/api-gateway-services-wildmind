import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { adminDb } from '../src/config/firebaseAdmin';

const logFile = path.resolve(__dirname, 'debug_data_log.txt');
function log(msg: string) {
    fs.appendFileSync(logFile, msg + '\n');
    console.log(msg);
}

async function verifyData() {
    try {
        const snapshot = await adminDb.collection('templates').limit(1).get();
        if (snapshot.empty) {
            log('No templates found');
            return;
        }

        const tmpl = snapshot.docs[0].data();
        log(`Template ID: ${tmpl.id}`);
        log(`Template Name: ${tmpl.name}`);

        if (tmpl.data && tmpl.data.objects) {
            log(`Object Count: ${tmpl.data.objects.length}`);
            tmpl.data.objects.slice(0, 5).forEach((el: any, idx: number) => {
                log(`Object ${idx} Type: ${el.type}`);
            });
        }

        if (tmpl.data && tmpl.data.elements) {
            log(`Element Count: ${tmpl.data.elements.length}`);
            tmpl.data.elements.slice(0, 5).forEach((el: any, idx: number) => {
                log(`Element ${idx} Type: ${el.type}`);
            });
        }

        if (!tmpl.data?.objects && !tmpl.data?.elements) {
            log('No elements or objects found');
            if (tmpl.data) log(`Keys: ${Object.keys(tmpl.data).join(', ')}`);
        }

    } catch (e: any) {
        log(e.message);
    }
}

fs.writeFileSync(logFile, '');
verifyData();
