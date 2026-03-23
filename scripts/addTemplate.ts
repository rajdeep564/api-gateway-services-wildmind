import path from 'path';
import dotenv from 'dotenv';
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { templateService } from '../src/services/templateService';
import { adminDb } from '../src/config/firebaseAdmin';

async function addTemplate() {
    console.log('Adding new templates.....');

    const newTemplates = [
        {
            "id": "modern-tech-startup-1",
            "name": "Modern Tech Startup",
            "category": "Technology",
            "themeId": "cyber_future",
            "width": 1080,
            "height": 1080,
            "isPublic": true,
            "metadata": {
                "width": 1080,
                "height": 1080,
                "tags": [
                    "tech",
                    "startup",
                    "modern",
                    "dark"
                ]
            },
            "data": {
                "background": {
                    "type": "gradient",
                    "gradientType": "linear",
                    "angle": 45,
                    "colorStops": [
                        {
                            "offset": 0,
                            "color": "#0f172a"
                        },
                        {
                            "offset": 1,
                            "color": "#1e293b"
                        }
                    ]
                },
                "elements": [
                    {
                        "id": "tech-circle-bg",
                        "type": "shape",
                        "name": "Circle Accent",
                        "shapeType": "circle",
                        "transform": {
                            "x": 900,
                            "y": 200,
                            "width": 600,
                            "height": 600,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "transparent",
                            "stroke": "#38bdf8",
                            "strokeWidth": 2,
                            "opacity": 0.2
                        },
                        "zIndex": 1
                    },
                    {
                        "id": "tech-headline",
                        "type": "text",
                        "name": "Main Headline",
                        "content": "FUTURE OF\nINNOVATION",
                        "transform": {
                            "x": 540,
                            "y": 400,
                            "width": 800,
                            "height": 200,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#ffffff",
                            "opacity": 1
                        },
                        "textStyle": {
                            "fontFamily": "Inter",
                            "fontSize": 90,
                            "fontWeight": 800,
                            "textAlign": "center",
                            "lineHeight": 1.1,
                            "letterSpacing": -2
                        },
                        "zIndex": 10
                    },
                    {
                        "id": "tech-subheadline",
                        "type": "text",
                        "name": "Sub Headline",
                        "content": "We build the digital experiences of tomorrow.",
                        "transform": {
                            "x": 540,
                            "y": 550,
                            "width": 700,
                            "height": 60,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#94a3b8",
                            "opacity": 1
                        },
                        "textStyle": {
                            "fontFamily": "Inter",
                            "fontSize": 32,
                            "fontWeight": 400,
                            "textAlign": "center",
                            "lineHeight": 1.4
                        },
                        "zIndex": 11
                    },
                    {
                        "id": "tech-btn-bg",
                        "type": "shape",
                        "name": "Button Background",
                        "shapeType": "rectangle",
                        "transform": {
                            "x": 540,
                            "y": 750,
                            "width": 280,
                            "height": 80,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#38bdf8",
                            "cornerRadius": 40
                        },
                        "zIndex": 12
                    },
                    {
                        "id": "tech-btn-text",
                        "type": "text",
                        "name": "Button Text",
                        "content": "GET STARTED",
                        "transform": {
                            "x": 540,
                            "y": 750,
                            "width": 200,
                            "height": 30,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#0f172a",
                            "opacity": 1
                        },
                        "textStyle": {
                            "fontFamily": "Inter",
                            "fontSize": 24,
                            "fontWeight": 700,
                            "textAlign": "center"
                        },
                        "zIndex": 13
                    }
                ]
            }
        },
        {
            "id": "fashion-sale-1",
            "name": "Summer Fashion Sale",
            "category": "Technology",
            "themeId": "cyber_future",
            "width": 1080,
            "height": 1350,
            "isPublic": true,
            "metadata": {
                "width": 1080,
                "height": 1350,
                "tags": [
                    "fashion",
                    "sale",
                    "summer",
                    "bold"
                ]
            },
            "data": {
                "background": {
                    "type": "solid",
                    "color": "#fefce8"
                },
                "elements": [
                    {
                        "id": "fashion-rect-accent",
                        "type": "shape",
                        "name": "Rectangle Accent",
                        "shapeType": "rectangle",
                        "transform": {
                            "x": 540,
                            "y": 675,
                            "width": 900,
                            "height": 1100,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "transparent",
                            "stroke": "#000000",
                            "strokeWidth": 4,
                            "opacity": 1
                        },
                        "zIndex": 1
                    },
                    {
                        "id": "fashion-sale-text",
                        "type": "text",
                        "name": "Sale Big Text",
                        "content": "SUMMER\nSALE",
                        "transform": {
                            "x": 540,
                            "y": 400,
                            "width": 900,
                            "height": 400,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#000000",
                            "opacity": 1
                        },
                        "textStyle": {
                            "fontFamily": "Playfair Display",
                            "fontSize": 180,
                            "fontWeight": 900,
                            "textAlign": "center",
                            "lineHeight": 0.9,
                            "letterSpacing": -5
                        },
                        "zIndex": 10
                    },
                    {
                        "id": "fashion-discount-badge",
                        "type": "shape",
                        "name": "Discount Circle",
                        "shapeType": "circle",
                        "transform": {
                            "x": 850,
                            "y": 250,
                            "width": 250,
                            "height": 250,
                            "rotation": 15,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#eab308",
                            "opacity": 1
                        },
                        "zIndex": 11
                    },
                    {
                        "id": "fashion-discount-text",
                        "type": "text",
                        "name": "50% Off",
                        "content": "50%\nOFF",
                        "transform": {
                            "x": 850,
                            "y": 250,
                            "width": 200,
                            "height": 120,
                            "rotation": 15,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#000000",
                            "opacity": 1
                        },
                        "textStyle": {
                            "fontFamily": "Inter",
                            "fontSize": 60,
                            "fontWeight": 800,
                            "textAlign": "center",
                            "lineHeight": 1
                        },
                        "zIndex": 12
                    },
                    {
                        "id": "fashion-shop-cta",
                        "type": "text",
                        "name": "Shop Now Text",
                        "content": "SHOP THE COLLECTION",
                        "transform": {
                            "x": 540,
                            "y": 1100,
                            "width": 600,
                            "height": 40,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#000000",
                            "opacity": 1
                        },
                        "textStyle": {
                            "fontFamily": "Inter",
                            "fontSize": 30,
                            "fontWeight": 600,
                            "textAlign": "center",
                            "letterSpacing": 4,
                            "textDecoration": "underline"
                        },
                        "zIndex": 13
                    }
                ]
            }
        },
        {
            "id": "gaming-event-1",
            "name": "Esports Tournament",
            "category": "Technology",
            "themeId": "cyber_future",
            "width": 1920,
            "height": 1080,
            "isPublic": true,
            "metadata": {
                "width": 1920,
                "height": 1080,
                "tags": [
                    "gaming",
                    "esports",
                    "tournament",
                    "neon"
                ]
            },
            "data": {
                "background": {
                    "type": "solid",
                    "color": "#09090b"
                },
                "elements": [
                    {
                        "id": "gamer-neon-bar",
                        "type": "shape",
                        "name": "Neon Bar Top",
                        "shapeType": "rectangle",
                        "transform": {
                            "x": 960,
                            "y": 50,
                            "width": 1920,
                            "height": 20,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#d946ef",
                            "opacity": 1,
                            "shadowColor": "#d946ef",
                            "shadowBlur": 20
                        },
                        "zIndex": 1
                    },
                    {
                        "id": "gamer-title",
                        "type": "text",
                        "name": "Tournament Title",
                        "content": "CYBER CLASH\nCHAMPIONSHIP",
                        "transform": {
                            "x": 400,
                            "y": 300,
                            "width": 700,
                            "height": 200,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#ffffff",
                            "opacity": 1
                        },
                        "textStyle": {
                            "fontFamily": "Orbitron",
                            "fontSize": 80,
                            "fontWeight": 900,
                            "textAlign": "left",
                            "lineHeight": 1.1,
                            "fontStyle": "italic"
                        },
                        "zIndex": 10
                    },
                    {
                        "id": "gamer-date",
                        "type": "text",
                        "name": "Event Date",
                        "content": "JULY 15-17, 2026",
                        "transform": {
                            "x": 400,
                            "y": 450,
                            "width": 500,
                            "height": 50,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#22d3ee",
                            "opacity": 1
                        },
                        "textStyle": {
                            "fontFamily": "Orbitron",
                            "fontSize": 36,
                            "fontWeight": 700,
                            "textAlign": "left",
                            "letterSpacing": 2
                        },
                        "zIndex": 11
                    },
                    {
                        "id": "gamer-prize-pool",
                        "type": "text",
                        "name": "Prize Pool",
                        "content": "$100,000 PRIZE POOL",
                        "transform": {
                            "x": 1500,
                            "y": 900,
                            "width": 600,
                            "height": 60,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#facc15",
                            "opacity": 1
                        },
                        "textStyle": {
                            "fontFamily": "Orbitron",
                            "fontSize": 48,
                            "fontWeight": 800,
                            "textAlign": "right"
                        },
                        "zIndex": 12
                    },
                    {
                        "id": "gamer-register-btn-bg",
                        "type": "shape",
                        "name": "Register Button BG",
                        "shapeType": "rectangle",
                        "transform": {
                            "x": 400,
                            "y": 600,
                            "width": 300,
                            "height": 80,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#d946ef",
                            "skewX": -20
                        },
                        "zIndex": 13
                    },
                    {
                        "id": "gamer-register-text",
                        "type": "text",
                        "name": "Register Text",
                        "content": "REGISTER NOW",
                        "transform": {
                            "x": 400,
                            "y": 600,
                            "width": 250,
                            "height": 30,
                            "rotation": 0,
                            "scaleX": 1,
                            "scaleY": 1,
                            "originX": "center",
                            "originY": "center"
                        },
                        "style": {
                            "fill": "#ffffff",
                            "opacity": 1
                        },
                        "textStyle": {
                            "fontFamily": "Orbitron",
                            "fontSize": 24,
                            "fontWeight": 700,
                            "textAlign": "center"
                        },
                        "zIndex": 14
                    }
                ]
            }
        }
    ];

    for (const template of newTemplates) {
        try {
            // Check category exists (or just assume/create depending on implementation - here basic catch for errors)
            // Ideally we'd ensure theme and category exist first, but let's try direct insertion
            const created = await templateService.createTemplate(template as any);
            console.log(`Successfully created template: ${created.name} (${created.id})`);
        } catch (err) {
            console.error(`Failed to create template ${template.name}:`, err);
        }
    }

    // Allow time for preview generation logs to appear if running in same process (though it's async service)
    // We'll exit explicitly after a delay
    setTimeout(() => process.exit(0), 5000);
}

addTemplate();
