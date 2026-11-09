import {
    assertSameOrigin,
    errorResponse,
    requireLoopbackHost,
    verifyAppPassword,
    workbenchJson
} from '@/lib/workbench/http';
import { getLimits } from '@/lib/workbench/config';
import { getProjectDetail, uploadAsset, WorkbenchError } from '@/lib/workbench/service';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        requireLoopbackHost(request);
        assertSameOrigin(request);
        verifyAppPassword(request);
        const { id } = await params;
        const limits = getLimits();
        const contentLength = Number(request.headers.get('content-length') ?? '0');
        if (Number.isFinite(contentLength) && contentLength > limits.maxUploadBytes + 2 * 1024 * 1024) {
            throw new WorkbenchError(413, 'FILE_TOO_LARGE', `文件超过 ${limits.maxUploadBytes} 字节限制。`);
        }
        let formData: FormData;
        try {
            formData = await request.formData();
        } catch {
            throw new WorkbenchError(400, 'INVALID_FORM_DATA', '上传请求不是有效的表单数据。');
        }
        const file = formData.get('file');
        if (!(file instanceof File)) {
            throw new WorkbenchError(400, 'FILE_REQUIRED', '请选择要上传的图片文件。');
        }
        if (file.size > limits.maxUploadBytes) {
            throw new WorkbenchError(413, 'FILE_TOO_LARGE', `文件超过 ${limits.maxUploadBytes} 字节限制。`);
        }
        const asset = await uploadAsset({
            projectId: id,
            bytes: Buffer.from(await file.arrayBuffer()),
            originalName: file.name || 'upload',
            declaredMime: file.type
        });
        return workbenchJson({ ok: true, asset, project: getProjectDetail(id) });
    } catch (error) {
        return errorResponse(error);
    }
}
