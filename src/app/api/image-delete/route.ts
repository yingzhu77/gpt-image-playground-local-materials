import { getOutputDir } from '@/lib/server/storage';
import crypto from 'crypto';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

type DeleteRequestBody = {
    filenames: string[];
    passwordHash?: string;
};

type FileDeletionResult = {
    filename: string;
    success: boolean;
    error?: string;
    code?: 'FILE_NOT_FOUND';
};

export async function POST(request: NextRequest) {
    console.log('Received POST request to /api/image-delete');

    let requestBody: DeleteRequestBody;
    try {
        requestBody = await request.json();
        if (!requestBody || typeof requestBody !== 'object') {
            return NextResponse.json({ error: 'Expected a JSON object.' }, { status: 400 });
        }

        if (process.env.APP_PASSWORD) {
            const clientPasswordHash = requestBody.passwordHash;

            if (!clientPasswordHash) {
                console.error('Missing password hash for delete operation.');
                return NextResponse.json({ error: 'Unauthorized: Missing password hash.' }, { status: 401 });
            }
            const serverPasswordHash = sha256(process.env.APP_PASSWORD);
            if (clientPasswordHash !== serverPasswordHash) {
                console.error('Invalid password hash for delete operation.');
                return NextResponse.json({ error: 'Unauthorized: Invalid password.' }, { status: 401 });
            }
        }
    } catch (e) {
        console.error('Error parsing request body for /api/image-delete:', e);
        return NextResponse.json({ error: 'Invalid request body: Must be JSON.' }, { status: 400 });
    }

    const { filenames } = requestBody;

    if (!Array.isArray(filenames) || filenames.some((fn) => typeof fn !== 'string')) {
        return NextResponse.json({ error: 'Invalid filenames: Must be an array of strings.' }, { status: 400 });
    }

    if (filenames.length === 0) {
        return NextResponse.json({ message: 'No filenames provided to delete.', results: [] }, { status: 200 });
    }

    const deletionResults: FileDeletionResult[] = [];

    for (const filename of filenames) {
        if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            console.warn(`Invalid filename for deletion: ${filename}`);
            deletionResults.push({ filename, success: false, error: 'Invalid filename format.' });
            continue;
        }

        const filepath = path.join(/*turbopackIgnore: true*/ getOutputDir(), filename);

        try {
            await fs.unlink(filepath);
            console.log(`Successfully deleted image: ${filepath}`);
            deletionResults.push({ filename, success: true });
        } catch (error: unknown) {
            console.error(`Error deleting image ${filepath}:`, error);
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
                deletionResults.push({ filename, success: false, code: 'FILE_NOT_FOUND', error: 'File not found.' });
            } else {
                deletionResults.push({ filename, success: false, error: 'Failed to delete file.' });
            }
        }
    }

    const allSucceeded = deletionResults.every((r) => r.success);

    return NextResponse.json(
        {
            message: allSucceeded ? 'All files deleted successfully.' : 'Some files could not be deleted.',
            results: deletionResults
        },
        { status: allSucceeded ? 200 : 207 } // 207 Multi-Status if some failed
    );
}
