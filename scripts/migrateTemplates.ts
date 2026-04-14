import path from 'path';
import dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import fs from 'fs';
import { adminDb } from '../src/config/firebaseAdmin';
import { templateService } from '../src/services/templateService';
import { TemplateCategory, TemplateTheme } from '../src/types/template';

// Adjust path based on your directory structure
// Assuming script is run from api-gateway-services-wildmind root
const TEMPLATES_DIR = path.resolve(__dirname, '../../mix_editor/designer/src/templates/data');

async function migrate() {
    console.log('[Migration] Starting template migration...');
    console.log(`[Migration] Reading from: ${TEMPLATES_DIR}`);

    if (!fs.existsSync(TEMPLATES_DIR)) {
        console.error(`[Migration] Templates directory not found: ${TEMPLATES_DIR}`);
        process.exit(1);
    }

    const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
    console.log(`[Migration] Found ${files.length} JSON files.`);

    for (const file of files) {
        const filePath = path.join(TEMPLATES_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        let templates: any[] = [];

        try {
            templates = JSON.parse(content);
            if (!Array.isArray(templates)) {
                console.warn(`[Migration] Skipping ${file}: Not an array.`);
                continue;
            }
        } catch (e) {
            console.error(`[Migration] Failed to parse ${file}: ${e}`);
            continue;
        }

        console.log(`[Migration] Processing ${file} (${templates.length} templates)...`);

        for (const tmpl of templates) {
            if (!tmpl.id || !tmpl.category || !tmpl.theme) {
                console.warn(`[Migration] Skipping invalid template in ${file}`);
                continue;
            }

            // 1. Ensure Category exists
            const categoryId = tmpl.category.toLowerCase().replace(/\s+/g, '-');
            const categoryRef = adminDb.collection('template_categories').doc(categoryId);
            const categorySnap = await categoryRef.get();

            if (!categorySnap.exists) {
                const newCat: TemplateCategory = {
                    id: categoryId,
                    name: tmpl.category, // You might want to format this (uppercase first letter)
                    description: `${tmpl.category} templates`,
                    order: 99
                };
                await categoryRef.set(newCat);
                console.log(`[Migration] Created category: ${tmpl.category}`);
            }

            // 2. Ensure Theme exists
            const themeId = tmpl.theme.toLowerCase().replace(/\s+/g, '-');
            const themeRef = adminDb.collection('template_themes').doc(themeId);
            const themeSnap = await themeRef.get();

            if (!themeSnap.exists) {
                const newTheme: TemplateTheme = {
                    id: themeId,
                    categoryId: categoryId,
                    name: tmpl.theme, // Format if needed
                    description: `${tmpl.theme} theme`,
                    order: 99
                };
                await themeRef.set(newTheme);
                console.log(`[Migration] Created theme: ${tmpl.theme}`);
            }

            // 3. Create Template
            // Check if already exists to avoid duplicate work if re-run
            const templateRef = adminDb.collection('templates').doc(tmpl.id);
            const templateSnap = await templateRef.get();

            if (templateSnap.exists) {
                console.log(`[Migration] Template ${tmpl.id} already exists. Skipping.`);
                // Optional: Update if needed, but for migration skipping is safer to avoid overwriting user edits if any
                continue;
            }

            // Clean up data for storage
            const { id, name, width, height, background, elements, thumbnail, ...rest } = tmpl;

            // Construct Fabric JSON data structure
            const fabricData = {
                // Elements array from JSON becomes objects in Fabric
                // Background usually handled separately or as backgroundImage
                objects: elements,
                background: background // Store custom background object too
            };

            try {
                await templateService.createTemplate({
                    categoryId,
                    themeId,
                    name,
                    data: fabricData, // Pass the whole fabric structure
                    isPublic: true,
                    metadata: {
                        width: width || 1080,
                        height: height || 1080,
                        tags: [categoryId, themeId]
                    }
                });
                console.log(`[Migration] Imported template: ${name} (${id})`);
            } catch (err) {
                console.error(`[Migration] Failed to import ${id}:`, err);
            }
        }
    }

    console.log('[Migration] Completed.');
    process.exit(0);
}

migrate().catch(console.error);
