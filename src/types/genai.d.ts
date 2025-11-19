declare module '@google/genai' {
  const GoogleGenAIDefault: any;
  export { GoogleGenAIDefault as GoogleGenAI };
  export default GoogleGenAIDefault;
}

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
