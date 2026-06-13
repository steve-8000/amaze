import type { OutputMeta } from "../tools/output-meta";

export interface ToolCompressionMetadata {
	applied: boolean;
	kind: "search" | "log" | "generic";
	originalBytes: number;
	compressedBytes: number;
	originalLines: number;
	compressedLines: number;
	artifactId?: string;
	sourceArtifact: "reused-existing" | "saved-new";
	reason?: string;
}

export interface ToolCompressionSettings {
	enabled: boolean;
	minimumBytes: number;
	search: {
		enabled: boolean;
		maxFiles: number;
		maxMatchesPerFile: number;
	};
	bash: {
		enabled: boolean;
	};
	log: {
		maxErrorBlocks: number;
		maxWarningFamilies: number;
		maxTotalLines: number;
	};
}

export interface ToolCompressionDetails {
	meta?: OutputMeta;
	compression?: ToolCompressionMetadata;
}

export interface PreservedSuffix {
	body: string;
	suffix: string;
	rawArtifactId?: string;
	existingArtifactId?: string;
}

export interface CompressionOutcome {
	kind: "search" | "log" | "generic";
	text: string;
	reason?: string;
}
