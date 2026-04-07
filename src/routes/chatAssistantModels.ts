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
  DeepSeekChatModeInput,
  Gemini25FlashChatModeInput,
  GPT52ChatModeInput,
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
const DEFAULT_ASSISTANT_STYLE_PROMPT = `You are a helpful, natural conversational assistant.

Write like ChatGPT: clear, warm, direct, and human.

Style rules:
- Start with the answer or next useful step.
- Prefer short paragraphs over long walls of text.
- Do not sound theatrical, robotic, or overly formal.
- Do not over-explain unless the user asks for depth.
- Do not dump huge numbered questionnaires unless they are truly necessary.
- Ask at most 1 to 3 focused follow-up questions when needed.
- Avoid filler phrases like "To get started" or "Act as if".
- Avoid giving multiple examples unless they genuinely help.
- If the user wants creative help, collaborate naturally and keep momentum.
- Match the user's tone, but keep the writing polished and easy to understand.
- Do not use markdown star bullets like "*" for lists.
- When listing points, prefer numbers, letters, roman numerals, or short labeled lines.`;

function mergeAssistantStylePrompt(customPrompt?: string | null): string {
  const trimmed = typeof customPrompt === "string" ? customPrompt.trim() : "";
  return trimmed
    ? `${DEFAULT_ASSISTANT_STYLE_PROMPT}\n\nAdditional instructions:\n${trimmed}`
    : DEFAULT_ASSISTANT_STYLE_PROMPT;
}
const GEMINI_MAX_IMAGES = 10;
const GEMINI_MAX_VIDEOS = 10;
const GEMINI_MAX_AUDIO = 1;
const GEMINI_MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const GEMINI25_FLASH_MAX_IMAGES = 10;
const GEMINI25_FLASH_MAX_VIDEOS = 10;
const GEMINI25_FLASH_MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const CLAUDE_MAX_IMAGES = 2;
const CLAUDE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const GPT52_MAX_IMAGES = 4;
const GPT52_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

function mergeGemini25FlashInputWithAttachments(
  modelInput: Gemini25FlashChatModeInput | undefined,
  attachments: AssistantAttachment[],
): Gemini25FlashChatModeInput | undefined {
  const imageUrls = attachments
    .filter((item) => item.type === "image")
    .map((item) => item.url)
    .slice(0, GEMINI25_FLASH_MAX_IMAGES);
  const videoUrls = attachments
    .filter((item) => item.type === "video")
    .map((item) => item.url)
    .slice(0, GEMINI25_FLASH_MAX_VIDEOS);

  if (!modelInput && imageUrls.length === 0 && videoUrls.length === 0) {
    return undefined;
  }

  return {
    ...modelInput,
    images: modelInput?.images?.length
      ? modelInput.images.slice(0, GEMINI25_FLASH_MAX_IMAGES)
      : imageUrls,
    videos: modelInput?.videos?.length
      ? modelInput.videos.slice(0, GEMINI25_FLASH_MAX_VIDEOS)
      : videoUrls,
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

function validateGemini25FlashAttachments(
  attachments: AssistantAttachment[],
): string | null {
  const imageCount = attachments.filter((item) => item.type === "image").length;
  const videoCount = attachments.filter((item) => item.type === "video").length;
  const audioCount = attachments.filter((item) => item.type === "audio").length;

  if (imageCount > GEMINI25_FLASH_MAX_IMAGES) {
    return `Gemini 2.5 Flash supports up to ${GEMINI25_FLASH_MAX_IMAGES} images per message`;
  }

  if (videoCount > GEMINI25_FLASH_MAX_VIDEOS) {
    return `Gemini 2.5 Flash supports up to ${GEMINI25_FLASH_MAX_VIDEOS} videos per message`;
  }

  if (audioCount > 0) {
    return "Gemini 2.5 Flash does not support audio attachments";
  }

  const oversizedImage = attachments.find(
    (item) =>
      item.type === "image" &&
      typeof item.sizeBytes === "number" &&
      item.sizeBytes > GEMINI25_FLASH_MAX_IMAGE_BYTES,
  );
  if (oversizedImage) {
    return "Gemini 2.5 Flash image attachments must be 7MB or smaller";
  }

  return null;
}

function mergeGPT52InputWithAttachments(
  modelInput: GPT52ChatModeInput | undefined,
  attachments: AssistantAttachment[],
): GPT52ChatModeInput | undefined {
  const imageUrls = attachments
    .filter((item) => item.type === "image")
    .map((item) => item.url)
    .slice(0, GPT52_MAX_IMAGES);

  if (!modelInput && imageUrls.length === 0) {
    return undefined;
  }

  return {
    ...modelInput,
    image_input: modelInput?.image_input?.length
      ? modelInput.image_input.slice(0, GPT52_MAX_IMAGES)
      : imageUrls,
  };
}

function validateGPT52Attachments(
  attachments: AssistantAttachment[],
): string | null {
  const imageCount = attachments.filter((item) => item.type === "image").length;
  const videoCount = attachments.filter((item) => item.type === "video").length;
  const audioCount = attachments.filter((item) => item.type === "audio").length;

  if (imageCount > GPT52_MAX_IMAGES) {
    return `GPT-5.2 supports up to ${GPT52_MAX_IMAGES} images per message`;
  }

  if (videoCount > 0) {
    return "GPT-5.2 does not support video attachments";
  }

  if (audioCount > 0) {
    return "GPT-5.2 does not support audio attachments";
  }

  const oversizedImage = attachments.find(
    (item) =>
      item.type === "image" &&
      typeof item.sizeBytes === "number" &&
      item.sizeBytes > GPT52_MAX_IMAGE_BYTES,
  );
  if (oversizedImage) {
    return "GPT-5.2 image attachments must be 5MB or smaller";
  }

  return null;
}

function validateDeepSeekAttachments(
  attachments: AssistantAttachment[],
): string | null {
  if (attachments.length > 0) {
    return "DeepSeek V3.1 is text-only and does not support attachments";
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
      modelInput?:
        | GeminiChatModeInput
        | Gemini25FlashChatModeInput
        | ClaudeChatModeInput
        | GPT52ChatModeInput
        | DeepSeekChatModeInput;
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
    if (selectedModelId === "google/gemini-2.5-flash") {
      const attachmentValidationError = validateGemini25FlashAttachments(
        normalizedAttachments,
      );
      if (attachmentValidationError) {
        return res
          .status(400)
          .json(formatApiResponse("error", attachmentValidationError, null));
      }
    }
    if (selectedModelId === "openai/gpt-5.2") {
      const attachmentValidationError = validateGPT52Attachments(
        normalizedAttachments,
      );
      if (attachmentValidationError) {
        return res
          .status(400)
          .json(formatApiResponse("error", attachmentValidationError, null));
      }
    }
    if (selectedModelId === "deepseek-ai/deepseek-v3.1") {
      const attachmentValidationError = validateDeepSeekAttachments(
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
          : selectedModelId === "google/gemini-2.5-flash"
            ? mergeGemini25FlashInputWithAttachments(
                modelInput as Gemini25FlashChatModeInput | undefined,
                normalizedAttachments,
              )
            : selectedModelId === "openai/gpt-5.2"
              ? mergeGPT52InputWithAttachments(
                  modelInput as GPT52ChatModeInput | undefined,
                  normalizedAttachments,
                )
              : selectedModelId === "deepseek-ai/deepseek-v3.1"
                ? (modelInput as DeepSeekChatModeInput | undefined)
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
        ? (effectiveModelInput as GeminiChatModeInput | undefined)
        : undefined,
      selectedModelId === "google/gemini-2.5-flash"
        ? (effectiveModelInput as Gemini25FlashChatModeInput | undefined)
        : undefined,
      selectedModelId === "openai/gpt-5.2"
        ? (effectiveModelInput as GPT52ChatModeInput | undefined)
        : undefined,
      selectedModelId === "deepseek-ai/deepseek-v3.1"
        ? (effectiveModelInput as DeepSeekChatModeInput | undefined)
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
      systemPrompt: mergeAssistantStylePrompt(
        selectedModelId === "google/gemini-3.1-pro" && effectiveModelInput
          ? ((effectiveModelInput as GeminiChatModeInput).system_instruction ??
            undefined)
          : selectedModelId === "google/gemini-2.5-flash" && effectiveModelInput
            ? ((effectiveModelInput as Gemini25FlashChatModeInput).system_instruction ??
              undefined)
            : selectedModelId === "anthropic/claude-opus-4.6" && effectiveModelInput
              ? ((effectiveModelInput as ClaudeChatModeInput).system_prompt ??
                undefined)
              : selectedModelId === "openai/gpt-5.2" && effectiveModelInput
                ? ((effectiveModelInput as GPT52ChatModeInput).system_prompt ??
                  undefined)
                : undefined,
      ),
      geminiInput:
        selectedModelId === "google/gemini-3.1-pro"
          ? (effectiveModelInput as GeminiChatModeInput)
          : undefined,
      gemini25FlashInput:
        selectedModelId === "google/gemini-2.5-flash"
          ? (effectiveModelInput as Gemini25FlashChatModeInput)
          : undefined,
      claudeInput:
        selectedModelId === "anthropic/claude-opus-4.6"
          ? (effectiveModelInput as ClaudeChatModeInput)
          : undefined,
      gpt52Input:
        selectedModelId === "openai/gpt-5.2"
          ? (effectiveModelInput as GPT52ChatModeInput)
          : undefined,
      deepseekInput:
        selectedModelId === "deepseek-ai/deepseek-v3.1"
          ? (effectiveModelInput as DeepSeekChatModeInput)
          : undefined,
    });
    const finalPricingParams = getAssistantChatFinalPricingParams(
      selectedModelId,
      sanitized,
      conversationHistory,
      reply,
      selectedModelId === "google/gemini-3.1-pro"
        ? (effectiveModelInput as GeminiChatModeInput | undefined)
        : undefined,
      selectedModelId === "google/gemini-2.5-flash"
        ? (effectiveModelInput as Gemini25FlashChatModeInput | undefined)
        : undefined,
      selectedModelId === "openai/gpt-5.2"
        ? (effectiveModelInput as GPT52ChatModeInput | undefined)
        : undefined,
      selectedModelId === "deepseek-ai/deepseek-v3.1"
        ? (effectiveModelInput as DeepSeekChatModeInput | undefined)
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
