import path from 'path';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { templateService } from '../src/services/templateService';
import { adminDb } from '../src/config/firebaseAdmin';

async function addEsportsTemplate() {
    console.log('Adding Esports Event template...');

    const categoryId = 'gaming';
    const themeId = 'esports-style';

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

    // 2. Define the Esports Event Template
    const newTemplate = {
        name: "Esports Tournament Event",
        categoryId: categoryId,
        themeId: themeId,
        isPublic: true,
        metadata: {
            width: 1920,
            height: 1080,
            tags: ['esports', 'gaming', 'tournament', 'event', 'competitive', 'championship']
        },
        data: {
            background: {
                type: 'gradient',
                gradient: {
                    type: 'linear',
                    angle: 135,
                    stops: [
                        { offset: 0, color: '#0f0c29' },     // Deep purple-black
                        { offset: 0.5, color: '#302b63' },  // Purple
                        { offset: 1, color: '#24243e' }     // Dark purple
                    ]
                }
            },
            elements: [
                // Decorative diagonal stripe 1 (top-left)
                {
                    id: 'deco_stripe_1',
                    type: 'shape',
                    shapeType: 'rectangle',
                    name: 'Accent Stripe 1',
                    transform: {
                        x: 100,
                        y: 150,
                        width: 400,
                        height: 8,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: -30,
                        originX: 'center',
                        originY: 'center'
                    },
                    style: {
                        fill: '#00ff88',  // Neon green
                        opacity: 0.8
                    },
                    zIndex: 1
                },
                // Decorative diagonal stripe 2 (top-left)
                {
                    id: 'deco_stripe_2',
                    type: 'shape',
                    shapeType: 'rectangle',
                    name: 'Accent Stripe 2',
                    transform: {
                        x: 180,
                        y: 180,
                        width: 300,
                        height: 4,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: -30,
                        originX: 'center',
                        originY: 'center'
                    },
                    style: {
                        fill: '#ff00ff',  // Neon magenta
                        opacity: 0.6
                    },
                    zIndex: 1
                },
                // Main Title Background Glow
                {
                    id: 'title_glow',
                    type: 'shape',
                    shapeType: 'rectangle',
                    name: 'Title Glow BG',
                    transform: {
                        x: 960,
                        y: 280,
                        width: 900,
                        height: 150,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    style: {
                        fill: '#00ff88',
                        opacity: 0.15,
                        cornerRadius: 10
                    },
                    zIndex: 1
                },
                // Main Event Title
                {
                    id: 'main_title',
                    type: 'text',
                    name: 'Event Title',
                    content: 'CHAMPIONSHIP',
                    transform: {
                        x: 960,
                        y: 250,
                        width: 1200,
                        height: 140,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Orbitron',
                        fontSize: 120,
                        fontWeight: 'bold',
                        fill: '#FFFFFF',
                        textAlign: 'center',
                        letterSpacing: 15
                    },
                    style: {
                        fill: '#FFFFFF',
                        opacity: 1
                    },
                    zIndex: 3
                },
                // Sub Title - Season/Series
                {
                    id: 'sub_title',
                    type: 'text',
                    name: 'Season Text',
                    content: 'SEASON 2026',
                    transform: {
                        x: 960,
                        y: 340,
                        width: 600,
                        height: 60,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Rajdhani',
                        fontSize: 40,
                        fontWeight: '600',
                        fill: '#00ff88',
                        textAlign: 'center',
                        letterSpacing: 8
                    },
                    style: {
                        fill: '#00ff88',
                        opacity: 1
                    },
                    zIndex: 3
                },
                // VS Divider
                {
                    id: 'vs_text',
                    type: 'text',
                    name: 'VS Text',
                    content: 'VS',
                    transform: {
                        x: 960,
                        y: 540,
                        width: 200,
                        height: 120,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Orbitron',
                        fontSize: 80,
                        fontWeight: 'bold',
                        fill: '#ff00ff',
                        textAlign: 'center'
                    },
                    style: {
                        fill: '#ff00ff',
                        opacity: 1
                    },
                    zIndex: 4
                },
                // Team 1 Name
                {
                    id: 'team1_name',
                    type: 'text',
                    name: 'Team 1',
                    content: 'TEAM ALPHA',
                    transform: {
                        x: 480,
                        y: 540,
                        width: 400,
                        height: 80,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Rajdhani',
                        fontSize: 60,
                        fontWeight: 'bold',
                        fill: '#FFFFFF',
                        textAlign: 'center'
                    },
                    style: {
                        fill: '#FFFFFF',
                        opacity: 1
                    },
                    zIndex: 3
                },
                // Team 2 Name
                {
                    id: 'team2_name',
                    type: 'text',
                    name: 'Team 2',
                    content: 'TEAM OMEGA',
                    transform: {
                        x: 1440,
                        y: 540,
                        width: 400,
                        height: 80,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Rajdhani',
                        fontSize: 60,
                        fontWeight: 'bold',
                        fill: '#FFFFFF',
                        textAlign: 'center'
                    },
                    style: {
                        fill: '#FFFFFF',
                        opacity: 1
                    },
                    zIndex: 3
                },
                // Team 1 Logo Placeholder
                {
                    id: 'team1_logo_bg',
                    type: 'shape',
                    shapeType: 'circle',
                    name: 'Team 1 Logo BG',
                    transform: {
                        x: 480,
                        y: 680,
                        width: 120,
                        height: 120,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    style: {
                        fill: '#00ff88',
                        opacity: 0.3,
                        stroke: '#00ff88',
                        strokeWidth: 3
                    },
                    zIndex: 2
                },
                // Team 2 Logo Placeholder
                {
                    id: 'team2_logo_bg',
                    type: 'shape',
                    shapeType: 'circle',
                    name: 'Team 2 Logo BG',
                    transform: {
                        x: 1440,
                        y: 680,
                        width: 120,
                        height: 120,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    style: {
                        fill: '#ff00ff',
                        opacity: 0.3,
                        stroke: '#ff00ff',
                        strokeWidth: 3
                    },
                    zIndex: 2
                },
                // Event Details Bar
                {
                    id: 'info_bar',
                    type: 'shape',
                    shapeType: 'rectangle',
                    name: 'Info Bar',
                    transform: {
                        x: 960,
                        y: 900,
                        width: 1600,
                        height: 100,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    style: {
                        fill: '#000000',
                        opacity: 0.6,
                        cornerRadius: 0
                    },
                    zIndex: 2
                },
                // Date Text
                {
                    id: 'event_date',
                    type: 'text',
                    name: 'Event Date',
                    content: 'MARCH 15, 2026',
                    transform: {
                        x: 500,
                        y: 900,
                        width: 400,
                        height: 50,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Rajdhani',
                        fontSize: 36,
                        fontWeight: '600',
                        fill: '#FFFFFF',
                        textAlign: 'center'
                    },
                    style: {
                        fill: '#FFFFFF',
                        opacity: 1
                    },
                    zIndex: 3
                },
                // Time Text
                {
                    id: 'event_time',
                    type: 'text',
                    name: 'Event Time',
                    content: '7:00 PM EST',
                    transform: {
                        x: 960,
                        y: 900,
                        width: 300,
                        height: 50,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Rajdhani',
                        fontSize: 36,
                        fontWeight: '600',
                        fill: '#00ff88',
                        textAlign: 'center'
                    },
                    style: {
                        fill: '#00ff88',
                        opacity: 1
                    },
                    zIndex: 3
                },
                // Platform/Stream Text
                {
                    id: 'stream_platform',
                    type: 'text',
                    name: 'Stream Platform',
                    content: 'LIVE ON TWITCH',
                    transform: {
                        x: 1420,
                        y: 900,
                        width: 400,
                        height: 50,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Rajdhani',
                        fontSize: 36,
                        fontWeight: '600',
                        fill: '#9146FF',  // Twitch purple
                        textAlign: 'center'
                    },
                    style: {
                        fill: '#9146FF',
                        opacity: 1
                    },
                    zIndex: 3
                },
                // Prize Pool Text
                {
                    id: 'prize_pool',
                    type: 'text',
                    name: 'Prize Pool',
                    content: '$50,000 PRIZE POOL',
                    transform: {
                        x: 960,
                        y: 1000,
                        width: 600,
                        height: 50,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        originX: 'center',
                        originY: 'center'
                    },
                    textStyle: {
                        fontFamily: 'Orbitron',
                        fontSize: 32,
                        fontWeight: 'bold',
                        fill: '#FFD700',  // Gold
                        textAlign: 'center'
                    },
                    style: {
                        fill: '#FFD700',
                        opacity: 1
                    },
                    zIndex: 3
                },
                // Corner accent (bottom-right)
                {
                    id: 'corner_accent',
                    type: 'shape',
                    shapeType: 'rectangle',
                    name: 'Corner Accent',
                    transform: {
                        x: 1820,
                        y: 980,
                        width: 300,
                        height: 8,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: -30,
                        originX: 'center',
                        originY: 'center'
                    },
                    style: {
                        fill: '#00ff88',
                        opacity: 0.8
                    },
                    zIndex: 1
                }
            ]
        }
    };

    try {
        const created = await templateService.createTemplate(newTemplate as any);
        console.log(`✅ Successfully created template: ${created.name} (${created.id})`);
        console.log('📸 Preview generation triggered in background.');
    } catch (err) {
        console.error('❌ Failed to create template:', err);
    }

    setTimeout(() => process.exit(0), 5000);
}

addEsportsTemplate();
