declare module 'probe-image-size' {
	export type ProbeResult = {
		width: number;
		height: number;
		type?: string;
		mime?: string;
		length?: number;
		url?: string;
	};
	const probe: (src: any) => Promise<ProbeResult>;
	export default probe;
}
