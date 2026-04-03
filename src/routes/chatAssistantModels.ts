import express from "express";
import { formatApiResponse } from "../utils/formatApiResponse";
import {
  creditsRepository,
  getModelCost,
} from "../repository/creditsRepository";
import { requireAuth } from "../middlewares/authMiddleware";
import {
  AssistantConversationMessage,
  ClaudeChatModeInput,
  ChatModeModelId,
  generateAssistantChatModeResponse,
  GeminiChatModeInput,
  getAssistantChatFinalPricingParams,
  getAssistantChatValidationPricingParams,
} from "../services/genai/assistantMultiModelService";
import {
  assistantThreadsRepository,
  AssistantAttachment,
} from "../repository/assistantThreadsRepository";
import {
  CHAT_MODEL_CONFIGS,
  CHAT_MODE_MODEL_IDS,
  isChatModeModelId,
} from "../config/assistantModels";

const router = express.Router();
const GEMINI_MAX_IMAGES = 10;
const GEMINI_MAX_VIDEOS = 10;
const GEMINI_MAX_AUDIO = 1;
const GEMINI_MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const CLAUDE_MAX_IMAGES = 2;
const CLAUDE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function resolveChatModeCost(
  modelId: ChatModeModelId,
  pricingParams?: {
    inputTokens?: number;
    outputTokens?: number;
  },
): Promise<number> {
  try {
    const dbCost = await getModelCost(modelId, pricingParams);
    if (Number.isFinite(dbCost) && dbCost > 0) {
      return dbCost;
    }
  } catch (error: any) {
    console.warn("[AssistantChatModelsRoute] Pricing lookup fallback:", {
      modelId,
      error: error?.message,
    });
  }

  return CHAT_MODEL_CONFIGS[modelId].fallbackCreditCost;
}

function normalizeAttachments(value: unknown): AssistantAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is AssistantAttachment =>
        !!item &&
        typeof item === "object" &&
        typeof (item as any).url === "string",
    )
    .map((item) => ({
      id: String(
        item.id ||
          `assistant-att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ),
      type: item.type,
      url: item.url,
      fileName: item.fileName ?? null,
      mimeType: item.mimeType ?? null,
      storagePath: item.storagePath ?? null,
      sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : null,
    }))
    .filter(
      (item) =>
        item.type === "image" || item.type === "video" || item.type === "audio",
    );
}

function serializeMessageForContext(
  content: string,
  attachments: AssistantAttachment[],
): string {
  const sanitized = String(content || "").trim();
  if (attachments.length === 0) return sanitized;

  const attachmentSummary = attachments
    .map(
      (attachment) =>
        `${attachment.type}${attachment.fileName ? `:${attachment.fileName}` : ""}`,
    )
    .join(", ");

  return `${sanitized}\n[attachments: ${attachmentSummary}]`.trim();
}

function buildConversationHistoryFromPersisted(
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    attachments: AssistantAttachment[];
  }>,
): AssistantConversationMessage[] {
  return messages
    .map((message) => ({
      role: message.role,
      content: serializeMessageForContext(message.content, message.attachments),
    }))
    .slice(-12);
}

function mergeGeminiInputWithAttachments(
  modelInput: GeminiChatModeInput | undefined,
  attachments: AssistantAttachment[],
): GeminiChatModeInput | undefined {
  const imageUrls = attachments
    .filter((item) => item.type === "image")
    .map((item) => item.url);
  const videoUrls = attachments
    .filter((item) => item.type === "video")
    .map((item) => item.url);
  const audioUrl =
    attachments.find((item) => item.type === "audio")?.url ?? null;

  if (
    !modelInput &&
    imageUrls.length === 0 &&
    videoUrls.length === 0 &&
    !audioUrl
  ) {
    return undefined;
  }

  return {
    ...modelInput,
    images: modelInput?.images?.length ? modelInput.images : imageUrls,
    videos: modelInput?.videos?.length ? modelInput.videos : videoUrls,
    audio: modelInput?.audio ?? audioUrl,
  };
}

function mergeClaudeInputWithAttachments(
  modelInput: ClaudeChatModeInput | undefined,
  attachments: AssistantAttachment[],
): ClaudeChatModeInput | undefined {
  const imageUrls = attachments
    .filter((item) => item.type === "image")
    .map((item) => item.url)
    .slice(0, CLAUDE_MAX_IMAGES);

  if (!modelInput && imageUrls.length === 0) {
    return undefined;
  }

  return {
    ...modelInput,
    images: modelInput?.images?.length
      ? modelInput.images.slice(0, CLAUDE_MAX_IMAGES)
      : imageUrls,
    image: modelInput?.image ?? imageUrls[0] ?? null,
  };
}

function validateGeminiAttachments(
  attachments: AssistantAttachment[],
): string | null {
  const imageCount = attachments.filter((item) => item.type === "image").length;
  const videoCount = attachments.filter((item) => item.type === "video").length;
  const audioCount = attachments.filter((item) => item.type === "audio").length;

  if (imageCount > GEMINI_MAX_IMAGES) {
    return `Gemini supports up to ${GEMINI_MAX_IMAGES} images per message`;
  }

  if (videoCount > GEMINI_MAX_VIDEOS) {
    return `Gemini supports up to ${GEMINI_MAX_VIDEOS} videos per message`;
  }

  if (audioCount > GEMINI_MAX_AUDIO) {
    return "Gemini supports only one audio file per message";
  }

  const oversizedImage = attachments.find(
    (item) =>
      item.type === "image" &&
      typeof item.sizeBytes === "number" &&
      item.sizeBytes > GEMINI_MAX_IMAGE_BYTES,
  );
  if (oversizedImage) {
    return "Gemini image attachments must be 7MB or smaller";
  }

  return null;
}

function validateClaudeAttachments(
  attachments: AssistantAttachment[],
): string | null {
  const imageCount = attachments.filter((item) => item.type === "image").length;
  const videoCount = attachments.filter((item) => item.type === "video").length;
  const audioCount = attachments.filter((item) => item.type === "audio").length;

  if (imageCount > CLAUDE_MAX_IMAGES) {
    return `Claude supports up to ${CLAUDE_MAX_IMAGES} images per message`;
  }

  if (videoCount > 0) {
    return "Claude does not support video attachments";
  }

  if (audioCount > 0) {
    return "Claude does not support audio attachments";
  }

  const oversizedImage = attachments.find(
    (item) =>
      item.type === "image" &&
      typeof item.sizeBytes === "number" &&
      item.sizeBytes > CLAUDE_MAX_IMAGE_BYTES,
  );
  if (oversizedImage) {
    return "Claude image attachments must be 5MB or smaller";
  }

  return null;
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const {
      message,
      history = [],
      modelId,
      modelInput,
      threadId,
      attachments = [],
    } = req.body as {
      message: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      modelId?: string;
      modelInput?: GeminiChatModeInput | ClaudeChatModeInput;
      threadId?: string;
      attachments?: AssistantAttachment[];
    };

    if (!message || typeof message !== "string" || !message.trim()) {
      return res
        .status(400)
        .json(formatApiResponse("error", "message (string) is required", null));
    }

    if (!modelId || !isChatModeModelId(modelId)) {
      return res
        .status(400)
        .json(
          formatApiResponse("error", "Valid chat modelId is required", null),
        );
    }

    let activeThread = threadId
      ? await assistantThreadsRepository.getThread(uid, threadId)
      : await assistantThreadsRepository.createThread(uid, {
          mode: "chat",
          modelId,
        });

    if (!activeThread) {
      return res
        .status(404)
        .json(formatApiResponse("error", "Assistant thread not found", null));
    }

    if (activeThread.mode !== "chat") {
      return res
        .status(400)
        .json(
          formatApiResponse(
            "error",
            "Chat route can only be used with chat threads",
            null,
          ),
        );
    }

    if (activeThread.modelId !== modelId) {
      return res.status(400).json(
        formatApiResponse(
          "error",
          "This thread is locked to a different model",
          {
            threadModelId: activeThread.modelId,
          },
        ),
      );
    }

    const selectedModelId = activeThread.modelId as ChatModeModelId;
    const sanitized = message.trim().slice(0, 2000);
    const normalizedAttachments = normalizeAttachments(attachments);
    if (selectedModelId === "google/gemini-3.1-pro") {
      const attachmentValidationError = validateGeminiAttachments(
        normalizedAttachments,
      );
      if (attachmentValidationError) {
        return res
          .status(400)
          .json(formatApiResponse("error", attachmentValidationError, null));
      }
    }
    if (selectedModelId === "anthropic/claude-opus-4.6") {
      const attachmentValidationError = validateClaudeAttachments(
        normalizedAttachments,
      );
      if (attachmentValidationError) {
        return res
          .status(400)
          .json(formatApiResponse("error", attachmentValidationError, null));
      }
    }
    const effectiveModelInput =
      selectedModelId === "google/gemini-3.1-pro"
        ? mergeGeminiInputWithAttachments(
            modelInput as GeminiChatModeInput | undefined,
            normalizedAttachments,
          )
        : selectedModelId === "anthropic/claude-opus-4.6"
          ? mergeClaudeInputWithAttachments(
              modelInput as ClaudeChatModeInput | undefined,
              normalizedAttachments,
            )
          : undefined;
    const persistedMessages = await assistantThreadsRepository.listMessages(
      uid,
      activeThread.id,
      20,
    );
    const conversationHistory =
      persistedMessages.length > 0
        ? buildConversationHistoryFromPersisted(
            persistedMessages.map((message) => ({
              role: message.role,
              content: message.content,
              attachments: message.attachments,
            })),
          )
        : history.slice(-6).map(({ role, content }) => ({ role, content }));
    const validationPricingParams = getAssistantChatValidationPricingParams(
      selectedModelId,
      sanitized,
      conversationHistory,
      selectedModelId === "google/gemini-3.1-pro"
        ? effectiveModelInput
        : undefined,
    );
    const validationCost = await resolveChatModeCost(
      selectedModelId,
      validationPricingParams,
    );
    console.log("[AssistantChatModelsRoute] Validation pricing resolved", {
      uid,
      threadId: activeThread.id,
      modelId: selectedModelId,
      messageLength: sanitized.length,
      historyCount: conversationHistory.length,
      validationPricingParams,
      validationCost,
    });

    try {
      await creditsRepository.validateGeneration(uid, validationCost);
      console.log("[AssistantChatModelsRoute] Credit validation passed", {
        uid,
        threadId: activeThread.id,
        modelId: selectedModelId,
        validationCost,
      });
    } catch (error: any) {
      if (error.code === "INSUFFICIENT_CREDITS") {
        console.warn("[AssistantChatModelsRoute] Credit validation failed", {
          uid,
          threadId: activeThread.id,
          modelId: selectedModelId,
          validationCost,
          error: error?.message,
        });
        return res
          .status(402)
          .json(
            formatApiResponse(
              "error",
              "Insufficient credits. Please upgrade or top up.",
              { code: "INSUFFICIENT_CREDITS" },
            ),
          );
      }
      throw error;
    }

    const reply = await generateAssistantChatModeResponse({
      modelId: selectedModelId,
      message: sanitized,
      history: conversationHistory,
      systemPrompt:
        selectedModelId === "anthropic/claude-opus-4.6" && effectiveModelInput
          ? ((effectiveModelInput as ClaudeChatModeInput).system_prompt ??
            undefined)
          : undefined,
      geminiInput:
        selectedModelId === "google/gemini-3.1-pro"
          ? (effectiveModelInput as GeminiChatModeInput)
          : undefined,
      claudeInput:
        selectedModelId === "anthropic/claude-opus-4.6"
          ? (effectiveModelInput as ClaudeChatModeInput)
          : undefined,
    });
    const finalPricingParams = getAssistantChatFinalPricingParams(
      selectedModelId,
      sanitized,
      conversationHistory,
      reply,
      selectedModelId === "google/gemini-3.1-pro"
        ? effectiveModelInput
        : undefined,
    );
    const finalCost = await resolveChatModeCost(
      selectedModelId,
      finalPricingParams,
    );
    console.log("[AssistantChatModelsRoute] Final pricing resolved", {
      uid,
      threadId: activeThread.id,
      modelId: selectedModelId,
      replyLength: reply.length,
      finalPricingParams,
      finalCost,
    });

    const requestId = `chat-model-${uid}-${Date.now()}`;
    await creditsRepository.writeDebitIfAbsent(
      uid,
      requestId,
      finalCost,
      "Assistant Chat Mode",
      {
        messageLength: sanitized.length,
        mode: "chat",
        modelId: selectedModelId,
        threadId: activeThread.id,
        attachmentCount: normalizedAttachments.length,
        modelInput:
          selectedModelId === "google/gemini-3.1-pro"
            ? effectiveModelInput
            : undefined,
        pricing: finalPricingParams
          ? {
              ...finalPricingParams,
              validationCost,
              finalCost,
            }
          : {
              validationCost,
              finalCost,
            },
      },
      selectedModelId,
      finalPricingParams,
    );
    await assistantThreadsRepository.appendMessages(uid, activeThread.id, {
      threadMode: "chat",
      modelId: selectedModelId,
      messages: [
        {
          role: "user",
          content: sanitized,
          attachments: normalizedAttachments,
          modelInput:
            selectedModelId === "google/gemini-3.1-pro"
              ? (effectiveModelInput ?? null)
              : null,
          metadata: {
            mode: "chat",
            modelId: selectedModelId,
          },
        },
        {
          role: "assistant",
          content: reply.trim(),
          metadata: {
            mode: "chat",
            modelId: selectedModelId,
            requestId,
            validationCost,
            finalCost,
          },
        },
      ],
    });
    activeThread =
      (await assistantThreadsRepository.getThread(uid, activeThread.id)) ||
      activeThread;
    console.log("[AssistantChatModelsRoute] Debit request completed", {
      uid,
      threadId: activeThread.id,
      modelId: selectedModelId,
      requestId,
      validationCost,
      finalCost,
    });

    return res.json(
      formatApiResponse("success", "OK", {
        reply: reply.trim(),
        thread: activeThread,
        threadId: activeThread.id,
      }),
    );
  } catch (error: any) {
    console.error("[AssistantChatModelsRoute] Error:", error?.message);
    return res
      .status(500)
      .json(
        formatApiResponse(
          "error",
          "Assistant chat mode is temporarily unavailable. Please try again.",
          null,
        ),
      );
  }
});

export default router;
