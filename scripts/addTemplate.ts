import path from 'path';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { templateService } from '../src/services/templateService';
import { adminDb } from '../src/config/firebaseAdmin';

async function addTemplate() {
    console.log('Adding new template...');

    const categoryId = 'ecommerce';
    const themeId = 'sale';

    // 1. Verify Category and Theme exist
    const catRef = await adminDb.collection('template_categories').doc(categoryId).get();
    if (!catRef.exists) {
        console.error(`Category '${categoryId}' does not exist!`);
        return;
    }
    const themeRef = await adminDb.collection('template_themes').doc(themeId).get();
    if (!themeRef.exists) {
        console.error(`Theme '${themeId}' does not exist!`);
        return;
    }

    // 2. Define the Template Data
    // This is a sample "Mega Sale" template.
    // You can modify the `elements` array to design your template.
    const newTemplate = {
        name: "Mega Sale Banner",
        categoryId: categoryId,
        themeId: themeId,
        isPublic: true,
        metadata: {
            width: 1080,
            height: 1080,
            tags: ['sale', 'ecommerce', 'discount', 'red']
        },
        data: {
            background: {
                type: 'solid',
                color: '#FF4136' // Bright Red
            },
            elements: [
                {
                    id: 'headline',
                    type: 'text',
                    name: 'Sale Text',
                    content: 'MEGA SALE',
                    transform: {
                        x: 540,
                        y: 300,
                        width: 800,
                        height: 120,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Poppins',
                        fontSize: 120,
                        fontWeight: 'bold',
                        fill: '#FFFFFF',
                        textAlign: 'center'
                    },
                    style: {
                        fill: '#FFFFFF',
                        opacity: 1
                    },
                    zIndex: 2
                },
                {
                    id: 'subheadline',
                    type: 'text',
                    name: 'Discount Text',
                    content: 'UP TO 50% OFF',
                    transform: {
                        x: 540,
                        y: 450,
                        width: 600,
                        height: 80,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Roboto',
                        fontSize: 60,
                        fontWeight: 'normal',
                        fill: '#FFFFFF',
                        textAlign: 'center'
                    },
                    style: {
                        fill: '#FFFFFF',
                        opacity: 1
                    },
                    zIndex: 2
                },
                {
                    id: 'shape_bg',
                    type: 'shape',
                    shapeType: 'rectangle',
                    name: 'Button Background',
                    transform: {
                        x: 540,
                        y: 700,
                        width: 300,
                        height: 80,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    style: {
                        fill: '#FFFFFF',
                        cornerRadius: 40 // Rounded button
                    },
                    zIndex: 1
                },
                {
                    id: 'button_text',
                    type: 'text',
                    name: 'Button Text',
                    content: 'SHOP NOW',
                    transform: {
                        x: 540,
                        y: 700,
                        width: 200,
                        height: 40,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Poppins',
                        fontSize: 30,
                        fontWeight: 'bold',
                        fill: '#FF4136',
                        textAlign: 'center'
                    },
                    style: {
                        fill: '#FF4136',
                        opacity: 1
                    },
                    zIndex: 3
                }
            ]
        }
    };

    try {
        const created = await templateService.createTemplate(newTemplate as any);
        console.log(`Successfully created template: ${created.name} (${created.id})`);
        console.log('Preview generation triggered in background.');
    } catch (err) {
        console.error('Failed to create template:', err);
    }

    // Allow time for preview generation logs to appear if running in same process (though it's async service)
    // We'll exit explicitly after a delay
    setTimeout(() => process.exit(0), 5000);
}

addTemplate();
