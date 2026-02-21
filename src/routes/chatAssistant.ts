import express from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';
import { generateGpt5NanoResponse, Gpt5NanoChatMessage } from '../services/genai/gpt5NanoService';

import { creditsRepository } from '../repository/creditsRepository';
import { requireAuth } from '../middlewares/authMiddleware';

const router = express.Router();

const ASSISTANT_SYSTEM_PROMPT = `You are the WildMind AI Assistant — a friendly, intelligent, and conversational guide.

Your Personality:
- Be natural, warm, and human-like (similar to ChatGPT or Gemini).
- Use varied greetings and responses. Don't be robotic or repetitive.
- **Small Talk**: If a user says "Hi" or "How are you?", respond naturally (e.g., "I'm doing great! Ready to create something amazing?"). Do NOT simply say "How can I help?".

Your Knowledge Base (Use this to recommend the best tool for the job):
- **Image Models**: 
  - **Flux 2 Pro** (Extreme Realism, no video), **GPT Image 1.5** (Prompt adherence), **Seedream v4/4.5** (Artistic), **Nano Banana** (Fast/Pro), **Ideogram v3** (Best for Typography/Text), **Imagen 4** (Standard/Ultra/Fast), **Minimax Image-01**, **Runway Gen4 Image** (Standard/Turbo).
- **Video Models**: 
  - **Veo 3.1** (Google's latest), **Sora 2** (OpenAI), **Kling 2.6/2.5 Pro** (Realistic Motion), **Wan 2.5** (Standard/Fast/Lipsync), **Seedance** (1.5 Pro/1.0 Pro/Lite), **LTX V2** (Pro/Fast), **Gen-4 Turbo** (Runway), **Hailuo-2.3** (Minimax).
  - *Recommendation*: Use Kling or Sora for cinematic realism; use Wan or Hailuo for character consistency.
- **Music/Audio Models**: 
  - **MiniMax Music 2** (High quality structured music), **ElevenLabs** (TTS v3, Dialogue, SFX), **Chatterbox Multilingual**, **Maya TTS**.

Your Core Phrasing (Use ONLY if asked "What is WildMind?"):
"WildMind AI is an all-in-one AI image, video, and music generation platform that also offers different editing tools for images and video like upscale, remove bg, and others. It also provides different useful workflows."

Rules you MUST follow:
- **PRIORITY**: Answer the user's specific question directly.
- **Flux 2 Pro** is strictly an IMAGE model. Never group it with video.
- **Prompt Suggestions**: ONLY provide a prompt suggestion (prefixed with "Prompt: " or in double quotes) if the user explicitly asks for ideas or clearly intends to create something. 
- Keep responses SHORT — max 3-4 sentences total.`;

/**
 * POST /api/chat/assistant
 * WildMind AI home-page assistant — no authentication required
 * Uses GPT-5 Nano via Replicate for fast, conversational responses
 */
// Secured Route
router.post('/', requireAuth, async (req, res) => {
    try {
        // Authenticated user from middleware
        const uid = (req as any).uid;

        const { message, history = [] } = req.body as {
            message: string;
            history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        };

        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json(
                formatApiResponse('error', 'message (string) is required', null)
            );
        }

        // 1. Validate Credits (Cost: 1)
        const COST = 1;
        try {
            await creditsRepository.validateGeneration(uid, COST);
        } catch (error: any) {
            if (error.code === 'INSUFFICIENT_CREDITS') {
                return res.status(402).json(
                    formatApiResponse('error', 'Insufficient credits. Please upgrade or top up.', { code: 'INSUFFICIENT_CREDITS' })
                );
            }
            throw error;
        }

        const sanitized = message.trim().slice(0, 2000);

        // Last 6 turns for context window safety
        const conversationHistory: Gpt5NanoChatMessage[] = history
            .slice(-6)
            .map((m) => ({ role: m.role, content: m.content }));

        console.log('[AssistantRoute] Request', {
            uid,
            messageLength: sanitized.length,
            historyTurns: conversationHistory.length,
        });

        const reply = await generateGpt5NanoResponse(sanitized, {
            systemPrompt: ASSISTANT_SYSTEM_PROMPT,
            messages: conversationHistory,
            verbosity: 'low',
            reasoningEffort: 'minimal',
            maxCompletionTokens: 180,
        });

        // 2. Deduct Credits
        // Use a unique request ID for idempotency
        const requestId = `chat-${uid}-${Date.now()}`;
        await creditsRepository.writeDebitIfAbsent(
            uid,
            requestId,
            COST,
            'Assistant Chat',
            { messageLength: sanitized.length },
            'gpt-5-nano' // Model ID for credit tracking
        );

        console.log('[AssistantRoute] Reply generated & credits deducted', { replyLength: reply.length });

        return res.json(
            formatApiResponse('success', 'OK', { reply: reply.trim() })
        );
    } catch (error: any) {
        console.error('[AssistantRoute] Error:', error?.message);
        return res.status(500).json(
            formatApiResponse('error', 'Assistant temporarily unavailable. Please try again.', null)
        );
    }
});

export default router;
