// Type declarations for @google/genai
// Note: The package has its own type definitions at node_modules/@google/genai/dist/genai.d.ts
// We only need to declare @google/generative-ai here

declare module '@google/generative-ai' {
	interface GoogleGenerativeAIOptions {
		apiKey?: string;
		[key: string]: any;
	}

	class GoogleGenerativeAI {
		constructor(opts?: GoogleGenerativeAIOptions | string);
		getGenerativeModel?: (opts: { model: string }) => any;
		models?: { generateContent?: (opts: any) => Promise<any> };
		[key: string]: any;
	}

	const GoogleGenerativeAIDefault: typeof GoogleGenerativeAI;
	export { GoogleGenerativeAIDefault as GoogleGenerativeAI };
	export default GoogleGenerativeAIDefault;
}
