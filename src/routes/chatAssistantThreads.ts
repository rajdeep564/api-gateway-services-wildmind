import express from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { formatApiResponse } from '../utils/formatApiResponse';
import {
  assistantThreadsRepository,
  AssistantThreadMode,
} from '../repository/assistantThreadsRepository';
import { AGENT_DEFAULT_MODEL_ID, CHAT_MODE_MODEL_IDS, isChatModeModelId } from '../config/assistantModels';

const router = express.Router();

function resolveThreadDefaults(mode: AssistantThreadMode, modelId?: string): { mode: AssistantThreadMode; modelId: string } {
  if (mode === 'chat') {
    return {
      mode,
      modelId: modelId && isChatModeModelId(modelId.trim()) ? modelId.trim() : CHAT_MODE_MODEL_IDS[0],
    };
  }

  return {
    mode: 'agent',
    modelId: AGENT_DEFAULT_MODEL_ID,
  };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const mode = req.query.mode === 'chat' ? 'chat' : req.query.mode === 'agent' ? 'agent' : undefined;
    const threads = await assistantThreadsRepository.listThreads(uid, {
      mode,
      limit: Number(req.query.limit || 30),
    });

    return res.json(formatApiResponse('success', 'OK', { threads }));
  } catch (error: any) {
    console.error('[AssistantThreadsRoute:list] Error:', error?.message);
    return res.status(500).json(formatApiResponse('error', 'Failed to load assistant threads', null));
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const requestedMode = req.body?.mode === 'chat' ? 'chat' : 'agent';
    const { mode, modelId } = resolveThreadDefaults(requestedMode, req.body?.modelId);
    const thread = await assistantThreadsRepository.createThread(uid, {
      mode,
      modelId,
      title: typeof req.body?.title === 'string' ? req.body.title.trim() : undefined,
    });

    return res.json(formatApiResponse('success', 'OK', { thread }));
  } catch (error: any) {
    console.error('[AssistantThreadsRoute:create] Error:', error?.message);
    return res.status(500).json(formatApiResponse('error', 'Failed to create assistant thread', null));
  }
});

router.get('/:threadId', requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const threadId = String(req.params.threadId || '');
    const thread = await assistantThreadsRepository.getThread(uid, threadId);

    if (!thread) {
      return res.status(404).json(formatApiResponse('error', 'Assistant thread not found', null));
    }

    const messages = await assistantThreadsRepository.listMessages(uid, threadId, Number(req.query.limit || 100));
    return res.json(formatApiResponse('success', 'OK', { thread, messages }));
  } catch (error: any) {
    console.error('[AssistantThreadsRoute:get] Error:', error?.message);
    return res.status(500).json(formatApiResponse('error', 'Failed to load assistant thread', null));
  }
});

router.delete('/:threadId', requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const threadId = String(req.params.threadId || '');
    const thread = await assistantThreadsRepository.getThread(uid, threadId);

    if (!thread) {
      return res.status(404).json(formatApiResponse('error', 'Assistant thread not found', null));
    }

    await assistantThreadsRepository.softDeleteThread(uid, threadId);
    return res.json(formatApiResponse('success', 'OK', { threadId }));
  } catch (error: any) {
    console.error('[AssistantThreadsRoute:delete] Error:', error?.message);
    return res.status(500).json(formatApiResponse('error', 'Failed to delete assistant thread', null));
  }
});

export default router;
