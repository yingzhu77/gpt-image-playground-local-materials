'use client';

import { ImageOptions } from '@/components/image-options';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
    GPT_IMAGE_MODELS,
    type GptImageModel,
    type ImageBackground,
    type ImageModeration,
    type ImageOutputFormat,
    type ImageQuality
} from '@/lib/models';
import { validateCustomSize, type SizePreset } from '@/lib/size-utils';
import { Loader2, Lock, LockOpen } from 'lucide-react';
import * as React from 'react';

export type GenerationFormData = {
    prompt: string;
    n: number;
    size: SizePreset;
    customWidth: number;
    customHeight: number;
    quality: ImageQuality;
    output_format: ImageOutputFormat;
    output_compression?: number;
    background: ImageBackground;
    moderation: ImageModeration;
    model: GptImageModel;
};

type GenerationFormProps = {
    onSubmit: (data: GenerationFormData) => void;
    isLoading: boolean;
    currentMode: 'generate' | 'edit';
    onModeChange: (mode: 'generate' | 'edit') => void;
    isPasswordRequiredByBackend: boolean | null;
    clientPasswordHash: string | null;
    onOpenPasswordDialog: () => void;
    model: GenerationFormData['model'];
    setModel: React.Dispatch<React.SetStateAction<GenerationFormData['model']>>;
    prompt: string;
    setPrompt: React.Dispatch<React.SetStateAction<string>>;
    size: GenerationFormData['size'];
    setSize: React.Dispatch<React.SetStateAction<GenerationFormData['size']>>;
    customWidth: number;
    setCustomWidth: React.Dispatch<React.SetStateAction<number>>;
    customHeight: number;
    setCustomHeight: React.Dispatch<React.SetStateAction<number>>;
    quality: GenerationFormData['quality'];
    setQuality: React.Dispatch<React.SetStateAction<GenerationFormData['quality']>>;
    outputFormat: GenerationFormData['output_format'];
    setOutputFormat: React.Dispatch<React.SetStateAction<GenerationFormData['output_format']>>;
    compression: number[];
    setCompression: React.Dispatch<React.SetStateAction<number[]>>;
    background: GenerationFormData['background'];
    setBackground: React.Dispatch<React.SetStateAction<GenerationFormData['background']>>;
    moderation: GenerationFormData['moderation'];
    setModeration: React.Dispatch<React.SetStateAction<GenerationFormData['moderation']>>;
};

export function GenerationForm({
    onSubmit,
    isLoading,
    currentMode,
    onModeChange,
    isPasswordRequiredByBackend,
    clientPasswordHash,
    onOpenPasswordDialog,
    model,
    setModel,
    prompt,
    setPrompt,
    size,
    setSize,
    customWidth,
    setCustomWidth,
    customHeight,
    setCustomHeight,
    quality,
    setQuality,
    outputFormat,
    setOutputFormat,
    compression,
    setCompression,
    background,
    setBackground,
    moderation,
    setModeration
}: GenerationFormProps) {
    const showCompression = outputFormat === 'jpeg' || outputFormat === 'webp';
    const customSizeValidation =
        size === 'custom' ? validateCustomSize(customWidth, customHeight) : { valid: true as const };
    const customSizeInvalid = !customSizeValidation.valid;

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (customSizeInvalid) {
            return;
        }
        const formData: GenerationFormData = {
            prompt,
            n: 1,
            size,
            customWidth,
            customHeight,
            quality,
            output_format: outputFormat,
            background,
            moderation,
            model
        };
        if (showCompression) {
            formData.output_compression = compression[0];
        }
        onSubmit(formData);
    };

    return (
        <Card className='flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black'>
            <CardHeader className='flex items-start justify-between border-b border-white/10 pb-4'>
                <div>
                    <div className='flex items-center'>
                        <CardTitle className='py-1 text-lg font-medium text-white'>Generate Image</CardTitle>
                        {isPasswordRequiredByBackend && (
                            <Button
                                variant='ghost'
                                size='icon'
                                onClick={onOpenPasswordDialog}
                                className='ml-2 text-white/60 hover:text-white'
                                aria-label='Configure Password'>
                                {clientPasswordHash ? <Lock className='h-4 w-4' /> : <LockOpen className='h-4 w-4' />}
                            </Button>
                        )}
                    </div>
                    <CardDescription className='mt-1 text-white/60'>
                        Create a new image from a text prompt.
                    </CardDescription>
                </div>
                <ModeToggle currentMode={currentMode} onModeChange={onModeChange} />
            </CardHeader>
            <form onSubmit={handleSubmit} className='flex h-full flex-1 flex-col overflow-hidden'>
                <CardContent className='flex-1 space-y-5 overflow-y-auto p-4'>
                    <div className='space-y-1.5'>
                        <Label htmlFor='model-select' className='text-white'>
                            Model
                        </Label>
                        <Select
                            value={model}
                            onValueChange={(value) => setModel(value as GptImageModel)}
                            disabled={isLoading}>
                            <SelectTrigger
                                id='model-select'
                                className='w-[220px] rounded-md border border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'>
                                <SelectValue placeholder='Select model' />
                            </SelectTrigger>
                            <SelectContent className='border-white/20 bg-black text-white'>
                                {GPT_IMAGE_MODELS.map((id) => (
                                    <SelectItem key={id} value={id} className='focus:bg-white/10'>
                                        {id}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className='text-xs text-white/50'>流式预览本轮关闭；点击生成后先确认参数，不会直接请求 API。</p>
                    </div>

                    <div className='space-y-1.5'>
                        <Label htmlFor='prompt' className='text-white'>
                            Prompt
                        </Label>
                        <Textarea
                            id='prompt'
                            placeholder='e.g., A photorealistic cat astronaut floating in space'
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            required
                            disabled={isLoading}
                            className='min-h-[80px] rounded-md border border-white/20 bg-black text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/50'
                        />
                    </div>

                    <p className='text-sm text-white/60'>张数：1（本轮固定单张）</p>

                    <ImageOptions
                        idPrefix='gen'
                        model={model}
                        disabled={isLoading}
                        size={size}
                        setSize={setSize}
                        customWidth={customWidth}
                        setCustomWidth={setCustomWidth}
                        customHeight={customHeight}
                        setCustomHeight={setCustomHeight}
                        sizeValidation={customSizeValidation}
                        quality={quality}
                        setQuality={setQuality}
                        background={background}
                        setBackground={setBackground}
                        outputFormat={outputFormat}
                        setOutputFormat={setOutputFormat}
                        compression={compression}
                        setCompression={setCompression}
                        moderation={moderation}
                        setModeration={setModeration}
                    />
                </CardContent>
                <CardFooter className='border-t border-white/10 p-4'>
                    <Button
                        type='submit'
                        data-testid='generate-submit'
                        disabled={isLoading || !prompt || customSizeInvalid}
                        className='flex w-full items-center justify-center gap-2 rounded-md bg-white text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/40'>
                        {isLoading && <Loader2 className='h-4 w-4 animate-spin' />}
                        {isLoading ? '提交中...' : '生成图片（先确认）'}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}
