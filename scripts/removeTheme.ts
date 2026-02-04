import path from 'path';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { templateService } from '../src/services/templateService';
import { adminDb } from '../src/config/firebaseAdmin';

async function removeTheme() {
    // ⚠️ CHANGE THIS ID to the theme you want to remove
    const themeId = 'outdoor-games';

    console.log(`Attempting to remove theme: ${themeId}...`);

    // 1. Check if theme exists
    const themeDoc = await adminDb.collection('template_themes').doc(themeId).get();
    if (!themeDoc.exists) {
        console.error(`❌ Theme '${themeId}' does not exist!`);
        process.exit(1);
    }

    // 2. Check for dependencies (Templates)
    const templatesSnap = await adminDb.collection('templates')
        .where('themeId', '==', themeId)
        .get();

    if (!templatesSnap.empty) {
        console.log(`⚠️  Found ${templatesSnap.size} templates in this theme.`);
        console.log(`🗑️  Starting CASCADE DELETE of templates...`);

        const batch = adminDb.batch();

        templatesSnap.docs.forEach(doc => {
            console.log(`   - Deleting template: ${doc.id}`);
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log('✅ All associated templates deleted.');
    } else {
        console.log('ℹ️  No templates found (clean theme).');
    }

    // 3. Delete Theme
    try {
        await templateService.deleteTheme(themeId);
        console.log(`✅ Successfully deleted theme: ${themeId}`);
    } catch (err) {
        console.error('❌ Failed to delete theme:', err);
    }

    process.exit(0);
}

removeTheme();
