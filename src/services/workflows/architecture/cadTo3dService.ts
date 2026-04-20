import Replicate from "replicate";
import { env } from "../../../config/env";
import { ApiError } from "../../../utils/errorHandler";
import { authRepository } from "../../../repository/auth/authRepository";
import { generationHistoryRepository } from "../../../repository/generationHistoryRepository";
import { replicateRepository } from "../../../repository/replicateRepository";
import {
  uploadDataUriToZata,
  uploadFromUrlToZata,
} from "../../../utils/storage/zataUpload";
import { aestheticScoreService } from "../../aestheticScoreService";
import { syncToMirror } from "../../../utils/mirrorHelper";

// Replicate helper for output resolution
const resolveOutputUrls = async (output: any) => {
  if (!output) return [];
  if (Array.isArray(output)) return output.map(String);
  if (typeof output === "object" && output.url) return [String(output.url())];
  return [String(output)];
};

export interface CadTo3dRequest {
  image: string;
  projectType?: string;
  spaces?: string;
  designTheme?: string;
  materials?: string;
  lighting?: string;
  cameraAngle?: string;
  furniture?: string;
  renderQuality?: string;
  isPublic?: boolean;
  output_format?: string;
  size?: string;
  model?: string;
}

const normalizeSeedreamOutputFormat = (format?: string) => {
  const value = (format || "jpeg").toLowerCase();
  if (value === "jpg") return "jpeg";
  if (value === "png" || value === "jpeg") return value;
  return "jpeg";
};

const buildArchitecturePrompt = (req: CadTo3dRequest): string => {
  const {
    projectType = "Interior Rendering",
    spaces = "All spaces",
    designTheme = "Modern",
    materials = "Standard architectural materials",
    lighting = "Daylight",
    cameraAngle = "Wide-angle",
    furniture = "Furnished",
    renderQuality = "High-Resolution Render",
  } = req;

  return `You are an advanced architectural AI system capable of interpreting diverse 2D CAD drawings, floor plans, blueprints, or scanned architectural layouts from different standards, styles, and regions, and converting them into accurate, photorealistic 3D renders.

---

## 🎯 OBJECTIVE

Transform any uploaded CAD or floor plan image into a structurally correct and visually realistic 3D render while adapting to variations in:

* Drawing styles (clean CAD, hand-drawn, scanned)
* Notations (abbreviations, symbols, languages)
* Scales and units (feet, meters, unknown scale)

---

## 🧠 STEP 1: UNIVERSAL PLAN INTERPRETATION

### 🔍 1.1 Detect Structural Elements (Priority-Based)

Identify and reconstruct:

* Walls (primary structure)
* Rooms (enclosed spaces)
* Doors (including swing arcs if visible)
* Windows (gaps in walls)
* Staircases (step patterns or directional lines)
* Open areas (balcony, veranda, lobby)

If symbols vary, infer based on:

* Geometry patterns
* Position and spacing
* Context within layout

---

### 🏷 1.2 Flexible Label Understanding

Interpret room labels even if inconsistent or abbreviated:

Examples:

* BED, BR → Bedroom
* MBR, MBED → Master Bedroom
* WC, TOI, BATH, LOYLET → Bathroom/Toilet
* KIT, KITCH → Kitchen
* LIV, HALL → Living Room
* DIN → Dining
* POOJA, PRAYER → Prayer Room
* STAIR, ST → Staircase

If labels are missing:
👉 Infer room type using:

* Size
* Position (e.g., kitchen near dining)
* Connectivity

---

### 📏 1.3 Scale & Proportion Handling

* If dimensions are present → use them exactly
* If not → estimate scale using:

  * Standard door size (~3 ft width)
  * Typical room proportions
* Maintain consistent proportions across entire layout

---

### 🧩 1.4 Layout Integrity Rules

* Preserve spatial relationships (adjacency, alignment)
* Maintain circulation paths (door connectivity)
* Do NOT overlap or distort rooms
* Keep wall thickness consistent

---

## ⚙️ STEP 2: APPLY USER INPUT (DYNAMIC)

Use frontend inputs dynamically, even if incomplete:

### 🏠 Project Type: \${projectType}

* Interior → render internal spaces only
* Exterior → generate facade using footprint
* Both → ensure consistency between inside & outside

---

### 🧱 Space Selection: \${spaces}

* If user specifies rooms → prioritize those
* If empty → intelligently select key spaces (living, bedroom, kitchen)

---

### 🎨 Design Theme (Adaptive): \${designTheme}

Apply style consistently across all spaces:

* Modern → clean, minimal, neutral
* Minimal → low clutter, open space
* Contemporary → stylish, layered materials
* Classic → detailed, ornamental
* Industrial → raw concrete, metal
* Scandinavian → bright, wood, cozy
* Luxury → premium materials, dramatic lighting
* Regional → adapt to cultural context (e.g., Indian interiors)

If unclear → choose best-fit style automatically

---

### 🧱 Materials (Flexible Override): \${materials}

* Apply user preferences strictly if provided
* Otherwise infer based on theme

---

### 💡 Lighting (Context-Aware): \${lighting}

* Detect window positions → simulate natural light
* Apply selected lighting:

  * Daylight / Golden hour / Night / Studio
* Ensure realistic shadows and bounce light

---

### 📷 Camera Logic (Smart Framing): \${cameraAngle}

* Wide-angle → default for interiors
* Eye-level → human perspective
* Corner → best spatial depth
* Top view → architectural clarity
* Detail → focus on materials

Automatically choose best angle if not specified

---

### 🛋 Furniture Logic: \${furniture}

* Furnished → realistic placement based on room type
* Semi-furnished → essential elements only
* Empty → only architecture

Furniture placement must:

* Respect circulation space
* Align with walls and room function

---

### 🎯 Render Quality Scaling: \${renderQuality}

* Concept → fast, simple shading
* High → detailed textures
* Ultra → photorealistic (ray tracing, reflections, GI)

---

## 🏗 STEP 3: RECONSTRUCTION INTELLIGENCE

* Convert 2D plan into 3D geometry:

  * Extrude walls to realistic height (~9–10 ft default)
  * Add floors, ceilings
* Place doors/windows accurately
* Generate staircase in correct orientation
* Apply physically accurate materials (PBR)

---

## 🎥 STEP 4: VISUAL REALISM

Ensure output includes:

* Global illumination
* Soft shadows
* Accurate reflections
* Depth and perspective
* Real-world scale feel

---

## 🧠 ADAPTIVE BEHAVIOR (IMPORTANT)

* Handle incomplete or noisy CAD inputs gracefully
* Avoid overfitting to exact text labels
* Prioritize geometry over text if conflict occurs
* Infer missing details intelligently but conservatively

---

## 🚫 STRICT RULES

* Do NOT invent unrealistic structures
* Do NOT distort layout
* Do NOT ignore user inputs
* Do NOT mix multiple styles randomly
* Do NOT overcrowd minimal designs

---

## 🎬 FINAL OUTPUT STYLE

"Highly detailed architectural 3D render, photorealistic, global illumination, physically based materials, realistic lighting and shadows, accurate proportions, cinematic composition, professional interior visualization, 4K quality"

---`;
};

export const cadTo3d = async (
  uid: string,
  req: CadTo3dRequest,
) => {
  const key = env.replicateApiKey as string;
  if (!key) throw new ApiError("Replicate API key not configured", 500);

  const replicate = new Replicate({ auth: key });

  const modelBase = req.model || "bytedance/seedream-5-lite";

  const creator = await authRepository.getUserById(uid);
  const prompt = buildArchitecturePrompt(req);

  // 1. Create History Record
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: prompt,
    model: modelBase,
    generationType: "text-to-image",
    visibility: req.isPublic ? "public" : "private",
    isPublic: req.isPublic ?? true,
    createdBy: creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  } as any);

  // 2. Create Legacy Record
  const legacyId = await replicateRepository.createGenerationRecord(
    {
      prompt: prompt,
      model: modelBase,
      isPublic: req.isPublic ?? true,
    },
    creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  );

  // 3. Handle Input Image
  let inputImageUrl = req.image;
  let inputImageStoragePath: string | undefined;

  if (inputImageUrl.startsWith("data:")) {
    const username = creator?.username || uid;
    const stored = await uploadDataUriToZata({
      dataUri: inputImageUrl,
      keyPrefix: `users/${username}/workflows/architecture/cad-to-3d/input/${historyId}`,
      fileName: "source",
    });
    inputImageUrl = stored.publicUrl;
    inputImageStoragePath = (stored as any).key;
  } else if (inputImageUrl.includes("/api/proxy/resource/")) {
    const parts = inputImageUrl.split("/api/proxy/resource/");
    if (parts.length > 1) {
      const k = decodeURIComponent(parts[1]);
      const prefix = env.zataPrefix || "https://idr01.zata.ai/devstoragev1/";
      inputImageUrl = `${prefix}${k}`;
      inputImageStoragePath = k;
    }
  }

  if (inputImageUrl && inputImageStoragePath) {
    await generationHistoryRepository.update(uid, historyId, {
      inputImages: [
        { id: "in-1", url: inputImageUrl, storagePath: inputImageStoragePath },
      ],
    } as any);
  }

  // 4. Call Replicate
  const inputPayload = {
    image_input: [inputImageUrl],
    prompt: prompt,
    size: req.size || "2K",
    aspect_ratio: "match_input_image",
    output_format: normalizeSeedreamOutputFormat(req.output_format),
  };

  try {
    console.log("[cadTo3d] Running model", {
      model: modelBase,
      input: inputPayload,
    });
    const output: any = await replicate.run(modelBase as any, {
      input: inputPayload,
    });

    // 5. Process Output
    const urls = await resolveOutputUrls(output);
    const outputUrl = urls[0];
    if (!outputUrl) throw new Error("No output URL from Replicate");

    let storedUrl = outputUrl;
    let storagePath = "";
    try {
      const username = creator?.username || uid;
      const uploaded = await uploadFromUrlToZata({
        sourceUrl: outputUrl,
        keyPrefix: `users/${username}/workflows/architecture/cad-to-3d/image/${historyId}`,
        fileName: "render-1",
      });
      storedUrl = uploaded.publicUrl;
      storagePath = uploaded.key;
    } catch (e) {
      console.warn("Failed to upload output to Zata", e);
    }

    const images = [
      {
        id: `replicate-${Date.now()}`,
        url: storedUrl,
        storagePath,
        originalUrl: outputUrl,
      },
    ];

    const scoredImages = await aestheticScoreService.scoreImages(images);
    const highestScore = aestheticScoreService.getHighestScore(scoredImages);

    // 6. Update History
    await generationHistoryRepository.update(uid, historyId, {
      status: "completed",
      images: scoredImages,
      aestheticScore: highestScore,
      updatedAt: new Date().toISOString(),
    } as any);

    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images: scoredImages as any,
    });

    await syncToMirror(uid, historyId);

    return {
      images: scoredImages,
      historyId,
      model: modelBase,
      status: "completed",
    };
  } catch (e: any) {
    console.error("[cadTo3d] Error", e);
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate failed",
    } as any);
    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "failed",
      error: e?.message,
    });
    throw new ApiError(e?.message || "Generation failed", 502, e);
  }
};