import express from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';
import { generateReplicateTextResponse } from '../services/genai/replicateTextService';
import { WILDMIND_COMPANION_SYSTEM_PROMPT } from '../services/prompts/companionSystemPrompt';

const router = express.Router();

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  message: string;
  conversationHistory?: ChatMessage[];
}

/**
 * POST /api/chat/companion
 * Main endpoint for AI companion chat
 */
router.post('/companion', async (req, res) => {
  try {
    const { message, conversationHistory = [] }: ChatRequest = req.body;

    // Validation
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json(
        formatApiResponse('error', 'Message is required and must be a non-empty string', null)
      );
    }

    // Sanitize message (basic protection)
    const sanitizedMessage = message.trim().slice(0, 2000); // Limit to 2000 chars

    // Build conversation context for better responses
    let conversationContext = '';
    if (conversationHistory.length > 0) {
      // Include last 5 messages for context (to avoid token limits)
      const recentHistory = conversationHistory.slice(-5);
      conversationContext = recentHistory
        .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n');
      conversationContext += '\n\n';
    }

    // Construct the full prompt with conversation history
    const fullPrompt = conversationContext + `User: ${sanitizedMessage}\n\nAssistant:`;

    console.log('[ChatCompanion] Processing message', {
      messageLength: sanitizedMessage.length,
      historyLength: conversationHistory.length,
      userId: (req as any).user?.uid || 'anonymous',
    });

    // Call GPT-4o via Replicate
    const response = await generateReplicateTextResponse(fullPrompt, {
      systemInstruction: WILDMIND_COMPANION_SYSTEM_PROMPT,
      maxOutputTokens: 800, // Keep responses concise
    });

    console.log('[ChatCompanion] Generated response', {
      responseLength: response.length,
    });

    // Return the response
    return res.json(
      formatApiResponse('success', 'Response generated', {
        response: response.trim(),
        messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      })
    );
  } catch (error: any) {
    console.error('[ChatCompanion] Error:', error);
    
    // User-friendly error messages
    let errorMessage = 'Failed to generate response. Please try again.';
    if (error.message?.includes('Replicate')) {
      errorMessage = 'AI service is temporarily unavailable. Please try again in a moment.';
    }

    return res.status(500).json(
      formatApiResponse('error', errorMessage, {
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      })
    );
  }
});

/**
 * GET /api/chat/companion/health
 * Health check for chat companion service
 */
router.get('/health', (_req, res) => {
  res.json(
    formatApiResponse('success', 'Chat companion service is active', {
      timestamp: new Date().toISOString(),
    })
  );
});

export default router;
