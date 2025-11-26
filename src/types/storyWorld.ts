/**
 * Story World Types
 * 
 * These types define the structure for maintaining visual consistency
 * across all scenes in a storyboard by tracking characters, locations,
 * and global visual style.
 */

export interface StoryCharacter {
    id: string;                    // Unique identifier (e.g., "char_1")
    name: string;                  // Character name (e.g., "John")
    role: string;                  // Character role (e.g., "Protagonist, shy barista")
    visual_description: string;    // Detailed physical description including hair, clothes, age, body type, colors
    emotion_baseline: string;      // Default emotional state (e.g., "nervous but kind")
    consistency_token: string;     // Unique token for prompt consistency (e.g., "JOHN-ALPHA-FOX")
}

export interface StoryLocation {
    id: string;                    // Unique identifier (e.g., "loc_1")
    name: string;                  // Location name (e.g., "Coffee Shop")
    visual_description: string;    // Detailed description of layout, architecture, furniture, lighting
    color_palette: string;         // Main colors to use (e.g., "warm oranges, browns, soft yellows")
    consistency_token: string;     // Unique token for prompt consistency (e.g., "COFFEE-SHOP-AMBER")
}

export interface GlobalStyle {
    art_style: string;             // Overall art style (e.g., "cinematic semi-realistic, soft lighting")
    color_palette: string;         // Global color palette (e.g., "warm oranges & teal accents")
    aspect_ratio: string;          // Image aspect ratio (e.g., "16:9")
    camera_style: string;          // Camera/composition style (e.g., "film stills, shallow depth of field")
}

export interface StorySceneOutline {
    scene_number: number;          // Sequential scene number
    heading: string;               // Scene heading (e.g., "INT. COFFEE SHOP - DAY")
    summary: string;               // 1-3 sentence summary of the scene
    mood: string;                  // Emotional tone (e.g., "nervous but hopeful")
    character_ids: string[];       // IDs of characters present in this scene
    location_id: string;           // ID of the location where scene takes place
}

export interface StoryWorld {
    characters: StoryCharacter[];
    locations: StoryLocation[];
    global_style: GlobalStyle;
    scene_outline: StorySceneOutline[];
}

export interface GenerateScenesResponse {
    storyWorld: StoryWorld;
    scenes: Array<{
        scene_number: number;
        heading: string;
        content: string;
    }>;
}
