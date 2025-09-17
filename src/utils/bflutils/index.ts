import { FrameSize } from "../../types/bfl";

function getDimensions(ratio: FrameSize): { width: number; height: number } {
    switch (ratio) {
      case "1:1":
        return { width: 1024, height: 1024 };
      case "3:4":
        return { width: 1024, height: 1344 };
      case "4:3":
        return { width: 1344, height: 1024 };
      case "16:9":
        return { width: 1280, height: 720 };
      case "9:16":
        return { width: 720, height: 1280 };
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
    getDimensions
}