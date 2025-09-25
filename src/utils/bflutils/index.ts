import { FrameSize } from "../../types/bfl";
import { creditDistributionData } from "../../data/creditDistribution";

function getDimensions(ratio: FrameSize): { width: number; height: number } {
    switch (ratio) {
      case "1:1":
        return { width: 1024, height: 1024 };
      case "3:4":
        return { width: 1024, height: 1344 };
      case "4:3":
        return { width: 1344, height: 1024 };
      case "16:9":
        // Ensure multiples of 32 to satisfy provider constraints
        // 1344x768 preserves 16:9 closely and both are multiples of 32
        return { width: 1344, height: 768 };
      case "9:16":
        // 768x1344 mirrors the 16:9 correction
        return { width: 768, height: 1344 };
      case "3:2":
        return { width: 1344, height: 896 };
      case "2:3":
        return { width: 896, height: 1344 };
      case "21:9":
        return { width: 1344, height: 576 };
      case "9:21":
        return { width: 576, height: 1344 };
      case "16:10":
        return { width: 1280, height: 800 };
      case "10:16":
        return { width: 800, height: 1280 };
      default:
        return { width: 1024, height: 768 };
    }
  }

export const  bflutils = {
    getDimensions,
    getCreditsPerImage(model: string): number | null {
        const normalized = model.toLowerCase();
        const keyMap: Record<string, string> = {
            'flux-pro-1.1-ultra': 'FLUX 1.1 [pro] Ultra',
            'flux-pro-1.1': 'FLUX 1.1 [pro]',
            'flux-pro': 'FLUX.1 [pro]',
            'flux-dev': 'FLUX.1 [dev]',
            'flux-kontext-pro': 'FLUX.1 Kontext [pro]',
            'flux-kontext-max': 'FLUX.1 Kontext [max]',
            // fallback for older op-specific endpoints
            'flux-pro-1.0-fill': 'FLUX.1 [pro]',
            'flux-pro-1.0-expand': 'FLUX.1 [pro]',
            'flux-pro-1.0-canny': 'FLUX.1 [pro]',
            'flux-pro-1.0-depth': 'FLUX.1 [pro]',
        };
        const display = keyMap[normalized];
        if (display) {
            const match = creditDistributionData.find(m => m.modelName === display);
            if (match) return match.creditsPerGeneration;
        }
        const item = creditDistributionData.find(m => m.modelName.toLowerCase().includes(normalized));
        return item?.creditsPerGeneration ?? null;
    }
}