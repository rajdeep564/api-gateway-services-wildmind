import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { adminDb } from '../config/firebaseAdmin';
import { uploadBufferToZata } from '../utils/storage/zataUpload';
import { Template } from '../types/template';

const RENDERER_PATH = path.join(__dirname, 'renderer', 'renderer.html');

class PreviewService {
    /**
     * Generate a preview image for a template and upload to S3
     */
    async generatePreview(template: Template): Promise<string> {
        console.log(`[PreviewService] Generating preview for template ${template.id}`);

        let browser;
        try {
            browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                headless: true
            });

            const page = await browser.newPage();
            page.on('console', msg => console.log('PAGE LOG:', msg.text()));
            page.on('pageerror', (err: any) => console.error('PAGE ERROR:', err.toString()));

            // Set viewport to template dimensions (or scaled down if too large)
            const width = template.metadata?.width || 800; // default/fallback
            const height = template.metadata?.height || 600;

            await page.setViewport({ width, height });

            // Load renderer HTML
            const htmlContent = fs.readFileSync(RENDERER_PATH, 'utf8');
            await page.setContent(htmlContent);

            // Inject Fabric.js locally to avoid CDN issues
            // Try to find it in the sibling project
            // __dirname is src/services. 
            // .. -> src
            // .. -> api-gateway
            // .. -> wild mind editor
            const fabricPath = path.resolve(__dirname, '../../../mix_editor/designer/node_modules/fabric/dist/fabric.min.js');

            if (fs.existsSync(fabricPath)) {
                const fabricContent = fs.readFileSync(fabricPath, 'utf8');
                await page.addScriptTag({ content: fabricContent });
            } else {
                // Fallback to CDN if local not found (will rely on the script tag in HTML)
                console.warn('[PreviewService] Local fabric.js not found, checking for CDN usage...');
                // If using CDN, we might need to wait for it.
                await page.waitForFunction('window.fabric', { timeout: 5000 }).catch(() => {
                    console.error('[PreviewService] Failed to load Fabric.js from CDN or local');
                });
            }

            // Inject data and render
            // Note: template.data should match what the frontend saves. 
            // Assuming template.data contains { elements: [], background: ... } or similar.
            const bg = (template.data as any).background;

            await page.evaluate((data, w, h, bg) => {
                // @ts-ignore
                return window.renderTemplate(data, w, h, bg);
            }, template.data, width, height, bg);

            // Take screenshot
            const screenshotBuffer = await page.screenshot({ type: 'png' });

            // Upload to Zata (S3)
            const key = `templates/previews/${template.id}.png`;
            const { publicUrl } = await uploadBufferToZata(key, Buffer.from(screenshotBuffer), 'image/png');

            console.log(`[PreviewService] Preview uploaded to ${publicUrl}`);

            // Update Firestore
            await adminDb.collection('templates').doc(template.id).update({
                thumbnailUrl: publicUrl,
                updatedAt: new Date()
            });

            return publicUrl;

        } catch (error) {
            console.error('[PreviewService] Error generating preview:', error);
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }
}

export const previewService = new PreviewService();
