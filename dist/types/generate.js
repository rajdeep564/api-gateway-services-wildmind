"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Visibility = exports.GenerationStatus = exports.GenerationTypes = void 0;
exports.GenerationTypes = {
    TextToImage: 'text-to-image',
    Logo: 'logo',
    Sticker: 'sticker-generation',
    TextToVideo: 'text-to-video',
    TextToMusic: 'text-to-music',
    Mockup: 'mockup-generation',
    Product: 'product-generation',
    Ad: 'ad-generation',
    LiveChat: 'live-chat',
};
var GenerationStatus;
(function (GenerationStatus) {
    GenerationStatus["Generating"] = "generating";
    GenerationStatus["Completed"] = "completed";
    GenerationStatus["Failed"] = "failed";
})(GenerationStatus || (exports.GenerationStatus = GenerationStatus = {}));
var Visibility;
(function (Visibility) {
    Visibility["Private"] = "private";
    Visibility["Public"] = "public";
    Visibility["Unlisted"] = "unlisted";
})(Visibility || (exports.Visibility = Visibility = {}));
