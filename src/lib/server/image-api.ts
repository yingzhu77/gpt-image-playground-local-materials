import type { ImageModeration } from '@/lib/models';
import fs from 'fs/promises';
import OpenAI from 'openai';
import path from 'path';

export type ImageEditParams = OpenAI.Images.ImageEditParamsNonStreaming & { moderation?: ImageModeration };

export type ImageApiCallResult = {
    result: OpenAI.Images.ImagesResponse;
    openaiRequestId: string | null;
    mock: boolean;
};

export interface ImageApiClient {
    readonly mock: boolean;
    generate(params: OpenAI.Images.ImageGenerateParamsNonStreaming): Promise<ImageApiCallResult>;
    edit(params: ImageEditParams): Promise<ImageApiCallResult>;
}

export class ConfigurationError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'ConfigurationError';
        this.code = code;
    }
}

export class MockConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MockConfigurationError';
    }
}

export function isImageApiEnabled(): boolean {
    return process.env.ENABLE_IMAGE_API?.trim().toLowerCase() === 'true';
}

export function hasOpenAiApiKey(): boolean {
    return !!process.env.OPENAI_API_KEY?.trim();
}

/**
 * Test-only fixture provider. It replaces the SDK client entirely and can never fall back
 * to the real network. Production builds refuse to activate it.
 */
export function isImageApiMockMode(): boolean {
    return process.env.NODE_ENV !== 'production' && !!process.env.IMAGE_API_MOCK_FIXTURE_DIR?.trim();
}

export function getImageApiConfiguration() {
    return {
        enabled: isImageApiEnabled(),
        apiKeyConfigured: hasOpenAiApiKey(),
        mock: isImageApiMockMode()
    };
}

export function getImageApiDiagnostics() {
    return {
        timeoutMs: openAiClient?.timeout ?? OpenAI.DEFAULT_TIMEOUT,
        maxRetries: 0,
        mock: isImageApiMockMode(),
        nodeUseEnvProxy: process.env.NODE_USE_ENV_PROXY === '1',
        proxy: describeProxyForLogs()
    };
}

function describeProxyForLogs() {
    const raw = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
    if (!raw) return { configured: false };

    try {
        const parsed = new URL(raw);
        return {
            configured: true,
            protocol: parsed.protocol,
            host: parsed.hostname,
            port: parsed.port || null
        };
    } catch {
        return { configured: true, protocol: 'unknown', host: 'unparseable', port: null };
    }
}

let openAiClient: OpenAI | null = null;
let fixtureClient: FixtureImageApiClient | null = null;

export function getImageApiClient(): ImageApiClient {
    if (isImageApiMockMode()) {
        fixtureClient ??= new FixtureImageApiClient(process.env.IMAGE_API_MOCK_FIXTURE_DIR!.trim());
        return fixtureClient;
    }

    if (!hasOpenAiApiKey()) {
        throw new ConfigurationError('OPENAI_API_KEY_MISSING', '服务端未配置 OPENAI_API_KEY。');
    }

    openAiClient ??= new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        maxRetries: 0
    });

    return new OpenAiImageApiClient(openAiClient);
}

class OpenAiImageApiClient implements ImageApiClient {
    readonly mock = false;

    constructor(private readonly client: OpenAI) {}

    async generate(params: OpenAI.Images.ImageGenerateParamsNonStreaming): Promise<ImageApiCallResult> {
        const { data, request_id } = await this.client.images.generate(params).withResponse();
        return { result: data, openaiRequestId: request_id, mock: false };
    }

    async edit(params: ImageEditParams): Promise<ImageApiCallResult> {
        const { data, request_id } = await this.client.images.edit(params).withResponse();
        return { result: data, openaiRequestId: request_id, mock: false };
    }
}

type MockScenario = {
    error?: 'rate_limit' | 'unauthorized' | 'forbidden' | 'timeout' | 'server';
    usage?: 'present' | 'missing';
    requestId?: string | null;
    delayMs?: number;
    fixture?: string;
};

class MockUpstreamError extends Error {
    readonly status: number;

    constructor(name: string, message: string, status: number) {
        super(message);
        this.name = name;
        this.status = status;
    }
}

const MOCK_USAGE: OpenAI.Images.ImagesResponse['usage'] = {
    input_tokens: 12,
    output_tokens: 272,
    total_tokens: 284,
    input_tokens_details: { text_tokens: 12, image_tokens: 0 },
    output_tokens_details: { image_tokens: 272, text_tokens: 0 }
};

class FixtureImageApiClient implements ImageApiClient {
    readonly mock = true;
    private readonly fixtureDir: string;

    constructor(fixtureDir: string) {
        this.fixtureDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), fixtureDir);
    }

    generate(params: OpenAI.Images.ImageGenerateParamsNonStreaming): Promise<ImageApiCallResult> {
        return this.respond('generate', params);
    }

    edit(params: ImageEditParams): Promise<ImageApiCallResult> {
        return this.respond('edit', params);
    }

    private async respond(
        operation: 'generate' | 'edit',
        params: OpenAI.Images.ImageGenerateParamsNonStreaming | ImageEditParams
    ): Promise<ImageApiCallResult> {
        const scenario = await this.readScenario();
        await this.writeLog(operation, params, scenario);

        if (scenario.delayMs) {
            await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
        }

        if (scenario.error) {
            throw this.createError(scenario.error);
        }

        const size = typeof params.size === 'string' ? params.size : 'auto';
        const background = params.background ?? 'auto';
        const format = params.output_format ?? 'png';
        const bytes = await this.readFixture(size, background, format, scenario.fixture);
        const usage = scenario.usage === 'missing' ? undefined : MOCK_USAGE;

        const result = {
            created: Math.floor(Date.now() / 1000),
            data: [{ b64_json: bytes.toString('base64') }],
            background,
            output_format: format,
            quality: params.quality,
            size,
            usage
        } as OpenAI.Images.ImagesResponse;

        return {
            result,
            openaiRequestId: scenario.requestId ?? null,
            mock: true
        };
    }

    private async readScenario(): Promise<MockScenario> {
        const scenarioFile = process.env.IMAGE_API_MOCK_SCENARIO_FILE?.trim();
        if (!scenarioFile) return {};

        try {
            const content = await fs.readFile(path.resolve(/*turbopackIgnore: true*/ process.cwd(), scenarioFile), 'utf8');
            return JSON.parse(content) as MockScenario;
        } catch (error) {
            throw new MockConfigurationError(
                `无法读取 mock 场景文件：${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private async readFixture(size: string, background: string, format: string, forcedFixture?: string): Promise<Buffer> {
        if (forcedFixture) {
            const filename = path.basename(forcedFixture);
            try {
                return await fs.readFile(path.join(/*turbopackIgnore: true*/ this.fixtureDir, filename));
            } catch (error) {
                throw new MockConfigurationError(
                    `无法读取指定的 mock fixture ${filename}：${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        const safeSize = size.replace(/[^0-9a-zA-Z_-]/g, '_');
        const safeBackground = background.replace(/[^0-9a-zA-Z_-]/g, '_');
        const safeFormat = format.replace(/[^0-9a-zA-Z_-]/g, '_');
        const candidates = [
            `${safeSize}_${safeBackground}.${safeFormat}`,
            `${safeSize}.${safeFormat}`,
            `default_${safeBackground}.${safeFormat}`,
            `default.${safeFormat}`
        ];

        for (const filename of candidates) {
            try {
                return await fs.readFile(path.join(/*turbopackIgnore: true*/ this.fixtureDir, filename));
            } catch (error) {
                if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
                    continue;
                }
                throw new MockConfigurationError(
                    `读取 mock 图片失败 ${filename}：${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        throw new MockConfigurationError(
            `缺少 mock 图片 fixture（尝试过：${candidates.join(', ')}），不会回退到真实 OpenAI 请求。`
        );
    }

    private createError(kind: NonNullable<MockScenario['error']>): MockUpstreamError {
        if (kind === 'rate_limit') {
            return new MockUpstreamError('RateLimitError', 'Mock rate limit (429).', 429);
        }
        if (kind === 'unauthorized') {
            return new MockUpstreamError('AuthenticationError', 'Mock unauthorized (401).', 401);
        }
        if (kind === 'forbidden') {
            return new MockUpstreamError('PermissionDeniedError', 'Mock forbidden (403).', 403);
        }
        if (kind === 'timeout') {
            return new MockUpstreamError('APIConnectionTimeoutError', 'Mock request timeout.', 408);
        }
        return new MockUpstreamError('InternalServerError', 'Mock upstream error (500).', 500);
    }

    private async writeLog(
        operation: 'generate' | 'edit',
        params: OpenAI.Images.ImageGenerateParamsNonStreaming | ImageEditParams,
        scenario: MockScenario
    ): Promise<void> {
        const logFile = process.env.IMAGE_API_MOCK_LOG?.trim();
        if (!logFile) return;

        const imageFiles = operation === 'edit' ? toFileList((params as ImageEditParams).image) : [];
        const mask = operation === 'edit' ? (params as ImageEditParams).mask : undefined;
        const entry = {
            mock: true,
            timestamp: new Date().toISOString(),
            operation,
            prompt: params.prompt,
            model: params.model,
            size: params.size,
            quality: params.quality,
            n: params.n,
            background: params.background,
            output_format: params.output_format,
            moderation: params.moderation,
            output_compression: params.output_compression,
            image_filenames: imageFiles.map((file) => file.name),
            has_mask: !!mask,
            mask_filename: mask instanceof File ? mask.name : null,
            usage: scenario.usage ?? 'present',
            error: scenario.error ?? null,
            fixture: scenario.fixture ?? null
        };

        try {
            await fs.appendFile(path.resolve(/*turbopackIgnore: true*/ process.cwd(), logFile), `${JSON.stringify(entry)}\n`, 'utf8');
        } catch (error) {
            throw new MockConfigurationError(
                `无法写入 mock 日志：${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

function toFileList(image: ImageEditParams['image']): File[] {
    if (!image) return [];
    return Array.isArray(image) ? image.filter((item): item is File => item instanceof File) : [image as File];
}
