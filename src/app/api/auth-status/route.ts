import { getImageApiConfiguration } from '@/lib/server/image-api';
import { NextResponse } from 'next/server';

export async function GET() {
    const appPasswordSet = !!process.env.APP_PASSWORD;
    const imageApi = getImageApiConfiguration();
    return NextResponse.json({
        passwordRequired: appPasswordSet,
        imageApiEnabled: imageApi.enabled,
        apiKeyConfigured: imageApi.apiKeyConfigured,
        imageApiMock: imageApi.mock
    });
}
