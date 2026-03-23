/**
 * Register all OpenClaw tools with the registry.
 */

import { registerTool } from "../toolRegistry";
import { generateContentTool } from "./generation";
import { generateLogoTool, generateImageTool, generateVideoTool, generateMusicTool } from "./generationAliases";
import { getCreditBalanceTool, upgradePlanTool } from "./account";
import { getUserAssetsTool, getRecentGenerationsTool, getAssetTool, deleteAssetTool } from "./assets";
import { editImageTool, upscaleImageTool, removeBackgroundTool } from "./canvas";
import { navigatePageTool } from "./navigation";
import { searchSimilarCreationsTool } from "./similarCreations";
import { addTextTool, addToPortfolioTool, getUserStyleTool, saveUserPreferenceTool } from "./stubs";
import {
  generateRequirementSchemaTool,
  gatherRequirementsTool,
  previewPlanTool,
  executePlanTool,
} from "./assistantLoop";

export function registerOpenClawTools(): void {
  // v2 assistant loop (streaming + plan approval)
  registerTool(generateRequirementSchemaTool);
  registerTool(gatherRequirementsTool);
  registerTool(previewPlanTool);
  registerTool(executePlanTool);

  registerTool(generateContentTool);
  registerTool(generateLogoTool);
  registerTool(generateImageTool);
  registerTool(generateVideoTool);
  registerTool(generateMusicTool);
  registerTool(getCreditBalanceTool);
  registerTool(upgradePlanTool);
  registerTool(getUserAssetsTool);
  registerTool(getRecentGenerationsTool);
  registerTool(getAssetTool);
  registerTool(deleteAssetTool);
  registerTool(editImageTool);
  registerTool(removeBackgroundTool);
  registerTool(upscaleImageTool);
  registerTool(addTextTool);
  registerTool(navigatePageTool);
  registerTool(searchSimilarCreationsTool);
  registerTool(addToPortfolioTool);
  registerTool(getUserStyleTool);
  registerTool(saveUserPreferenceTool);
}
