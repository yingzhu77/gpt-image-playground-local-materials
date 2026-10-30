type RuntimeApiConfig = {
    apiKey: string | null;
    enabled: boolean | null;
};

type RuntimeConfigGlobal = typeof globalThis & {
    __gptImagePlaygroundRuntimeApiConfig?: RuntimeApiConfig;
};

const runtimeGlobal = globalThis as RuntimeConfigGlobal;

function getRuntimeConfig(): RuntimeApiConfig {
    runtimeGlobal.__gptImagePlaygroundRuntimeApiConfig ??= { apiKey: null, enabled: null };
    return runtimeGlobal.__gptImagePlaygroundRuntimeApiConfig;
}

export type ApiKeySource = 'env' | 'runtime' | 'none';

export function setRuntimeApiConfig({ apiKey, enabled }: { apiKey: string; enabled: boolean }): void {
    const runtime = getRuntimeConfig();
    runtime.apiKey = apiKey;
    runtime.enabled = enabled;
}

export function clearRuntimeApiConfig(): void {
    const runtime = getRuntimeConfig();
    runtime.apiKey = null;
    runtime.enabled = null;
}

export function getEffectiveApiKey(): string | null {
    const runtime = getRuntimeConfig();
    if (runtime.apiKey !== null) return runtime.apiKey || null;

    const envKey = process.env.OPENAI_API_KEY?.trim();
    return envKey ? envKey : null;
}

export function getApiKeySource(): ApiKeySource {
    const runtime = getRuntimeConfig();
    if (runtime.apiKey !== null) return 'runtime';
    return process.env.OPENAI_API_KEY?.trim() ? 'env' : 'none';
}

export function isImageApiEnabled(): boolean {
    const runtime = getRuntimeConfig();
    if (runtime.enabled !== null) return runtime.enabled;
    return process.env.ENABLE_IMAGE_API?.trim().toLowerCase() === 'true';
}

export function hasOpenAiApiKey(): boolean {
    return getEffectiveApiKey() !== null;
}
