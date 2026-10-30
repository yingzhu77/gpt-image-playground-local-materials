'use client';

import { EditingForm, type EditingFormData } from '@/components/editing-form';
import { GenerationForm, type GenerationFormData } from '@/components/generation-form';
import { HistoryPanel } from '@/components/history-panel';
import { ImageOutput } from '@/components/image-output';
import { PasswordDialog } from '@/components/password-dialog';
import { RequestConfirmationDialog } from '@/components/request-confirmation-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { calculateApiCost, type ApiUsage, type CostDetails } from '@/lib/cost-utils';
import { db, type ImageRecord } from '@/lib/db';
import {
    DEFAULT_GPT_IMAGE_MODEL,
    MAX_EDIT_IMAGES,
    type HistoryGptImageModel,
    type ImageBackground,
    type ImageModeration,
    type ImageOutputFormat,
    type ImageQuality
} from '@/lib/models';
import type { RequestSnapshot } from '@/lib/request-types';
import { DEFAULT_SIZE_PRESET, getPresetDimensions } from '@/lib/size-utils';
import { useLiveQuery } from 'dexie-react-hooks';
import * as React from 'react';

type HistoryImage = {
    filename: string;
    width?: number | null;
    height?: number | null;
};

export type HistoryMetadata = {
    timestamp: number;
    images: HistoryImage[];
    storageModeUsed?: 'fs' | 'indexeddb';
    durationMs: number;
    quality: ImageQuality;
    background: ImageBackground;
    moderation: ImageModeration;
    prompt: string;
    mode: 'generate' | 'edit';
    costDetails: CostDetails | null;
    output_format?: ImageOutputFormat;
    /** Absent on entries written before the field existed; those were all produced by gpt-image-1. */
    model?: HistoryGptImageModel;
    size?: string;
    n?: number;
    usage?: ApiUsage | null;
    requestId?: string;
    openaiRequestId?: string | null;
    metadataFile?: string | null;
    isMock?: boolean;
    archiveWarning?: string | null;
};

type DrawnPoint = {
    x: number;
    y: number;
    size: number;
};

const explicitModeClient = process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE;

const vercelEnvClient = process.env.NEXT_PUBLIC_VERCEL_ENV;
const isOnVercelClient = vercelEnvClient === 'production' || vercelEnvClient === 'preview';

let effectiveStorageModeClient: 'fs' | 'indexeddb';

if (explicitModeClient === 'fs') {
    effectiveStorageModeClient = 'fs';
} else if (explicitModeClient === 'indexeddb') {
    effectiveStorageModeClient = 'indexeddb';
} else if (isOnVercelClient) {
    effectiveStorageModeClient = 'indexeddb';
} else {
    effectiveStorageModeClient = 'fs';
}
console.log(
    `Client Effective Storage Mode: ${effectiveStorageModeClient} (Explicit: ${explicitModeClient || 'unset'}, Vercel Env: ${vercelEnvClient || 'N/A'})`
);

type ApiImageResponseItem = {
    filename: string;
    b64_json?: string;
    output_format: string;
    path?: string;
    width?: number | null;
    height?: number | null;
};

type ImageApiResponse = {
    images?: ApiImageResponseItem[];
    usage?: ApiUsage | null;
    usage_missing?: boolean;
    request_id?: string;
    openai_request_id?: string | null;
    metadata_file?: string | null;
    metadata_error?: string | null;
    warnings?: string[];
    mock?: boolean;
    error?: string;
};

type ImageApiStatus = {
    enabled: boolean;
    apiKeyConfigured: boolean;
    mock: boolean;
};

type RequestResultMeta = {
    requestId?: string;
    openaiRequestId?: string | null;
    metadataFile?: string | null;
    metadataError?: string | null;
    mock?: boolean;
    warnings?: string[];
};

export default function HomePage() {
    const [mode, setMode] = React.useState<'generate' | 'edit'>('generate');
    const [isPasswordRequiredByBackend, setIsPasswordRequiredByBackend] = React.useState<boolean | null>(null);
    const [clientPasswordHash, setClientPasswordHash] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const [generationStartTime, setGenerationStartTime] = React.useState<number | null>(null);
    const [isSendingToEdit, setIsSendingToEdit] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [warning, setWarning] = React.useState<string | null>(null);
    const [imageApiStatus, setImageApiStatus] = React.useState<ImageApiStatus | null>(null);
    const [latestImageBatch, setLatestImageBatch] = React.useState<{ path: string; filename: string }[] | null>(null);
    const [imageOutputView, setImageOutputView] = React.useState<'grid' | number>('grid');
    const [latestOutputIsTransparent, setLatestOutputIsTransparent] = React.useState(false);
    const [history, setHistory] = React.useState<HistoryMetadata[]>([]);
    const [isInitialLoad, setIsInitialLoad] = React.useState(true);
    const blobUrlCacheRef = React.useRef<Map<string, string>>(new Map());
    const inFlightRef = React.useRef(false);
    const [pendingRequest, setPendingRequest] = React.useState<RequestSnapshot | null>(null);
    const [isPasswordDialogOpen, setIsPasswordDialogOpen] = React.useState(false);
    const [passwordDialogContext, setPasswordDialogContext] = React.useState<'initial' | 'retry'>('initial');
    const [skipDeleteConfirmation, setSkipDeleteConfirmation] = React.useState<boolean>(false);
    const [itemToDeleteConfirm, setItemToDeleteConfirm] = React.useState<HistoryMetadata | null>(null);
    const [dialogCheckboxStateSkipConfirm, setDialogCheckboxStateSkipConfirm] = React.useState<boolean>(false);

    const allDbImages = useLiveQuery<ImageRecord[] | undefined>(() => db.images.toArray(), []);

    const [editImageFiles, setEditImageFiles] = React.useState<File[]>([]);
    const [editSourceImagePreviewUrls, setEditSourceImagePreviewUrls] = React.useState<string[]>([]);
    const [editPrompt, setEditPrompt] = React.useState('');
    const [editSize, setEditSize] = React.useState<EditingFormData['size']>(DEFAULT_SIZE_PRESET);
    const [editCustomWidth, setEditCustomWidth] = React.useState<number>(1024);
    const [editCustomHeight, setEditCustomHeight] = React.useState<number>(1024);
    const [editQuality, setEditQuality] = React.useState<EditingFormData['quality']>('low');
    const [editOutputFormat, setEditOutputFormat] = React.useState<EditingFormData['output_format']>('png');
    const [editCompression, setEditCompression] = React.useState([100]);
    const [editBackground, setEditBackground] = React.useState<EditingFormData['background']>('auto');
    const [editModeration, setEditModeration] = React.useState<EditingFormData['moderation']>('auto');
    const [editBrushSize, setEditBrushSize] = React.useState([20]);
    const [editShowMaskEditor, setEditShowMaskEditor] = React.useState(false);
    const [editGeneratedMaskFile, setEditGeneratedMaskFile] = React.useState<File | null>(null);
    const [editIsMaskSaved, setEditIsMaskSaved] = React.useState(false);
    const [editOriginalImageSize, setEditOriginalImageSize] = React.useState<{ width: number; height: number } | null>(
        null
    );
    const [editDrawnPoints, setEditDrawnPoints] = React.useState<DrawnPoint[]>([]);
    const [editMaskPreviewUrl, setEditMaskPreviewUrl] = React.useState<string | null>(null);

    const [genModel, setGenModel] = React.useState<GenerationFormData['model']>(DEFAULT_GPT_IMAGE_MODEL);
    const [genPrompt, setGenPrompt] = React.useState('');
    const [genSize, setGenSize] = React.useState<GenerationFormData['size']>(DEFAULT_SIZE_PRESET);
    const [genCustomWidth, setGenCustomWidth] = React.useState<number>(1024);
    const [genCustomHeight, setGenCustomHeight] = React.useState<number>(1024);
    const [genQuality, setGenQuality] = React.useState<GenerationFormData['quality']>('low');
    const [genOutputFormat, setGenOutputFormat] = React.useState<GenerationFormData['output_format']>('png');
    const [genCompression, setGenCompression] = React.useState([100]);
    const [genBackground, setGenBackground] = React.useState<GenerationFormData['background']>('auto');
    const [genModeration, setGenModeration] = React.useState<GenerationFormData['moderation']>('auto');

    const [editModel, setEditModel] = React.useState<EditingFormData['model']>(DEFAULT_GPT_IMAGE_MODEL);

    const getImageSrc = React.useCallback(
        (filename: string): string | undefined => {
            const cached = blobUrlCacheRef.current.get(filename);
            if (cached) return cached;

            const record = allDbImages?.find((img) => img.filename === filename);
            if (record?.blob) {
                const url = URL.createObjectURL(record.blob);
                blobUrlCacheRef.current.set(filename, url);
                return url;
            }

            return undefined;
        },
        [allDbImages]
    );

    React.useEffect(() => {
        const cache = blobUrlCacheRef.current;
        return () => {
            cache.forEach((url) => URL.revokeObjectURL(url));
            cache.clear();
        };
    }, []);

    React.useEffect(() => {
        return () => {
            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [editSourceImagePreviewUrls]);

    React.useEffect(() => {
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;

            try {
                const storedHistory = localStorage.getItem('openaiImageHistory');
                if (storedHistory) {
                    const parsedHistory: HistoryMetadata[] = JSON.parse(storedHistory);
                    if (Array.isArray(parsedHistory)) {
                        setHistory(parsedHistory);
                    } else {
                        console.warn('Invalid history data found in localStorage.');
                        localStorage.removeItem('openaiImageHistory');
                    }
                }
            } catch (e) {
                console.error('Failed to load or parse history from localStorage:', e);
                localStorage.removeItem('openaiImageHistory');
            }
            setIsInitialLoad(false);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    React.useEffect(() => {
        const fetchAuthStatus = async () => {
            try {
                const response = await fetch('/api/auth-status');
                if (!response.ok) {
                    throw new Error('Failed to fetch auth status');
                }
                const data = await response.json();
                setIsPasswordRequiredByBackend(data.passwordRequired);
                setImageApiStatus({
                    enabled: data.imageApiEnabled === true,
                    apiKeyConfigured: data.apiKeyConfigured === true,
                    mock: data.imageApiMock === true
                });
            } catch (error) {
                console.error('Error fetching auth status:', error);
                setIsPasswordRequiredByBackend(false);
            }
        };

        fetchAuthStatus();

        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;

            const storedHash = localStorage.getItem('clientPasswordHash');
            if (storedHash) {
                setClientPasswordHash(storedHash);
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    React.useEffect(() => {
        if (!isInitialLoad) {
            try {
                localStorage.setItem('openaiImageHistory', JSON.stringify(history));
            } catch (e) {
                console.error('Failed to save history to localStorage:', e);
            }
        }
    }, [history, isInitialLoad]);

    React.useEffect(() => {
        return () => {
            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [editSourceImagePreviewUrls]);

    React.useEffect(() => {
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;

            const storedPref = localStorage.getItem('imageGenSkipDeleteConfirm');
            if (storedPref === 'true') {
                setSkipDeleteConfirmation(true);
            } else if (storedPref === 'false') {
                setSkipDeleteConfirmation(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    React.useEffect(() => {
        localStorage.setItem('imageGenSkipDeleteConfirm', String(skipDeleteConfirmation));
    }, [skipDeleteConfirmation]);

    React.useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            if (mode !== 'edit' || !event.clipboardData) {
                return;
            }

            if (editImageFiles.length >= MAX_EDIT_IMAGES) {
                alert(`Cannot paste: Maximum of ${MAX_EDIT_IMAGES} images reached.`);
                return;
            }

            const items = event.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const file = items[i].getAsFile();
                    if (file) {
                        event.preventDefault();

                        const previewUrl = URL.createObjectURL(file);

                        setEditImageFiles((prevFiles) => [...prevFiles, file]);
                        setEditSourceImagePreviewUrls((prevUrls) => [...prevUrls, previewUrl]);

                        break;
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);

        return () => {
            window.removeEventListener('paste', handlePaste);
        };
    }, [mode, editImageFiles.length]);

    async function sha256Client(text: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    const handleSavePassword = async (password: string) => {
        if (!password.trim()) {
            setError('Password cannot be empty.');
            return;
        }
        try {
            const hash = await sha256Client(password);
            localStorage.setItem('clientPasswordHash', hash);
            setClientPasswordHash(hash);
            setError(null);
            setIsPasswordDialogOpen(false);
        } catch (e) {
            console.error('Error hashing password:', e);
            setError('Failed to save password due to a hashing error.');
        }
    };

    const handleOpenPasswordDialog = () => {
        setPasswordDialogContext('initial');
        setIsPasswordDialogOpen(true);
    };

    const getMimeTypeFromFormat = (format: string): string => {
        if (format === 'jpeg') return 'image/jpeg';
        if (format === 'webp') return 'image/webp';

        return 'image/png';
    };

    // Persist blobs (indexeddb mode), show the batch, and record history from the confirmed snapshot.
    const processApiImages = async (
        images: ApiImageResponseItem[],
        usage: ApiUsage | null | undefined,
        durationMs: number,
        snapshot: RequestSnapshot,
        meta: RequestResultMeta
    ) => {
        const warnings = meta.warnings ?? [];
        const newHistoryEntry: HistoryMetadata = {
            timestamp: Date.now(),
            images: images.map((img) => ({
                filename: img.filename,
                width: img.width ?? null,
                height: img.height ?? null
            })),
            storageModeUsed: effectiveStorageModeClient,
            durationMs,
            quality: snapshot.quality,
            background: snapshot.background,
            moderation: snapshot.moderation,
            output_format: snapshot.output_format,
            prompt: snapshot.prompt,
            mode: snapshot.mode,
            costDetails: calculateApiCost(usage, snapshot.model),
            model: snapshot.model,
            size: snapshot.size,
            n: 1,
            usage: usage ?? null,
            requestId: meta.requestId,
            openaiRequestId: meta.openaiRequestId ?? null,
            metadataFile: meta.metadataFile ?? null,
            isMock: !!meta.mock,
            archiveWarning: meta.metadataError ?? null
        };

        let newImageBatchPromises: Promise<{ path: string; filename: string } | null>[];
        if (effectiveStorageModeClient === 'indexeddb') {
            newImageBatchPromises = images.map(async (img) => {
                if (!img.b64_json) {
                    console.warn(`Image ${img.filename} missing b64_json in indexeddb mode.`);
                    return null;
                }
                try {
                    const byteCharacters = atob(img.b64_json);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);

                    const actualMimeType = getMimeTypeFromFormat(img.output_format);
                    const blob = new Blob([byteArray], { type: actualMimeType });

                    await db.images.put({ filename: img.filename, blob });

                    const blobUrl = URL.createObjectURL(blob);
                    blobUrlCacheRef.current.set(img.filename, blobUrl);

                    return { filename: img.filename, path: blobUrl };
                } catch (dbError) {
                    console.error(`Error saving blob ${img.filename} to IndexedDB:`, dbError);
                    setError(`Failed to save image ${img.filename} to local database.`);
                    return null;
                }
            });
        } else {
            newImageBatchPromises = images
                .filter((img) => !!img.path)
                .map((img) => Promise.resolve({ path: img.path!, filename: img.filename }));
        }

        const processedImages = (await Promise.all(newImageBatchPromises)).filter(Boolean) as {
            path: string;
            filename: string;
        }[];

        setLatestImageBatch(processedImages);
        setImageOutputView(processedImages.length > 1 ? 'grid' : 0);
        setLatestOutputIsTransparent(snapshot.background === 'transparent' && snapshot.output_format === 'png');
        setHistory((prevHistory) => [newHistoryEntry, ...prevHistory]);

        if (meta.mock) {
            setWarning(
                `当前结果来自 MOCK 测试数据，未调用真实 OpenAI API，也不代表真实费用、模型权限或生成质量。${
                    warnings.length > 0 ? ` ${warnings.join(' ')}` : ''
                }`
            );
        } else if (warnings.length > 0) {
            setWarning(warnings.join(' '));
        }
    };

    const resolveRequestSize = (preset: GenerationFormData['size'], width: number, height: number): string => {
        return preset === 'custom' ? `${width}x${height}` : (getPresetDimensions(preset) ?? 'auto');
    };

    const buildRequestSnapshot = (formData: GenerationFormData | EditingFormData): RequestSnapshot => {
        if (mode === 'generate') {
            const genData = formData as GenerationFormData;
            return {
                mode,
                prompt: genData.prompt,
                model: genData.model,
                size: resolveRequestSize(genData.size, genData.customWidth, genData.customHeight),
                quality: genData.quality,
                n: 1,
                background: genData.background,
                output_format: genData.output_format,
                output_compression: genData.output_compression,
                moderation: genData.moderation,
                referenceImages: [],
                mask: null
            };
        }

        const editData = formData as EditingFormData;
        return {
            mode,
            prompt: editData.prompt,
            model: editData.model,
            size: resolveRequestSize(editData.size, editData.customWidth, editData.customHeight),
            quality: editData.quality,
            n: 1,
            background: editData.background,
            output_format: editData.output_format,
            output_compression: editData.output_compression,
            moderation: editData.moderation,
            referenceImages: editData.imageFiles.map((file) => ({ name: file.name, file })),
            mask: editData.maskFile ? { name: editData.maskFile.name, file: editData.maskFile } : null
        };
    };

    const handleRequestSubmit = (formData: GenerationFormData | EditingFormData) => {
        if (inFlightRef.current) return;
        setError(null);
        setWarning(null);
        setPendingRequest(buildRequestSnapshot(formData));
    };

    const handleCancelRequest = () => {
        if (!inFlightRef.current) {
            setPendingRequest(null);
        }
    };

    const handleConfirmRequest = () => {
        const snapshot = pendingRequest;
        if (!snapshot || inFlightRef.current) return;
        setPendingRequest(null);
        void executeRequest(snapshot);
    };

    const executeRequest = async (snapshot: RequestSnapshot) => {
        if (inFlightRef.current) return;
        inFlightRef.current = true;

        const startTime = Date.now();
        let durationMs = 0;

        setIsLoading(true);
        setGenerationStartTime(startTime);
        setError(null);
        setWarning(null);
        setLatestImageBatch(null);
        setLatestOutputIsTransparent(false);
        setImageOutputView('grid');

        try {
            if (isPasswordRequiredByBackend && !clientPasswordHash) {
                setError('Password is required. Please configure the password by clicking the lock icon.');
                setPasswordDialogContext('initial');
                setIsPasswordDialogOpen(true);
                return;
            }

            const apiFormData = new FormData();
            if (isPasswordRequiredByBackend && clientPasswordHash) {
                apiFormData.append('passwordHash', clientPasswordHash);
            }
            apiFormData.append('mode', snapshot.mode);
            apiFormData.append('model', snapshot.model);
            apiFormData.append('prompt', snapshot.prompt);
            apiFormData.append('n', '1');
            apiFormData.append('size', snapshot.size);
            apiFormData.append('quality', snapshot.quality);
            apiFormData.append('output_format', snapshot.output_format);
            if (snapshot.output_compression !== undefined) {
                apiFormData.append('output_compression', snapshot.output_compression.toString());
            }
            apiFormData.append('background', snapshot.background);
            apiFormData.append('moderation', snapshot.moderation);

            if (snapshot.mode === 'edit') {
                snapshot.referenceImages.forEach((reference, index) => {
                    apiFormData.append(`image_${index}`, reference.file, reference.name);
                });
                if (snapshot.mask) {
                    apiFormData.append('mask', snapshot.mask.file, snapshot.mask.name);
                }
            }

            const response = await fetch('/api/images', {
                method: 'POST',
                body: apiFormData
            });

            const responseText = await response.text();
            let result: ImageApiResponse;
            try {
                result = JSON.parse(responseText) as ImageApiResponse;
            } catch {
                throw new Error(`服务端返回了非 JSON 响应（HTTP ${response.status}）。`);
            }

            if (!response.ok) {
                if (response.status === 401 && isPasswordRequiredByBackend) {
                    setError('Unauthorized: Invalid or missing password. Please try again.');
                    setPasswordDialogContext('retry');
                    setIsPasswordDialogOpen(true);
                    return;
                }
                throw new Error(result.error || `API request failed with status ${response.status}`);
            }

            if (!result.images || result.images.length === 0) {
                setLatestImageBatch(null);
                throw new Error('API response did not contain valid image data or filenames.');
            }

            durationMs = Date.now() - startTime;
            await processApiImages(result.images, result.usage, durationMs, snapshot, {
                requestId: result.request_id,
                openaiRequestId: result.openai_request_id,
                metadataFile: result.metadata_file,
                metadataError: result.metadata_error,
                mock: result.mock,
                warnings: Array.isArray(result.warnings) ? result.warnings : []
            });
        } catch (err: unknown) {
            durationMs = Date.now() - startTime;
            console.error(`API Call Error after ${durationMs}ms:`, err);
            const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
            setError(errorMessage);
            setLatestImageBatch(null);
        } finally {
            if (durationMs === 0) durationMs = Date.now() - startTime;
            inFlightRef.current = false;
            setIsLoading(false);
            setGenerationStartTime(null);
        }
    };

    const handleHistorySelect = React.useCallback(
        (item: HistoryMetadata) => {
            const originalStorageMode = item.storageModeUsed || 'fs';

            const selectedBatchPromises = item.images.map(async (imgInfo) => {
                let path: string | undefined;
                if (originalStorageMode === 'indexeddb') {
                    path = getImageSrc(imgInfo.filename);
                } else {
                    path = `/api/image/${imgInfo.filename}`;
                }

                if (path) {
                    return { path, filename: imgInfo.filename };
                } else {
                    console.warn(
                        `Could not get image source for history item: ${imgInfo.filename} (mode: ${originalStorageMode})`
                    );
                    setError(`Image ${imgInfo.filename} could not be loaded.`);
                    return null;
                }
            });

            Promise.all(selectedBatchPromises).then((resolvedBatch) => {
                const validImages = resolvedBatch.filter(Boolean) as { path: string; filename: string }[];

                if (validImages.length !== item.images.length) {
                    setError(
                        'Some images from this history entry could not be loaded (they might have been cleared or are missing).'
                    );
                } else {
                    setError(null);
                }

                setLatestImageBatch(validImages.length > 0 ? validImages : null);
                setImageOutputView(validImages.length > 1 ? 'grid' : 0);
                setLatestOutputIsTransparent(
                    item.background === 'transparent' && (item.output_format ?? 'png') === 'png'
                );
            });
        },
        [getImageSrc]
    );

    const handleClearHistory = React.useCallback(async () => {
        const confirmationMessage =
            effectiveStorageModeClient === 'indexeddb'
                ? 'Are you sure you want to clear the entire image history? In IndexedDB mode, this will also permanently delete all stored images. This cannot be undone.'
                : 'Are you sure you want to clear the entire image history? This cannot be undone.';

        if (window.confirm(confirmationMessage)) {
            setHistory([]);
            setLatestImageBatch(null);
            setImageOutputView('grid');
            setError(null);

            try {
                localStorage.removeItem('openaiImageHistory');

                if (effectiveStorageModeClient === 'indexeddb') {
                    await db.images.clear();
                    blobUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
                    blobUrlCacheRef.current.clear();
                }
            } catch (e) {
                console.error('Failed during history clearing:', e);
                setError(`Failed to clear history: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }, []);

    const handleSendToEdit = async (filename: string) => {
        if (isSendingToEdit) return;
        setIsSendingToEdit(true);
        setError(null);

        const alreadyExists = editImageFiles.some((file) => file.name === filename);
        if (mode === 'edit' && alreadyExists) {
            setIsSendingToEdit(false);
            return;
        }

        if (mode === 'edit' && editImageFiles.length >= MAX_EDIT_IMAGES) {
            setError(`Cannot add more than ${MAX_EDIT_IMAGES} images to the edit form.`);
            setIsSendingToEdit(false);
            return;
        }

        try {
            let blob: Blob | undefined;
            let mimeType: string = 'image/png';

            if (effectiveStorageModeClient === 'indexeddb') {
                const record = allDbImages?.find((img) => img.filename === filename);
                if (record?.blob) {
                    blob = record.blob;
                    mimeType = blob.type || mimeType;
                } else {
                    throw new Error(`Image ${filename} not found in local database.`);
                }
            } else {
                const response = await fetch(`/api/image/${filename}`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch image: ${response.statusText}`);
                }
                blob = await response.blob();
                mimeType = response.headers.get('Content-Type') || mimeType;
            }

            if (!blob) {
                throw new Error(`Could not retrieve image data for ${filename}.`);
            }

            const newFile = new File([blob], filename, { type: mimeType });
            const newPreviewUrl = URL.createObjectURL(blob);

            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));

            setEditImageFiles([newFile]);
            setEditSourceImagePreviewUrls([newPreviewUrl]);

            if (mode === 'generate') {
                setMode('edit');
            }
        } catch (err: unknown) {
            console.error('Error sending image to edit:', err);
            const errorMessage = err instanceof Error ? err.message : 'Failed to send image to edit form.';
            setError(errorMessage);
        } finally {
            setIsSendingToEdit(false);
        }
    };

    const executeDeleteItem = React.useCallback(
        async (item: HistoryMetadata) => {
            if (!item) return;
            setError(null);

            const { images: imagesInEntry, storageModeUsed, timestamp } = item;
            const filenamesToDelete = imagesInEntry.map((img) => img.filename);

            try {
                if (storageModeUsed === 'indexeddb') {
                    await db.images.where('filename').anyOf(filenamesToDelete).delete();
                    filenamesToDelete.forEach((fn) => {
                        const url = blobUrlCacheRef.current.get(fn);
                        if (url) URL.revokeObjectURL(url);
                        blobUrlCacheRef.current.delete(fn);
                    });
                } else if (storageModeUsed === 'fs') {
                    const apiPayload: { filenames: string[]; passwordHash?: string } = {
                        filenames: filenamesToDelete
                    };
                    if (isPasswordRequiredByBackend && clientPasswordHash) {
                        apiPayload.passwordHash = clientPasswordHash;
                    }

                    const response = await fetch('/api/image-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(apiPayload)
                    });

                    const result = await response.json();
                    if (!response.ok) {
                        throw new Error(result.error || `API deletion failed with status ${response.status}`);
                    }
                }

                setHistory((prevHistory) => prevHistory.filter((h) => h.timestamp !== timestamp));
                setLatestImageBatch((prev) =>
                    prev && prev.some((img) => filenamesToDelete.includes(img.filename)) ? null : prev
                );
            } catch (e: unknown) {
                console.error('Error during item deletion:', e);
                setError(e instanceof Error ? e.message : 'An unexpected error occurred during deletion.');
            } finally {
                setItemToDeleteConfirm(null);
            }
        },
        [isPasswordRequiredByBackend, clientPasswordHash]
    );

    const handleRequestDeleteItem = React.useCallback(
        (item: HistoryMetadata) => {
            if (!skipDeleteConfirmation) {
                setDialogCheckboxStateSkipConfirm(skipDeleteConfirmation);
                setItemToDeleteConfirm(item);
            } else {
                executeDeleteItem(item);
            }
        },
        [skipDeleteConfirmation, executeDeleteItem]
    );

    const handleConfirmDeletion = React.useCallback(() => {
        if (itemToDeleteConfirm) {
            executeDeleteItem(itemToDeleteConfirm);
            setSkipDeleteConfirmation(dialogCheckboxStateSkipConfirm);
        }
    }, [itemToDeleteConfirm, executeDeleteItem, dialogCheckboxStateSkipConfirm]);

    const handleCancelDeletion = React.useCallback(() => {
        setItemToDeleteConfirm(null);
    }, []);

    return (
        <main className='flex min-h-screen flex-col items-center bg-black p-4 text-white md:p-8 lg:p-12'>
            <PasswordDialog
                isOpen={isPasswordDialogOpen}
                onOpenChange={setIsPasswordDialogOpen}
                onSave={handleSavePassword}
                title={passwordDialogContext === 'retry' ? 'Password Required' : 'Configure Password'}
                description={
                    passwordDialogContext === 'retry'
                        ? 'The server requires a password, or the previous one was incorrect. Please enter it to continue.'
                        : 'Set a password to use for API requests.'
                }
            />
            <RequestConfirmationDialog
                request={pendingRequest}
                isSubmitting={isLoading}
                onCancel={handleCancelRequest}
                onConfirm={handleConfirmRequest}
            />
            <div className='w-full max-w-screen-2xl space-y-6'>
                {imageApiStatus && !imageApiStatus.enabled && (
                    <Alert
                        data-testid='api-status-banner'
                        className='border-yellow-500/50 bg-yellow-900/20 text-yellow-200'>
                        <AlertTitle className='text-yellow-100'>生成服务未启用（ENABLE_IMAGE_API=false）</AlertTitle>
                        <AlertDescription className='text-yellow-200/80'>
                            页面仍可调整参数和检查本地配置，但提交会被服务端在接触 OpenAI SDK 之前拒绝。请在
                            .env.local 中设置 ENABLE_IMAGE_API=true 并重启服务。
                        </AlertDescription>
                    </Alert>
                )}
                {imageApiStatus?.enabled && !imageApiStatus.apiKeyConfigured && !imageApiStatus.mock && (
                    <Alert data-testid='api-status-banner' className='border-red-500/50 bg-red-900/20 text-red-200'>
                        <AlertTitle className='text-red-100'>未配置 OPENAI_API_KEY</AlertTitle>
                        <AlertDescription className='text-red-200/80'>
                            服务端开关已启用，但仍缺少 Key。请在 .env.local 中填写 OPENAI_API_KEY 后重启；浏览器不会接触该
                            Key。
                        </AlertDescription>
                    </Alert>
                )}
                {imageApiStatus?.mock && (
                    <Alert
                        data-testid='mock-status-banner'
                        className='border-purple-500/50 bg-purple-900/20 text-purple-200'>
                        <AlertTitle className='text-purple-100'>MOCK 测试模式</AlertTitle>
                        <AlertDescription className='text-purple-200/80'>
                            当前结果来自固定 fixture，不会调用真实 OpenAI，也不代表真实费用、模型权限或生成质量。
                        </AlertDescription>
                    </Alert>
                )}
                <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
                    <div className='relative flex h-[70vh] min-h-[600px] flex-col lg:col-span-1'>
                        <div className={mode === 'generate' ? 'block h-full w-full' : 'hidden'}>
                            <GenerationForm
                                onSubmit={handleRequestSubmit}
                                isLoading={isLoading}
                                currentMode={mode}
                                onModeChange={setMode}
                                isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                clientPasswordHash={clientPasswordHash}
                                onOpenPasswordDialog={handleOpenPasswordDialog}
                                model={genModel}
                                setModel={setGenModel}
                                prompt={genPrompt}
                                setPrompt={setGenPrompt}
                                size={genSize}
                                setSize={setGenSize}
                                customWidth={genCustomWidth}
                                setCustomWidth={setGenCustomWidth}
                                customHeight={genCustomHeight}
                                setCustomHeight={setGenCustomHeight}
                                quality={genQuality}
                                setQuality={setGenQuality}
                                outputFormat={genOutputFormat}
                                setOutputFormat={setGenOutputFormat}
                                compression={genCompression}
                                setCompression={setGenCompression}
                                background={genBackground}
                                setBackground={setGenBackground}
                                moderation={genModeration}
                                setModeration={setGenModeration}
                            />
                        </div>
                        <div className={mode === 'edit' ? 'block h-full w-full' : 'hidden'}>
                            <EditingForm
                                onSubmit={handleRequestSubmit}
                                isLoading={isLoading || isSendingToEdit}
                                currentMode={mode}
                                onModeChange={setMode}
                                isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                clientPasswordHash={clientPasswordHash}
                                onOpenPasswordDialog={handleOpenPasswordDialog}
                                editModel={editModel}
                                setEditModel={setEditModel}
                                imageFiles={editImageFiles}
                                sourceImagePreviewUrls={editSourceImagePreviewUrls}
                                setImageFiles={setEditImageFiles}
                                setSourceImagePreviewUrls={setEditSourceImagePreviewUrls}
                                maxImages={MAX_EDIT_IMAGES}
                                editPrompt={editPrompt}
                                setEditPrompt={setEditPrompt}
                                editSize={editSize}
                                setEditSize={setEditSize}
                                editCustomWidth={editCustomWidth}
                                setEditCustomWidth={setEditCustomWidth}
                                editCustomHeight={editCustomHeight}
                                setEditCustomHeight={setEditCustomHeight}
                                editQuality={editQuality}
                                setEditQuality={setEditQuality}
                                editOutputFormat={editOutputFormat}
                                setEditOutputFormat={setEditOutputFormat}
                                editCompression={editCompression}
                                setEditCompression={setEditCompression}
                                editBackground={editBackground}
                                setEditBackground={setEditBackground}
                                editModeration={editModeration}
                                setEditModeration={setEditModeration}
                                editBrushSize={editBrushSize}
                                setEditBrushSize={setEditBrushSize}
                                editShowMaskEditor={editShowMaskEditor}
                                setEditShowMaskEditor={setEditShowMaskEditor}
                                editGeneratedMaskFile={editGeneratedMaskFile}
                                setEditGeneratedMaskFile={setEditGeneratedMaskFile}
                                editIsMaskSaved={editIsMaskSaved}
                                setEditIsMaskSaved={setEditIsMaskSaved}
                                editOriginalImageSize={editOriginalImageSize}
                                setEditOriginalImageSize={setEditOriginalImageSize}
                                editDrawnPoints={editDrawnPoints}
                                setEditDrawnPoints={setEditDrawnPoints}
                                editMaskPreviewUrl={editMaskPreviewUrl}
                                setEditMaskPreviewUrl={setEditMaskPreviewUrl}
                            />
                        </div>
                    </div>
                    <div className='flex h-[70vh] min-h-[600px] flex-col lg:col-span-1'>
                        {error && (
                            <Alert variant='destructive' className='mb-4 border-red-500/50 bg-red-900/20 text-red-300'>
                                <AlertTitle className='text-red-200'>Error</AlertTitle>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                        {warning && (
                            <Alert className='mb-4 border-yellow-500/50 bg-yellow-900/20 text-yellow-200'>
                                <AlertTitle className='text-yellow-100'>注意</AlertTitle>
                                <AlertDescription>{warning}</AlertDescription>
                            </Alert>
                        )}
                        <ImageOutput
                            imageBatch={latestImageBatch}
                            viewMode={imageOutputView}
                            onViewChange={setImageOutputView}
                            altText='Generated image output'
                            isLoading={isLoading || isSendingToEdit}
                            loadingStartTime={generationStartTime}
                            onSendToEdit={handleSendToEdit}
                            currentMode={mode}
                            baseImagePreviewUrl={editSourceImagePreviewUrls[0] || null}
                            transparentPreview={latestOutputIsTransparent}
                        />
                    </div>
                </div>

                <div className='min-h-[450px]'>
                    <HistoryPanel
                        history={history}
                        onSelectImage={handleHistorySelect}
                        onClearHistory={handleClearHistory}
                        getImageSrc={getImageSrc}
                        onDeleteItemRequest={handleRequestDeleteItem}
                        itemPendingDeleteConfirmation={itemToDeleteConfirm}
                        onConfirmDeletion={handleConfirmDeletion}
                        onCancelDeletion={handleCancelDeletion}
                        deletePreferenceDialogValue={dialogCheckboxStateSkipConfirm}
                        onDeletePreferenceDialogChange={setDialogCheckboxStateSkipConfirm}
                    />
                </div>
            </div>
        </main>
    );
}
