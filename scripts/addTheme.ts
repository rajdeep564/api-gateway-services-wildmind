import path from 'path';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { templateService } from '../src/services/templateService';

async function addThemes() {
    console.log('Adding new themes...');

    const themesToAdd = [
        {
            id: 'indoor-games',
            categoryId: 'sports',
            name: 'Indoor Games',
            description: 'Templates for indoor sports like Badminton, Table Tennis, etc.',
            order: 1
        },
        {
            id: 'outdoor-games',
            categoryId: 'sports',
            name: 'Outdoor Games',
            description: 'Templates for outdoor sports like Football, Cricket, etc.',
            order: 2
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
