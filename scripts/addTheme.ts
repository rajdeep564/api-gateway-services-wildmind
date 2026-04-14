import path from 'path';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { templateService } from '../src/services/templateService';

async function addThemes() {
    console.log('Adding new themes...');

    const themesToAdd = [
        {
            id: 'cyber_future',
            categoryId: 'technology',
            name: 'Cyber Future',
            description: 'Futuristic and tech-focused design theme.',
            order: 1
        }
    ];

    for (const theme of themesToAdd) {
        try {
            await templateService.createTheme(theme);
            console.log(`✅ Successfully created theme: ${theme.name} (${theme.id}) in category: ${theme.categoryId}`);
        } catch (err) {
            console.error(`❌ Failed to create theme ${theme.name}:`, err);
        }
    }

    process.exit(0);
}

addThemes();
