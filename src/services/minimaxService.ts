import axios from "axios";
import {
  MinimaxGenerateRequest,
  MinimaxGenerateResponse,
  MinimaxGeneratedImage,
} from "../types/minimax";
import {
  MinimaxMusicRequest,
  MinimaxMusicResponse,
} from "../types/minimaxMusic";
import { ApiError } from "../utils/errorHandler";
import { minimaxRepository } from "../repository/minimaxRepository";

const MINIMAX_API_BASE = "https://api.minimax.io/v1";
const MINIMAX_MODEL = "image-01";

function mapMiniMaxCodeToHttp(statusCode: number): number {
  switch (statusCode) {
    case 0:
      return 200;
    case 1002:
      return 429; // rate limit triggered
    case 1004:
      return 401; // authentication failed
    case 1008:
      return 402; // insufficient balance
    case 1026:
      return 400; // sensitive input content
    case 1027:
      return 400; // sensitive output content
    case 2013:
      return 400; // invalid/abnormal params
    case 2049:
      return 401; // invalid API key
    case 1000:
    case 1013:
    case 1039:
      return 500; // unknown/internal/TPM
    default:
      return 400;
  }
}

function assertMiniMaxOk(baseResp?: {
  status_code?: number;
  status_msg?: string;
}) {
  if (!baseResp) return;
  const code = Number(baseResp.status_code);
  if (!isNaN(code) && code !== 0) {
    const http = mapMiniMaxCodeToHttp(code);
    throw new ApiError(
      baseResp.status_msg || `MiniMax error ${code}`,
      http,
      baseResp
    );
  }
}

async function generate(
  payload: MinimaxGenerateRequest
): Promise<MinimaxGenerateResponse> {
  const {
    prompt,
    aspect_ratio,
    width,
    height,
    response_format = "url",
    seed,
    n = 1,
    prompt_optimizer = false,
    subject_reference,
    style,
    generationType,
  } = payload;

  if (!prompt)
    throw new ApiError("Missing required field: prompt is required", 400);
  if (prompt.length > 1500)
    throw new ApiError("Prompt exceeds 1500 characters limit", 400);
  if (n < 1 || n > 9) throw new ApiError("n must be between 1 and 9", 400);

  const apiKey = process.env.MINIMAX_API_KEY as string;
  if (!apiKey) throw new ApiError("MiniMax API key not configured", 500);

  const historyId = await minimaxRepository.createGenerationRecord(payload);

  const requestPayload: any = {
    model: MINIMAX_MODEL,
    prompt,
    response_format,
    n,
    prompt_optimizer,
  };

  if (aspect_ratio) requestPayload.aspect_ratio = aspect_ratio;
  if (width !== undefined && height !== undefined) {
    requestPayload.width = width;
    requestPayload.height = height;
  }
  if (seed !== undefined) requestPayload.seed = seed;
  if (subject_reference) requestPayload.subject_reference = subject_reference;

  try {
    const response = await axios.post(
      `${MINIMAX_API_BASE}/image_generation`,
      requestPayload,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        validateStatus: () => true,
      }
    );

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(
        "MiniMax API request failed",
        response.status,
        response.data
      );
    }

    const data = response.data;
    assertMiniMaxOk(data.base_resp);
    if (!data.data)
      throw new ApiError("MiniMax API response missing data field", 400, data);

    let imageUrls: string[] = [];
    if (Array.isArray(data.data.image_urls)) imageUrls = data.data.image_urls;
    else if (Array.isArray(data.data.images)) imageUrls = data.data.images;
    else if (Array.isArray(data.data.urls)) imageUrls = data.data.urls;
    else if (Array.isArray(data.data)) imageUrls = data.data;
    if (imageUrls.length === 0)
      throw new ApiError(
        "No image URLs returned from MiniMax API",
        400,
        data.data
      );

    const images: MinimaxGeneratedImage[] = imageUrls.map(
      (url: string, index: number) => ({
        id: `${data.id || Date.now()}-${index}`,
        url,
        originalUrl: url,
      })
    );

    await minimaxRepository.updateGenerationRecord(historyId, {
      status: "completed",
      images,
    });
    return { images, historyId, id: data.id };
  } catch (err: any) {
    const message = err?.message || "Failed to generate images with MiniMax";
    await minimaxRepository.updateGenerationRecord(historyId, {
      status: "failed",
      error: message,
    });
    throw err;
  }
}

// Video
async function generateVideo(
  apiKey: string,
  _groupId: string,
  body: any
): Promise<{ taskId: string }> {
  if (!apiKey) throw new ApiError("MiniMax API not configured", 500);
  // The video_generation POST does not require GroupId; only file retrieval does
  const res = await axios.post(`${MINIMAX_API_BASE}/video_generation`, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300)
    throw new ApiError("MiniMax video request failed", res.status, res.data);
  const data = res.data || {};
  assertMiniMaxOk(data.base_resp);
  const taskId = data?.result?.task_id || data?.task_id || data?.id;
  if (!taskId)
    throw new ApiError("MiniMax service returned undefined taskId", 502, data);
  return { taskId };
}

async function getVideoStatus(apiKey: string, taskId: string): Promise<any> {
  const res = await axios.get(
    `${MINIMAX_API_BASE}/query/video_generation?task_id=${taskId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    }
  );
  if (res.status < 200 || res.status >= 300)
    throw new ApiError(
      `MiniMax API error: ${res.status}`,
      res.status,
      res.data
    );
  const data = res.data || {};
  // Some responses embed base_resp at root
  assertMiniMaxOk(data.base_resp || (data.result && data.result.base_resp));
  return data;
}

async function getFile(
  apiKey: string,
  groupId: string,
  fileId: string
): Promise<any> {
  const res = await axios.get(
    `${MINIMAX_API_BASE}/files/retrieve?GroupId=${groupId}&file_id=${fileId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    }
  );
  if (res.status < 200 || res.status >= 300)
    throw new ApiError(
      `MiniMax API error: ${res.status}`,
      res.status,
      res.data
    );
  const data = res.data || {};
  // Surface group mismatch case clearly
  if (
    data.base_resp &&
    Number(data.base_resp.status_code) === 1004 &&
    /token not match group/i.test(String(data.base_resp.status_msg))
  ) {
    throw new ApiError(
      "MiniMax 1004: token not match group. Ensure MINIMAX_GROUP_ID matches API key account group.",
      401,
      data.base_resp
    );
  }
  assertMiniMaxOk(data.base_resp);
  return data;
}

// Music
async function generateMusic(
  apiKey: string,
  body: MinimaxMusicRequest
): Promise<MinimaxMusicResponse> {
  if (!apiKey) throw new ApiError("MiniMax API not configured", 500);
  const res = await axios.post(`${MINIMAX_API_BASE}/music_generation`, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(
      `MiniMax music error: ${res.status}`,
      res.status,
      res.data
    );
  }
  return res.data as MinimaxMusicResponse;
}

export const minimaxService = {
  generate,
  generateVideo,
  getVideoStatus,
  getFile,
  generateMusic,
};
