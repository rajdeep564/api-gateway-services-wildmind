import path from 'path';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { templateService } from '../src/services/templateService';
import { adminDb } from '../src/config/firebaseAdmin';

async function removeCategory() {
    // ⚠️ CHANGE THIS ID to the category you want to remove
    const categoryId = 'sports';

    console.log(`Attempting to remove category: ${categoryId}...`);

    // 1. Check if category exists
    const catDoc = await adminDb.collection('template_categories').doc(categoryId).get();
    if (!catDoc.exists) {
        console.error(`❌ Category '${categoryId}' does not exist!`);
        process.exit(1);
    }

    // 2. Find dependencies (Themes and Templates)
    const themesSnap = await adminDb.collection('template_themes')
        .where('categoryId', '==', categoryId)
        .get();

    const templatesSnap = await adminDb.collection('templates')
        .where('categoryId', '==', categoryId)
        .get();

    if (!themesSnap.empty || !templatesSnap.empty) {
        console.log(`⚠️  Found dependencies:`);
        console.log(`   - ${themesSnap.size} Themes`);
        console.log(`   - ${templatesSnap.size} Templates`);
        console.log(`🗑️  Starting CASCADE DELETE...`);

        const batch = adminDb.batch();

        // Delete all templates
        templatesSnap.docs.forEach(doc => {
            console.log(`   - Deleting template: ${doc.id}`);
            batch.delete(doc.ref);
        });

        // Delete all themes
        themesSnap.docs.forEach(doc => {
            console.log(`   - Deleting theme: ${doc.id}`);
            batch.delete(doc.ref);
        });

        // Execute batch delete
        await batch.commit();
        console.log('✅ All dependencies deleted successfully.');
    } else {
        console.log('ℹ️  No dependencies found (clean category).');
    }

    // 3. Delete Category
    try {
        await templateService.deleteCategory(categoryId);
        console.log(`✅ Successfully deleted category: ${categoryId}`);
    } catch (err) {
        console.error('❌ Failed to delete category:', err);
    }

    process.exit(0);
}

removeCategory();
