import express from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';
import { generateGpt5NanoResponse, Gpt5NanoChatMessage } from '../services/genai/gpt5NanoService';
import { creditsRepository } from '../repository/creditsRepository';
import { requireAuth } from '../middlewares/authMiddleware';
import { assistantThreadsRepository } from '../repository/assistantThreadsRepository';
import { AGENT_DEFAULT_MODEL_ID } from '../config/assistantModels';

const router = express.Router();

function serializeContentForContext(content: string): string {
    return String(content || '').trim();
}

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

        const { message, history = [], threadId } = req.body as {
            message: string;
            history?: Array<{ role: 'user' | 'assistant'; content: string }>;
            threadId?: string;
        };

        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json(
                formatApiResponse('error', 'message (string) is required', null)
            );
        }

        // 1. Validate Credits
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

        let activeThread = threadId
            ? await assistantThreadsRepository.getThread(uid, threadId)
            : await assistantThreadsRepository.createThread(uid, {
                mode: 'agent',
                modelId: AGENT_DEFAULT_MODEL_ID,
            });

        if (!activeThread) {
            return res.status(404).json(
                formatApiResponse('error', 'Assistant thread not found', null)
            );
        }

        if (activeThread.mode !== 'agent') {
            return res.status(400).json(
                formatApiResponse('error', 'Agent route can only be used with agent threads', null)
            );
        }

        const persistedMessages = await assistantThreadsRepository.listMessages(uid, activeThread.id, 20);
        const fallbackHistory = history
            .slice(-6)
            .map((m) => ({ role: m.role, content: serializeContentForContext(m.content) }));
        const conversationHistory: Gpt5NanoChatMessage[] = (
            persistedMessages.length > 0
                ? persistedMessages.slice(-12).map((m) => ({
                    role: m.role,
                    content: serializeContentForContext(m.content),
                }))
                : fallbackHistory
        ).slice(-12);

        console.log('[AssistantRoute] Request', {
            uid,
            threadId: activeThread.id,
            messageLength: sanitized.length,
            historyTurns: conversationHistory.length,
        });

        const reply = await generateGpt5NanoResponse(sanitized, {
            messages: conversationHistory,
            verbosity: 'low',
            reasoningEffort: 'minimal',
            maxCompletionTokens: 180,
        });

        // 2. Deduct Credits
        // Use a unique request ID for idempotency
        const requestId = `chat-agent-${uid}-${Date.now()}`;
        await creditsRepository.writeDebitIfAbsent(
            uid,
            requestId,
            COST,
            'Assistant Chat',
            {
                messageLength: sanitized.length,
                mode: 'agent',
                modelId: AGENT_DEFAULT_MODEL_ID,
                threadId: activeThread.id,
            },
            'gpt-5-nano'
        );

        await assistantThreadsRepository.appendMessages(uid, activeThread.id, {
            threadMode: 'agent',
            modelId: AGENT_DEFAULT_MODEL_ID,
            messages: [
                {
                    role: 'user',
                    content: sanitized,
                    metadata: {
                        mode: 'agent',
                        modelId: AGENT_DEFAULT_MODEL_ID,
                    },
                },
                {
                    role: 'assistant',
                    content: reply.trim(),
                    metadata: {
                        mode: 'agent',
                        modelId: AGENT_DEFAULT_MODEL_ID,
                        requestId,
                    },
                },
            ],
        });
        activeThread = await assistantThreadsRepository.getThread(uid, activeThread.id) || activeThread;

        console.log('[AssistantRoute] Reply generated & credits deducted', { replyLength: reply.length });

        return res.json(
            formatApiResponse('success', 'OK', {
                reply: reply.trim(),
                thread: activeThread,
                threadId: activeThread.id,
            })
        );
    } catch (error: any) {
        console.error('[AssistantRoute] Error:', error?.message);
        return res.status(500).json(
            formatApiResponse('error', 'Assistant temporarily unavailable. Please try again.', null)
        );
    }
});

export default router;
