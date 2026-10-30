'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

type ApiKeyDialogProps = {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    onConfigured: (result: { persisted: boolean; warning: string | null }) => void | Promise<void>;
};

export function ApiKeyDialog({ isOpen, onOpenChange, onConfigured }: ApiKeyDialogProps) {
    const [apiKey, setApiKey] = React.useState('');
    const [persist, setPersist] = React.useState(true);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const inputId = React.useId();

    const handleDialogOpenChange = (open: boolean) => {
        if (!open) {
            if (isSubmitting) return;
            setApiKey('');
            setPersist(true);
            setError(null);
        }
        onOpenChange(open);
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isSubmitting) return;

        const trimmedKey = apiKey.trim();
        if (!trimmedKey) {
            setError('请输入 API Key。');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const response = await fetch('/api/local-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Local-Setup': '1'
                },
                body: JSON.stringify({ apiKey: trimmedKey, persist, enable: true }),
                cache: 'no-store'
            });

            const responseText = await response.text();
            let result: { ok?: boolean; persisted?: boolean; warning?: string; error?: string };
            try {
                result = JSON.parse(responseText) as typeof result;
            } catch {
                throw new Error(`服务端返回了非 JSON 响应（HTTP ${response.status}）。`);
            }

            if (!response.ok) {
                throw new Error(result.error || `配置失败（HTTP ${response.status}）。`);
            }

            setApiKey('');
            setPersist(true);
            setError(null);
            await onConfigured({
                persisted: result.persisted === true,
                warning: typeof result.warning === 'string' ? result.warning : null
            });
            onOpenChange(false);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '配置失败，请稍后重试。');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
            <DialogContent
                data-testid='api-key-dialog'
                className='max-h-[85vh] overflow-y-auto border-neutral-700 bg-neutral-900 text-white sm:max-w-[520px]'>
                <DialogHeader>
                    <DialogTitle className='text-white'>配置 API Key</DialogTitle>
                    <DialogDescription className='text-neutral-400'>
                        在此粘贴 OpenAI API Key 并启用真实生成。保存后不会自动调用 OpenAI。
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className='space-y-4'>
                    <div className='space-y-2'>
                        <Label htmlFor={inputId} className='text-neutral-200'>
                            OpenAI API Key
                        </Label>
                        <Input
                            id={inputId}
                            data-testid='api-key-input'
                            type='password'
                            autoComplete='off'
                            autoCapitalize='off'
                            autoCorrect='off'
                            spellCheck={false}
                            placeholder='粘贴 OpenAI API Key'
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            disabled={isSubmitting}
                            className='border-neutral-600 bg-neutral-950 text-white placeholder:text-neutral-500 focus-visible:border-neutral-400 focus-visible:ring-neutral-500/50'
                        />
                        <p className='text-xs text-neutral-400'>
                            Key 只发送给本机服务端（127.0.0.1），不会写入浏览器存储或前端 bundle。
                        </p>
                    </div>

                    <div className='flex items-start gap-3'>
                        <Checkbox
                            id='api-key-persist'
                            data-testid='api-key-persist'
                            checked={persist}
                            onCheckedChange={(checked) => setPersist(checked === true)}
                            disabled={isSubmitting}
                            className='mt-0.5 border-neutral-500'
                        />
                        <div className='space-y-1'>
                            <Label htmlFor='api-key-persist' className='cursor-pointer text-neutral-200'>
                                保存到本机 .env.local（下次启动继续使用）
                            </Label>
                            <p className='text-xs text-neutral-500'>不勾选时只在本次运行中生效，重启后需要重新配置。</p>
                        </div>
                    </div>

                    <Alert className='border-yellow-500/50 bg-yellow-900/20 text-yellow-200'>
                        <AlertTitle className='text-yellow-100'>会产生真实 API 费用</AlertTitle>
                        <AlertDescription className='text-yellow-200/80'>
                            保存并启用后，提交生成会调用 OpenAI 官方接口，并产生真实 API 费用。
                        </AlertDescription>
                    </Alert>

                    {error && (
                        <Alert
                            variant='destructive'
                            data-testid='api-key-error'
                            className='border-red-500/50 bg-red-900/20 text-red-300'>
                            <AlertTitle className='text-red-200'>配置失败</AlertTitle>
                            <AlertDescription className='text-red-300'>{error}</AlertDescription>
                        </Alert>
                    )}

                    <DialogFooter className='gap-2 sm:justify-end'>
                        <Button
                            type='button'
                            variant='outline'
                            data-testid='api-key-cancel'
                            disabled={isSubmitting}
                            onClick={() => handleDialogOpenChange(false)}
                            className='border-neutral-600 text-neutral-300 hover:bg-neutral-700 hover:text-white'>
                            取消
                        </Button>
                        <Button
                            type='submit'
                            data-testid='api-key-submit'
                            disabled={isSubmitting || !apiKey.trim()}
                            className='bg-white text-black hover:bg-white/90'>
                            {isSubmitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                            {isSubmitting ? '保存中...' : '保存并启用真实生成'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
