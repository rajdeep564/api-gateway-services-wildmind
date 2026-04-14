import path from 'path';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { templateService } from '../src/services/templateService';

async function addCategory() {
    console.log('Adding new category...');

    // Define the new category
    const newCategory = {
        id: 'sports',                    // Unique ID
        name: 'Sports',                  // Display name
        description: 'Sports templates for teams, matches, and events',
        order: 11                        // Display order in UI
    };

    try {
        await templateService.createCategory(newCategory);
        console.log(`✅ Successfully created category: ${newCategory.name} (${newCategory.id})`);
    } catch (err) {
        console.error('❌ Failed to create category:', err);
    }

    process.exit(0);
}

addCategory();
