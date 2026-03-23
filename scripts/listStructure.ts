import path from 'path';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { templateService } from '../src/services/templateService';

async function listStructure() {
    try {
        console.log('--- Categories ---');
        const categories = await templateService.getCategories();
        categories.forEach(c => console.log(`- ${c.name} (ID: ${c.id})`));

        console.log('\n--- Themes ---');
        // We'll just fetch all themes, but getThemes takes an optional categoryId.
        // Let's fetch for 'ecommerce' specifically if it exists, or listing all might be too much if unconnected.
        // Actually getThemes without arg queries all themes in logic?
        // Checking service code: `if (categoryId) query...` else returns all.

        const themes = await templateService.getThemes();
        themes.forEach(t => console.log(`- ${t.name} (ID: ${t.id}) [Category: ${t.categoryId}]`));

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

listStructure();
