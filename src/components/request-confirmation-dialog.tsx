'use client';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { RequestSnapshot } from '@/lib/request-types';
import { Loader2 } from 'lucide-react';

type RequestConfirmationDialogProps = {
    request: RequestSnapshot | null;
    isSubmitting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
};

const BACKGROUND_LABELS: Record<RequestSnapshot['background'], string> = {
    auto: '自动',
    opaque: '不透明',
    transparent: '透明'
};

const MODE_LABELS: Record<RequestSnapshot['mode'], string> = {
    generate: '生成',
    edit: '编辑'
};

export function RequestConfirmationDialog({
    request,
    isSubmitting,
    onCancel,
    onConfirm
}: RequestConfirmationDialogProps) {
    return (
        <Dialog
            open={!!request}
            onOpenChange={(open) => {
                if (!open && !isSubmitting) onCancel();
            }}>
            <DialogContent
                data-testid='request-confirm-dialog'
                className='max-h-[85vh] overflow-y-auto border-neutral-700 bg-neutral-900 text-white sm:max-w-[640px]'>
                <DialogHeader>
                    <DialogTitle className='text-white'>生成前确认</DialogTitle>
                    <DialogDescription className='text-neutral-400'>
                        请核对本次请求的完整参数。只有点击“确认并提交”才会发送请求；取消不会调用 API。
                    </DialogDescription>
                </DialogHeader>

                {request && (
                    <div className='space-y-3 text-sm text-neutral-300'>
                        <div>
                            <p className='font-medium text-white'>完整提示词</p>
                            <div className='mt-1 max-h-[180px] overflow-y-auto rounded-md border border-neutral-700 bg-neutral-800 p-3 whitespace-pre-wrap'>
                                {request.prompt}
                            </div>
                        </div>

                        <dl className='grid grid-cols-2 gap-x-4 gap-y-2'>
                            <div>
                                <dt className='text-neutral-500'>模式</dt>
                                <dd>{MODE_LABELS[request.mode]}</dd>
                            </div>
                            <div>
                                <dt className='text-neutral-500'>模型</dt>
                                <dd>{request.model}</dd>
                            </div>
                            <div>
                                <dt className='text-neutral-500'>尺寸</dt>
                                <dd>{request.size}</dd>
                            </div>
                            <div>
                                <dt className='text-neutral-500'>质量</dt>
                                <dd>{request.quality}</dd>
                            </div>
                            <div>
                                <dt className='text-neutral-500'>张数</dt>
                                <dd>{request.n}</dd>
                            </div>
                            <div>
                                <dt className='text-neutral-500'>背景</dt>
                                <dd>{BACKGROUND_LABELS[request.background]}</dd>
                            </div>
                            <div>
                                <dt className='text-neutral-500'>输出格式</dt>
                                <dd>{request.output_format.toUpperCase()}</dd>
                            </div>
                            <div>
                                <dt className='text-neutral-500'>审核档位</dt>
                                <dd>{request.moderation}</dd>
                            </div>
                            {request.mode === 'generate' && (
                                <div>
                                    <dt className='text-neutral-500'>原生尺寸说明</dt>
                                    <dd>按请求尺寸直接生成，不放大</dd>
                                </div>
                            )}
                        </dl>

                        {request.mode === 'edit' && (
                            <div className='space-y-2 rounded-md border border-neutral-700 bg-neutral-800 p-3'>
                                <p>
                                    <span className='text-neutral-500'>参考图数量：</span>
                                    {request.referenceImages.length}
                                </p>
                                {request.referenceImages.length > 0 && (
                                    <ol className='list-decimal space-y-1 pl-5'>
                                        {request.referenceImages.map((image, index) => (
                                            <li key={`${image.name}-${index}`}>{image.name}</li>
                                        ))}
                                    </ol>
                                )}
                                <p>
                                    <span className='text-neutral-500'>遮罩：</span>
                                    {request.mask ? `有（${request.mask.name}）` : '无'}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className='gap-2 sm:justify-end'>
                    <Button
                        type='button'
                        variant='outline'
                        data-testid='request-confirm-cancel'
                        disabled={isSubmitting}
                        onClick={onCancel}
                        className='border-neutral-600 text-neutral-300 hover:bg-neutral-700 hover:text-white'>
                        取消
                    </Button>
                    <Button
                        type='button'
                        data-testid='request-confirm-submit'
                        disabled={isSubmitting}
                        onClick={onConfirm}
                        className='bg-white text-black hover:bg-white/90'>
                        {isSubmitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                        {isSubmitting ? '提交中...' : '确认并提交'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
