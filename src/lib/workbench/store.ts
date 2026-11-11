import { getAssetsDir, getCandidateDir, getDatabasePath, getWorkbenchDataDir } from '@/lib/workbench/config';
import type {
    AssetAnalysis,
    AssetMeta,
    DesignCard,
    DesignConflict,
    DesignFieldKey,
    DesignUpdateResult,
    ProjectSummary,
    PromptState,
    ReferenceBinding,
    ReferencePurpose,
    ReviewResult,
    RunAction,
    RunItemKind,
    RunItemRecord,
    RunItemStatus,
    RunSnapshot,
    RunStatus,
    RunSummary,
    SearchCandidate,
    SearchQueryKind,
    VersionRecord
} from '@/lib/workbench/types';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Row = Record<string, unknown>;

type StoreState = {
    db: DatabaseSync | null;
    bootId: string;
};

type StoreGlobal = typeof globalThis & { __workbenchStoreState?: StoreState };

const storeGlobal = globalThis as StoreGlobal;

function state(): StoreState {
    storeGlobal.__workbenchStoreState ??= { db: null, bootId: crypto.randomUUID() };
    return storeGlobal.__workbenchStoreState;
}

export function getBootId(): string {
    return state().bootId;
}

export function nowIso(): string {
    return new Date().toISOString();
}

export function newId(): string {
    return crypto.randomUUID();
}

function sqlite(): DatabaseSync {
    const current = state();
    if (current.db) return current.db;

    fs.mkdirSync(getWorkbenchDataDir(), { recursive: true });
    fs.mkdirSync(getAssetsDir(), { recursive: true });
    fs.mkdirSync(getCandidateDir(), { recursive: true });

    const db = new DatabaseSync(getDatabasePath());
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA foreign_keys = ON;');
    migrate(db);
    current.db = db;
    return db;
}

function migrate(db: DatabaseSync) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            entry TEXT NOT NULL,
            mock INTEGER NOT NULL DEFAULT 0,
            design_json TEXT NOT NULL,
            locked_json TEXT NOT NULL,
            design_version INTEGER NOT NULL DEFAULT 1,
            prompt_text TEXT NOT NULL DEFAULT '',
            prompt_avoid TEXT NOT NULL DEFAULT '',
            prompt_acceptance TEXT NOT NULL DEFAULT '',
            prompt_source TEXT NOT NULL DEFAULT 'compiled',
            prompt_design_version INTEGER NOT NULL DEFAULT 0,
            prompt_binding_hash TEXT NOT NULL DEFAULT '',
            prompt_stale INTEGER NOT NULL DEFAULT 0,
            prompt_updated_at TEXT NOT NULL,
            baseline_version_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS design_revisions (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            instruction TEXT,
            changes_json TEXT NOT NULL,
            conflicts_json TEXT NOT NULL,
            card_json TEXT NOT NULL,
            planner_model TEXT,
            reasoning_effort TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            sha256 TEXT NOT NULL UNIQUE,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime TEXT NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            bytes INTEGER NOT NULL,
            kind TEXT NOT NULL,
            source_page TEXT,
            source_url TEXT,
            acquired_at TEXT NOT NULL,
            project_id TEXT,
            mock INTEGER NOT NULL DEFAULT 0,
            analysis_json TEXT,
            analysis_key TEXT
        );
        CREATE TABLE IF NOT EXISTS project_assets (
            project_id TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            linked_at TEXT NOT NULL,
            PRIMARY KEY (project_id, asset_id)
        );
        CREATE TABLE IF NOT EXISTS reference_bindings (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            purpose TEXT NOT NULL,
            borrow TEXT NOT NULL DEFAULT '',
            exclude TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(project_id, asset_id)
        );
        CREATE TABLE IF NOT EXISTS search_candidates (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            query TEXT NOT NULL,
            query_kind TEXT NOT NULL,
            title TEXT NOT NULL,
            image_url TEXT NOT NULL,
            thumbnail_url TEXT,
            page_url TEXT NOT NULL,
            domain TEXT NOT NULL,
            trust_note TEXT NOT NULL,
            license_note TEXT NOT NULL,
            suggested_purpose TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            status TEXT NOT NULL,
            asset_id TEXT,
            error TEXT,
            mock INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            action TEXT NOT NULL,
            action_key TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            stop_requested INTEGER NOT NULL DEFAULT 0,
            snapshot_json TEXT NOT NULL,
            source_run_id TEXT,
            base_version_id TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            mock INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS run_items (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            planned_label TEXT,
            target_version_id TEXT,
            output_asset_id TEXT,
            version_id TEXT,
            request_id TEXT,
            openai_request_id TEXT,
            usage_json TEXT,
            estimated_cost_usd REAL,
            error_code TEXT,
            error_message TEXT,
            boot_id TEXT,
            started_at TEXT,
            finished_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(run_id, position)
        );
        CREATE TABLE IF NOT EXISTS versions (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            item_id TEXT,
            asset_id TEXT NOT NULL,
            parent_version_id TEXT,
            label TEXT NOT NULL,
            is_baseline INTEGER NOT NULL DEFAULT 0,
            review_json TEXT,
            review_status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            mock INTEGER NOT NULL DEFAULT 0,
            UNIQUE(project_id, label)
        );
        CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_items_run ON run_items(run_id, position);
        CREATE INDEX IF NOT EXISTS idx_items_status ON run_items(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_bindings_project ON reference_bindings(project_id, position);
        CREATE INDEX IF NOT EXISTS idx_candidates_project ON search_candidates(project_id, created_at);
    `);
    ensureColumn(db, 'design_revisions', 'planner_model', 'TEXT');
    ensureColumn(db, 'design_revisions', 'reasoning_effort', 'TEXT');
}

function ensureColumn(db: DatabaseSync, table: string, column: string, type: string) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!rows.some((row) => text(row, 'name') === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
}

export function recoverAllSendingOnWorkerStart(): number {
    return tx((db) => {
        const rows = db.prepare(`SELECT id, run_id FROM run_items WHERE status = 'sending'`).all() as Row[];
        if (rows.length === 0) return 0;
        const now = nowIso();
        db.prepare(
            `UPDATE run_items SET status = 'unknown', error_code = 'WORKER_RESTART_UNKNOWN',
                error_message = 'worker 重启时该请求处于已发送处理中，结果未知；未自动重发。',
                finished_at = ?, updated_at = ?
             WHERE status = 'sending'`
        ).run(now, now);
        for (const row of [...new Set(rows.map((entry) => text(entry, 'run_id')))]) {
            db.prepare(
                `UPDATE runs SET status = 'paused_unknown', error_code = 'WORKER_RESTART_UNKNOWN',
                    error_message = 'worker 重启前有已发送请求结果未知；请先核实，系统不会自动重发。如自行重新提交，可能重复收费。',
                    updated_at = ?
                 WHERE id = ? AND status IN ('queued', 'running')`
            ).run(now, row);
        }
        return rows.length;
    });
}

function tx<T>(fn: (db: DatabaseSync) => T): T {
    const db = sqlite();
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = fn(db);
        db.exec('COMMIT');
        return result;
    } catch (error) {
        try {
            db.exec('ROLLBACK');
        } catch {
            // Ignore rollback failures.
        }
        throw error;
    }
}

function text(row: Row, key: string): string {
    const value = row[key];
    return value === null || value === undefined ? '' : String(value);
}

function nullableText(row: Row, key: string): string | null {
    const value = row[key];
    return value === null || value === undefined ? null : String(value);
}

function num(row: Row, key: string): number {
    return Number(row[key] ?? 0);
}

function bool(row: Row, key: string): boolean {
    return Number(row[key] ?? 0) === 1;
}

function parseJson<T>(raw: unknown, fallback: T): T {
    if (typeof raw !== 'string' || !raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

export type StoredProject = {
    project: ProjectSummary;
    design: DesignCard;
    lockedFields: DesignFieldKey[];
    prompt: PromptState;
    references: ReferenceBinding[];
    assets: AssetMeta[];
    candidates: SearchCandidate[];
    runs: RunSummary[];
    versions: VersionRecord[];
};

const PROJECT_SELECT = 'SELECT * FROM projects WHERE id = ?';

function mapAsset(row: Row): AssetMeta {
    return {
        id: text(row, 'id'),
        sha256: text(row, 'sha256'),
        filename: text(row, 'filename'),
        originalName: text(row, 'original_name'),
        mime: text(row, 'mime'),
        width: num(row, 'width'),
        height: num(row, 'height'),
        bytes: num(row, 'bytes'),
        kind: text(row, 'kind') as AssetMeta['kind'],
        sourcePage: nullableText(row, 'source_page'),
        sourceUrl: nullableText(row, 'source_url'),
        acquiredAt: text(row, 'acquired_at'),
        projectId: nullableText(row, 'project_id'),
        mock: bool(row, 'mock'),
        analysis: parseJson<AssetAnalysis | null>(row.analysis_json, null)
    };
}

function mapCandidate(row: Row): SearchCandidate {
    return {
        id: text(row, 'id'),
        projectId: text(row, 'project_id'),
        query: text(row, 'query'),
        queryKind: text(row, 'query_kind') as SearchQueryKind,
        title: text(row, 'title'),
        imageUrl: text(row, 'image_url'),
        thumbnailUrl: nullableText(row, 'thumbnail_url'),
        pageUrl: text(row, 'page_url'),
        domain: text(row, 'domain'),
        trustNote: text(row, 'trust_note'),
        licenseNote: text(row, 'license_note'),
        suggestedPurpose: text(row, 'suggested_purpose') as ReferencePurpose,
        width: row.width === null || row.width === undefined ? null : num(row, 'width'),
        height: row.height === null || row.height === undefined ? null : num(row, 'height'),
        status: text(row, 'status') as SearchCandidate['status'],
        assetId: nullableText(row, 'asset_id'),
        error: nullableText(row, 'error'),
        mock: bool(row, 'mock'),
        createdAt: text(row, 'created_at')
    };
}

function mapVersion(row: Row, asset: AssetMeta, runAction: RunAction): VersionRecord {
    return {
        id: text(row, 'id'),
        projectId: text(row, 'project_id'),
        runId: text(row, 'run_id'),
        assetId: text(row, 'asset_id'),
        parentVersionId: nullableText(row, 'parent_version_id'),
        label: text(row, 'label'),
        isBaseline: bool(row, 'is_baseline'),
        review: parseJson<ReviewResult | null>(row.review_json, null),
        reviewStatus: text(row, 'review_status') as VersionRecord['reviewStatus'],
        createdAt: text(row, 'created_at'),
        mock: bool(row, 'mock'),
        asset,
        runAction
    };
}

function mapItem(row: Row): RunItemRecord {
    return {
        id: text(row, 'id'),
        runId: text(row, 'run_id'),
        position: num(row, 'position'),
        kind: text(row, 'kind') as RunItemKind,
        status: text(row, 'status') as RunItemStatus,
        targetVersionId: nullableText(row, 'target_version_id'),
        outputAssetId: nullableText(row, 'output_asset_id'),
        versionId: nullableText(row, 'version_id'),
        requestId: nullableText(row, 'request_id'),
        openaiRequestId: nullableText(row, 'openai_request_id'),
        usage: parseJson<Record<string, unknown> | null>(row.usage_json, null),
        estimatedCostUsd: row.estimated_cost_usd === null || row.estimated_cost_usd === undefined ? null : num(row, 'estimated_cost_usd'),
        errorCode: nullableText(row, 'error_code'),
        errorMessage: nullableText(row, 'error_message'),
        startedAt: nullableText(row, 'started_at'),
        finishedAt: nullableText(row, 'finished_at'),
        createdAt: text(row, 'created_at')
    };
}

function mapRun(row: Row, items: RunItemRecord[]): RunSummary {
    return {
        id: text(row, 'id'),
        projectId: text(row, 'project_id'),
        action: text(row, 'action') as RunAction,
        status: text(row, 'status') as RunStatus,
        stopRequested: bool(row, 'stop_requested'),
        snapshot: parseJson<RunSnapshot>(row.snapshot_json, {} as RunSnapshot),
        errorCode: nullableText(row, 'error_code'),
        errorMessage: nullableText(row, 'error_message'),
        createdAt: text(row, 'created_at'),
        updatedAt: text(row, 'updated_at'),
        mock: bool(row, 'mock'),
        items
    };
}

function mapProject(row: Row): ProjectSummary {
    return {
        id: text(row, 'id'),
        name: text(row, 'name'),
        entry: text(row, 'entry') as ProjectSummary['entry'],
        mock: bool(row, 'mock'),
        designVersion: num(row, 'design_version'),
        baselineVersionId: nullableText(row, 'baseline_version_id'),
        createdAt: text(row, 'created_at'),
        updatedAt: text(row, 'updated_at'),
        latestRunStatus: null,
        runCount: 0,
        versionCount: 0
    };
}

export function listProjects(): ProjectSummary[] {
    const db = sqlite();
    const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Row[];
    return rows.map((row) => {
        const project = mapProject(row);
        const run = db
            .prepare('SELECT status FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
            .get(project.id) as Row | undefined;
        project.latestRunStatus = run ? (text(run, 'status') as RunStatus) : null;
        project.runCount = num(db.prepare('SELECT COUNT(*) AS c FROM runs WHERE project_id = ?').get(project.id) as Row, 'c');
        project.versionCount = num(
            db.prepare('SELECT COUNT(*) AS c FROM versions WHERE project_id = ?').get(project.id) as Row,
            'c'
        );
        return project;
    });
}

export function getProjectData(projectId: string): StoredProject | null {
    const db = sqlite();
    const row = db.prepare(PROJECT_SELECT).get(projectId) as Row | undefined;
    if (!row) return null;

    const project = mapProject(row);
    const runRows = db
        .prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC')
        .all(projectId) as Row[];
    project.runCount = runRows.length;
    const versions = listVersions(projectId);
    project.versionCount = versions.length;
    project.latestRunStatus = runRows.length > 0 ? (text(runRows[0], 'status') as RunStatus) : null;

    const bindingRows = db
        .prepare(
            `SELECT b.*, a.* FROM reference_bindings b
             JOIN assets a ON a.id = b.asset_id
             WHERE b.project_id = ? ORDER BY b.position ASC`
        )
        .all(projectId) as Row[];
    const references: ReferenceBinding[] = bindingRows.map((bindingRow) => ({
        id: text(bindingRow, 'id'),
        projectId: text(bindingRow, 'project_id'),
        assetId: text(bindingRow, 'asset_id'),
        purpose: text(bindingRow, 'purpose') as ReferencePurpose,
        borrow: text(bindingRow, 'borrow'),
        exclude: text(bindingRow, 'exclude'),
        position: num(bindingRow, 'position'),
        asset: mapAsset(bindingRow)
    }));

    return {
        project,
        design: parseJson<DesignCard>(row.design_json, emptyDesignCard()),
        lockedFields: parseJson<DesignFieldKey[]>(row.locked_json, []),
        prompt: {
            text: text(row, 'prompt_text'),
            avoid: text(row, 'prompt_avoid'),
            acceptance: text(row, 'prompt_acceptance'),
            source: text(row, 'prompt_source') as PromptState['source'],
            designVersion: num(row, 'prompt_design_version'),
            bindingHash: text(row, 'prompt_binding_hash'),
            stale: bool(row, 'prompt_stale'),
            updatedAt: text(row, 'prompt_updated_at')
        },
        references,
        assets: listProjectAssets(projectId),
        candidates: listCandidates(projectId),
        runs: runRows.map((runRow) => mapRun(runRow, listRunItems(text(runRow, 'id')))),
        versions
    };
}

export function emptyDesignCard(): DesignCard {
    return {
        subject: '',
        subjectVersion: '',
        sceneIntent: '',
        composition: '',
        actionView: '',
        colorLight: '',
        artStyle: '',
        aspectRatio: '16:9',
        mustKeep: [],
        mayChange: [],
        missingReferences: [],
        assumptions: []
    };
}

export function createProject(input: {
    name: string;
    entry: 'keyword' | 'upload';
    design: DesignCard;
    lockedFields: DesignFieldKey[];
    mock: boolean;
    plannerModel?: string | null;
    reasoningEffort?: string | null;
}): string {
    const id = newId();
    const now = nowIso();
    tx((db) => {
        db.prepare(
            `INSERT INTO projects (id, name, entry, mock, design_json, locked_json, design_version,
                prompt_text, prompt_avoid, prompt_acceptance, prompt_source, prompt_design_version,
                prompt_binding_hash, prompt_stale, prompt_updated_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, '', '', '', 'compiled', 0, '', 0, ?, ?, ?)`
        ).run(
            id,
            input.name,
            input.entry,
            input.mock ? 1 : 0,
            JSON.stringify(input.design),
            JSON.stringify(input.lockedFields),
            now,
            now,
            now
        );
        db.prepare(
            `INSERT INTO design_revisions (id, project_id, version, instruction, changes_json, conflicts_json, card_json,
                planner_model, reasoning_effort, created_at)
             VALUES (?, ?, 1, NULL, '[]', '[]', ?, ?, ?, ?)`
        ).run(
            newId(),
            id,
            JSON.stringify(input.design),
            input.plannerModel ?? null,
            input.reasoningEffort ?? null,
            now
        );
    });
    return id;
}

export function applyDesignCard(input: {
    projectId: string;
    card: DesignCard;
    lockedFields: DesignFieldKey[];
    instruction: string | null;
    changes: DesignUpdateResult['changeSummary'];
    conflicts: DesignConflict[];
    plannerModel?: string | null;
    reasoningEffort?: string | null;
}): DesignUpdateResult {
    const now = nowIso();
    tx((db) => {
        const row = db.prepare(PROJECT_SELECT).get(input.projectId) as Row | undefined;
        if (!row) throw new Error('PROJECT_NOT_FOUND');
        const nextVersion = num(row, 'design_version') + 1;
        const hasPrompt = text(row, 'prompt_text') !== '';
        db.prepare(
            `UPDATE projects SET design_json = ?, locked_json = ?, design_version = ?,
                prompt_stale = ?, updated_at = ? WHERE id = ?`
        ).run(
            JSON.stringify(input.card),
            JSON.stringify(input.lockedFields),
            nextVersion,
            hasPrompt ? 1 : 0,
            now,
            input.projectId
        );
        db.prepare(
            `INSERT INTO design_revisions (id, project_id, version, instruction, changes_json, conflicts_json, card_json,
                planner_model, reasoning_effort, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            newId(),
            input.projectId,
            nextVersion,
            input.instruction,
            JSON.stringify(input.changes),
            JSON.stringify(input.conflicts),
            JSON.stringify(input.card),
            input.plannerModel ?? null,
            input.reasoningEffort ?? null,
            now
        );
    });
    return {
        card: input.card,
        changeSummary: input.changes,
        conflicts: input.conflicts,
        requiresUnlock: input.conflicts.filter((item) => item.locked).map((item) => item.field)
    };
}

export function unlockDesignFields(projectId: string, fields: DesignFieldKey[]): DesignFieldKey[] {
    return tx((db) => {
        const row = db.prepare(PROJECT_SELECT).get(projectId) as Row | undefined;
        if (!row) throw new Error('PROJECT_NOT_FOUND');
        const locked = parseJson<DesignFieldKey[]>(row.locked_json, []);
        const next = locked.filter((field) => !fields.includes(field));
        db.prepare('UPDATE projects SET locked_json = ?, updated_at = ? WHERE id = ?').run(
            JSON.stringify(next),
            nowIso(),
            projectId
        );
        return next;
    });
}

export function setPromptState(projectId: string, prompt: {
    text: string;
    avoid: string;
    acceptance: string;
    source: 'compiled' | 'manual';
    designVersion: number;
    bindingHash: string;
    stale: boolean;
}): PromptState {
    const now = nowIso();
    tx((db) => {
        db.prepare(
            `UPDATE projects SET prompt_text = ?, prompt_avoid = ?, prompt_acceptance = ?,
                prompt_source = ?, prompt_design_version = ?, prompt_binding_hash = ?,
                prompt_stale = ?, prompt_updated_at = ?, updated_at = ?
             WHERE id = ?`
        ).run(
            prompt.text,
            prompt.avoid,
            prompt.acceptance,
            prompt.source,
            prompt.designVersion,
            prompt.bindingHash,
            prompt.stale ? 1 : 0,
            now,
            now,
            projectId
        );
    });
    return { ...prompt, updatedAt: now };
}

export function markPromptStale(projectId: string) {
    tx((db) => {
        db.prepare(
            `UPDATE projects SET prompt_stale = CASE WHEN prompt_text <> '' THEN 1 ELSE prompt_stale END,
                updated_at = ? WHERE id = ?`
        ).run(nowIso(), projectId);
    });
}

export function setProjectName(projectId: string, name: string) {
    tx((db) => {
        db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), projectId);
    });
}

export function findAssetBySha(sha256: string): AssetMeta | null {
    const row = sqlite().prepare('SELECT * FROM assets WHERE sha256 = ?').get(sha256) as Row | undefined;
    return row ? mapAsset(row) : null;
}

export function getAsset(assetId: string): AssetMeta | null {
    const row = sqlite().prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as Row | undefined;
    return row ? mapAsset(row) : null;
}

export function insertAsset(asset: {
    id?: string;
    sha256: string;
    filename: string;
    originalName: string;
    mime: string;
    width: number;
    height: number;
    bytes: number;
    kind: AssetMeta['kind'];
    sourcePage: string | null;
    sourceUrl: string | null;
    projectId: string | null;
    mock: boolean;
}): AssetMeta {
    const id = asset.id ?? newId();
    const now = nowIso();
    tx((db) => {
        db.prepare(
            `INSERT INTO assets (id, sha256, filename, original_name, mime, width, height, bytes, kind,
                source_page, source_url, acquired_at, project_id, mock, analysis_json, analysis_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
        ).run(
            id,
            asset.sha256,
            asset.filename,
            asset.originalName,
            asset.mime,
            asset.width,
            asset.height,
            asset.bytes,
            asset.kind,
            asset.sourcePage,
            asset.sourceUrl,
            now,
            asset.projectId,
            asset.mock ? 1 : 0
        );
    });
    return getAsset(id)!;
}

export function linkProjectAsset(projectId: string, assetId: string) {
    tx((db) => {
        db.prepare(
            `INSERT INTO project_assets (project_id, asset_id, linked_at) VALUES (?, ?, ?)
             ON CONFLICT(project_id, asset_id) DO NOTHING`
        ).run(projectId, assetId, nowIso());
    });
}

export function listProjectAssets(projectId: string): AssetMeta[] {
    const rows = sqlite()
        .prepare(
            `SELECT DISTINCT a.* FROM assets a
             LEFT JOIN project_assets pa ON pa.asset_id = a.id AND pa.project_id = ?
             LEFT JOIN reference_bindings b ON b.asset_id = a.id AND b.project_id = ?
             LEFT JOIN versions v ON v.asset_id = a.id AND v.project_id = ?
             WHERE a.project_id = ? OR pa.project_id IS NOT NULL OR b.id IS NOT NULL OR v.id IS NOT NULL
             ORDER BY a.acquired_at DESC`
        )
        .all(projectId, projectId, projectId, projectId) as Row[];
    return rows.map(mapAsset);
}

export function listLibraryAssets(limit = 100): AssetMeta[] {
    const rows = sqlite()
        .prepare('SELECT * FROM assets ORDER BY acquired_at DESC LIMIT ?')
        .all(limit) as Row[];
    return rows.map(mapAsset);
}

export function setAssetAnalysis(assetId: string, cacheKey: string, analysis: AssetAnalysis) {
    tx((db) => {
        db.prepare('UPDATE assets SET analysis_json = ?, analysis_key = ? WHERE id = ?').run(
            JSON.stringify(analysis),
            cacheKey,
            assetId
        );
    });
}

export function getAssetAnalysis(
    assetId: string,
    cacheKey: string,
    options?: { ignoreManual?: boolean }
): AssetAnalysis | null {
    const row = sqlite().prepare('SELECT analysis_json, analysis_key FROM assets WHERE id = ?').get(assetId) as
        | Row
        | undefined;
    if (!row) return null;
    const storedKey = text(row, 'analysis_key');
    if (storedKey === 'manual' && !options?.ignoreManual) {
        return parseJson<AssetAnalysis | null>(row.analysis_json, null);
    }
    if (storedKey !== cacheKey) return null;
    return parseJson<AssetAnalysis | null>(row.analysis_json, null);
}

export function replaceBindings(
    projectId: string,
    bindings: {
        assetId: string;
        purpose: ReferencePurpose;
        borrow: string;
        exclude: string;
        position: number;
    }[]
): void {
    const now = nowIso();
    tx((db) => {
        db.prepare('DELETE FROM reference_bindings WHERE project_id = ?').run(projectId);
        for (const binding of bindings) {
            db.prepare(
                `INSERT INTO reference_bindings (id, project_id, asset_id, purpose, borrow, exclude, position, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
                newId(),
                projectId,
                binding.assetId,
                binding.purpose,
                binding.borrow,
                binding.exclude,
                binding.position,
                now
            );
            db.prepare(
                `INSERT INTO project_assets (project_id, asset_id, linked_at) VALUES (?, ?, ?)
                 ON CONFLICT(project_id, asset_id) DO NOTHING`
            ).run(projectId, binding.assetId, now);
        }
        db.prepare(
            `UPDATE projects SET prompt_stale = CASE WHEN prompt_text <> '' THEN 1 ELSE prompt_stale END,
                updated_at = ? WHERE id = ?`
        ).run(now, projectId);
    });
}

export function bindingHash(projectId: string): string {
    const rows = sqlite()
        .prepare(
            `SELECT a.sha256, b.purpose, b.borrow, b.exclude, b.position
             FROM reference_bindings b JOIN assets a ON a.id = b.asset_id
             WHERE b.project_id = ? ORDER BY b.position ASC`
        )
        .all(projectId) as Row[];
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(rows.map((row) => [text(row, 'sha256'), text(row, 'purpose'), text(row, 'borrow'), text(row, 'exclude'), num(row, 'position')])))
        .digest('hex');
}

export function insertCandidates(candidates: Omit<SearchCandidate, 'id' | 'createdAt' | 'status' | 'assetId' | 'error'>[]): SearchCandidate[] {
    const now = nowIso();
    const ids: string[] = [];
    tx((db) => {
        for (const candidate of candidates) {
            const id = newId();
            ids.push(id);
            db.prepare(
                `INSERT INTO search_candidates (id, project_id, query, query_kind, title, image_url, thumbnail_url,
                    page_url, domain, trust_note, license_note, suggested_purpose, width, height, status, asset_id,
                    error, mock, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', NULL, NULL, ?, ?)`
            ).run(
                id,
                candidate.projectId,
                candidate.query,
                candidate.queryKind,
                candidate.title,
                candidate.imageUrl,
                candidate.thumbnailUrl,
                candidate.pageUrl,
                candidate.domain,
                candidate.trustNote,
                candidate.licenseNote,
                candidate.suggestedPurpose,
                candidate.width,
                candidate.height,
                candidate.mock ? 1 : 0,
                now
            );
        }
    });
    return ids.map((id) => getCandidate(id)!).filter(Boolean);
}

export function getCandidate(candidateId: string): SearchCandidate | null {
    const row = sqlite().prepare('SELECT * FROM search_candidates WHERE id = ?').get(candidateId) as Row | undefined;
    return row ? mapCandidate(row) : null;
}

export function listCandidates(projectId: string): SearchCandidate[] {
    const rows = sqlite()
        .prepare('SELECT * FROM search_candidates WHERE project_id = ? ORDER BY created_at DESC, rowid ASC')
        .all(projectId) as Row[];
    return rows.map(mapCandidate);
}

export function updateCandidate(candidateId: string, patch: { status?: SearchCandidate['status']; assetId?: string | null; error?: string | null }) {
    tx((db) => {
        const row = db.prepare('SELECT * FROM search_candidates WHERE id = ?').get(candidateId) as Row | undefined;
        if (!row) throw new Error('CANDIDATE_NOT_FOUND');
        db.prepare('UPDATE search_candidates SET status = ?, asset_id = ?, error = ? WHERE id = ?').run(
            patch.status ?? text(row, 'status'),
            patch.assetId !== undefined ? patch.assetId : nullableText(row, 'asset_id'),
            patch.error !== undefined ? patch.error : nullableText(row, 'error'),
            candidateId
        );
    });
}

export function createRun(input: {
    projectId: string;
    action: RunAction;
    actionKey: string;
    snapshot: RunSnapshot;
    sourceRunId?: string;
    baseVersionId?: string;
    mock: boolean;
    imageCount: number;
}): { run: RunSummary; created: boolean } {
    const existing = sqlite().prepare('SELECT * FROM runs WHERE action_key = ?').get(input.actionKey) as Row | undefined;
    if (existing) {
        const runId = text(existing, 'id');
        return { run: getRun(runId)!, created: false };
    }

    const id = newId();
    const now = nowIso();
    try {
        tx((db) => {
            db.prepare(
                `INSERT INTO runs (id, project_id, action, action_key, status, stop_requested, snapshot_json,
                    source_run_id, base_version_id, created_at, updated_at, mock)
                 VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)`
            ).run(
                id,
                input.projectId,
                input.action,
                input.actionKey,
                JSON.stringify(input.snapshot),
                input.sourceRunId ?? null,
                input.baseVersionId ?? null,
                now,
                now,
                input.mock ? 1 : 0
            );

            for (let index = 0; index < input.imageCount; index++) {
                db.prepare(
                    `INSERT INTO run_items (id, run_id, position, kind, status, created_at, updated_at)
                     VALUES (?, ?, ?, 'image', 'pending', ?, ?)`
                ).run(newId(), id, index, now, now);
            }
        });
    } catch (error) {
        const row = sqlite().prepare('SELECT * FROM runs WHERE action_key = ?').get(input.actionKey) as Row | undefined;
        if (row) return { run: getRun(text(row, 'id'))!, created: false };
        throw error;
    }

    return { run: getRun(id)!, created: true };
}

export function getRunByActionKey(actionKey: string): RunSummary | null {
    const row = sqlite().prepare('SELECT id, project_id FROM runs WHERE action_key = ?').get(actionKey) as
        | Row
        | undefined;
    if (!row) return null;
    return getRun(text(row, 'id'));
}

export function getRun(runId: string): RunSummary | null {
    const row = sqlite().prepare('SELECT * FROM runs WHERE id = ?').get(runId) as Row | undefined;
    if (!row) return null;
    return mapRun(row, listRunItems(runId));
}

export function listRunItems(runId: string): RunItemRecord[] {
    const rows = sqlite()
        .prepare('SELECT * FROM run_items WHERE run_id = ? ORDER BY position ASC')
        .all(runId) as Row[];
    return rows.map(mapItem);
}

export function listRuns(projectId: string): RunSummary[] {
    const db = sqlite();
    const rows = db
        .prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC')
        .all(projectId) as Row[];
    return rows.map((row) => mapRun(row, listRunItems(text(row, 'id'))));
}

export type ClaimedItem = {
    run: RunSummary;
    item: RunItemRecord;
    snapshot: RunSnapshot;
};

export function claimNextItem(): ClaimedItem | null {
    return tx((db) => {
        const pending = db
            .prepare(
                `SELECT i.id AS item_id, i.run_id AS run_id FROM run_items i
                 JOIN runs r ON r.id = i.run_id
                 WHERE i.status = 'pending'
                   AND r.status IN ('queued', 'running')
                   AND r.stop_requested = 0
                 ORDER BY r.created_at ASC, i.position ASC
                 LIMIT 1`
            )
            .get() as Row | undefined;

        if (!pending) return null;

        const runId = text(pending, 'run_id');
        const itemId = text(pending, 'item_id');
        const now = nowIso();

        db.prepare(
            `UPDATE run_items SET status = 'sending', started_at = ?, updated_at = ?, boot_id = ?
             WHERE id = ? AND status = 'pending'`
        ).run(now, now, getBootId(), itemId);
        db.prepare(`UPDATE runs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'`).run(now, runId);

        const runRow = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as Row;
        const itemRow = db.prepare('SELECT * FROM run_items WHERE id = ?').get(itemId) as Row;
        const run = mapRun(runRow, listRunItems(runId));
        return {
            run,
            item: mapItem(itemRow),
            snapshot: parseJson<RunSnapshot>(runRow.snapshot_json, {} as RunSnapshot)
        };
    });
}

export function markItemSuccess(input: {
    itemId: string;
    requestId?: string | null;
    openaiRequestId?: string | null;
    usage?: Record<string, unknown> | null;
    estimatedCostUsd?: number | null;
    outputAssetId?: string | null;
    versionId?: string | null;
}) {
    tx((db) => {
        const now = nowIso();
        db.prepare(
            `UPDATE run_items SET status = 'success', request_id = ?, openai_request_id = ?, usage_json = ?,
                estimated_cost_usd = ?, output_asset_id = ?, version_id = ?, finished_at = ?, updated_at = ?
             WHERE id = ?`
        ).run(
            input.requestId ?? null,
            input.openaiRequestId ?? null,
            input.usage ? JSON.stringify(input.usage) : null,
            input.estimatedCostUsd ?? null,
            input.outputAssetId ?? null,
            input.versionId ?? null,
            now,
            now,
            input.itemId
        );
    });
}

export function markItemFailed(
    itemId: string,
    code: string,
    message: string,
    dispatchUnknown: boolean,
    billing?: { usage?: Record<string, unknown> | null; estimatedCostUsd?: number | null; openaiRequestId?: string | null }
) {
    tx((db) => {
        const now = nowIso();
        db.prepare(
            `UPDATE run_items SET status = ?, error_code = ?, error_message = ?,
                usage_json = COALESCE(?, usage_json),
                estimated_cost_usd = COALESCE(?, estimated_cost_usd),
                openai_request_id = COALESCE(?, openai_request_id),
                finished_at = ?, updated_at = ?
             WHERE id = ?`
        ).run(
            dispatchUnknown ? 'unknown' : 'failed',
            code,
            message,
            billing?.usage ? JSON.stringify(billing.usage) : null,
            billing?.estimatedCostUsd ?? null,
            billing?.openaiRequestId ?? null,
            now,
            now,
            itemId
        );
    });
}

export function markItemSkipped(itemId: string, code: string, message: string) {
    tx((db) => {
        const now = nowIso();
        db.prepare(
            `UPDATE run_items SET status = 'skipped', error_code = ?, error_message = ?, finished_at = ?, updated_at = ?
             WHERE id = ? AND status IN ('pending', 'sending')`
        ).run(code, message, now, now, itemId);
    });
}

export function markSendingAsUnknown(itemId: string, code: string, message: string) {
    tx((db) => {
        const now = nowIso();
        db.prepare(
            `UPDATE run_items SET status = 'unknown', error_code = ?, error_message = ?, finished_at = ?, updated_at = ?
             WHERE id = ? AND status = 'sending'`
        ).run(code, message, now, now, itemId);
    });
}

export function recoverStaleSending(olderThanMs: number): number {
    return tx((db) => {
        const cutoff = new Date(Date.now() - olderThanMs).toISOString();
        const rows = db
            .prepare(`SELECT id, run_id FROM run_items WHERE status = 'sending' AND updated_at < ?`)
            .all(cutoff) as Row[];
        if (rows.length === 0) return 0;
        const now = nowIso();
        for (const row of rows) {
            db.prepare(
                `UPDATE run_items SET status = 'unknown', error_code = 'STALE_SENDING',
                    error_message = '发送后长时间没有结果，按未知处理；未自动重发。', finished_at = ?, updated_at = ?
                 WHERE id = ?`
            ).run(now, now, text(row, 'id'));
            db.prepare(
                `UPDATE runs SET status = 'paused_unknown', error_code = 'STALE_SENDING',
                    error_message = '有已发送请求长时间无结果，已暂停后续步骤；请先核实。如自行重新提交，可能重复收费。', updated_at = ?
                 WHERE id = ? AND status IN ('queued', 'running')`
            ).run(now, text(row, 'run_id'));
        }
        return rows.length;
    });
}

export function markReviewUnavailable(itemId: string, versionId: string, message: string) {
    tx((db) => {
        const now = nowIso();
        db.prepare(
            `UPDATE run_items SET status = 'review_unavailable', error_code = 'REVIEW_UNAVAILABLE',
                error_message = ?, finished_at = ?, updated_at = ? WHERE id = ?`
        ).run(message, now, now, itemId);
        db.prepare(`UPDATE versions SET review_status = 'unavailable' WHERE id = ?`).run(versionId);
    });
}

export function skipPendingItems(runId: string, code: string, message: string) {
    tx((db) => {
        const now = nowIso();
        db.prepare(
            `UPDATE run_items SET status = 'skipped', error_code = ?, error_message = ?, finished_at = ?, updated_at = ?
             WHERE run_id = ? AND status = 'pending'`
        ).run(code, message, now, now, runId);
    });
}

export function updateRunState(
    runId: string,
    patch: {
        status?: RunStatus;
        stopRequested?: boolean;
        errorCode?: string | null;
        errorMessage?: string | null;
    }
) {
    tx((db) => {
        const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as Row | undefined;
        if (!row) throw new Error('RUN_NOT_FOUND');
        db.prepare(
            `UPDATE runs SET status = ?, stop_requested = ?, error_code = ?, error_message = ?, updated_at = ?
             WHERE id = ?`
        ).run(
            patch.status ?? text(row, 'status'),
            patch.stopRequested === undefined ? num(row, 'stop_requested') : patch.stopRequested ? 1 : 0,
            patch.errorCode !== undefined ? patch.errorCode : nullableText(row, 'error_code'),
            patch.errorMessage !== undefined ? patch.errorMessage : nullableText(row, 'error_message'),
            nowIso(),
            runId
        );
    });
}

export function finalizeRunStatus(runId: string) {
    let run = getRun(runId);
    if (!run) return;
    if (run.items.some((item) => item.status === 'sending')) return;

    if (run.stopRequested) {
        tx((db) => {
            const now = nowIso();
            for (const item of run!.items) {
                if (item.status !== 'pending') continue;
                if (item.kind === 'review' && item.targetVersionId) {
                    db.prepare(`UPDATE versions SET review_status = 'unavailable' WHERE id = ?`).run(item.targetVersionId);
                }
            }
            db.prepare(
                `UPDATE run_items SET status = 'skipped', error_code = 'STOPPED',
                    error_message = '用户已停止，未启动该步骤。', finished_at = ?, updated_at = ?
                 WHERE run_id = ? AND status = 'pending'`
            ).run(now, now, runId);
        });
        run = getRun(runId);
        if (!run) return;
        // Stop wins over a previous paused_unknown state; unknown items stay recorded as unknown.
        updateRunState(runId, { status: 'stopped' });
        return;
    }

    if (run.items.some((item) => item.status === 'unknown')) {
        updateRunState(runId, { status: 'paused_unknown' });
        return;
    }
    if (run.items.some((item) => item.status === 'pending')) return;

    if (run.status === 'paused_budget' && run.errorCode) {
        return;
    }

    const images = run.items.filter((item) => item.kind === 'image');
    const successImages = images.filter((item) => item.status === 'success').length;
    const failedImages = images.filter((item) => item.status === 'failed' || item.status === 'skipped').length;
    const budgetSkipped = images.some(
        (item) => item.errorCode === 'BUDGET_EXCEEDED' || item.errorCode === 'COST_UNKNOWN'
    );

    let status: RunStatus;
    if (budgetSkipped) status = 'paused_budget';
    else if (successImages === 0) status = 'failed';
    else if (failedImages > 0) status = 'partial';
    else status = 'completed';

    updateRunState(runId, { status });
}

export function createReviewItem(runId: string, targetVersionId: string, position: number): RunItemRecord {
    const id = newId();
    const now = nowIso();
    tx((db) => {
        db.prepare(
            `INSERT INTO run_items (id, run_id, position, kind, status, target_version_id, created_at, updated_at)
             VALUES (?, ?, ?, 'review', 'pending', ?, ?, ?)`
        ).run(id, runId, position, targetVersionId, now, now);
    });
    return listRunItems(runId).find((item) => item.id === id)!;
}

export function createVersion(input: {
    projectId: string;
    runId: string;
    itemId: string;
    assetId: string;
    parentVersionId: string | null;
    mock: boolean;
}): VersionRecord {
    const id = newId();
    const now = nowIso();
    tx((db) => {
        let label: string;
        if (input.parentVersionId) {
            const parentRow = db.prepare('SELECT label FROM versions WHERE id = ?').get(input.parentVersionId) as
                | Row
                | undefined;
            if (!parentRow) throw new Error('VERSION_NOT_FOUND');
            const childCount = num(
                db
                    .prepare('SELECT COUNT(*) AS c FROM versions WHERE project_id = ? AND parent_version_id = ?')
                    .get(input.projectId, input.parentVersionId) as Row,
                'c'
            );
            label = `${text(parentRow, 'label')}${childCount + 1}`;
        } else {
            const rootCount = num(
                db
                    .prepare('SELECT COUNT(*) AS c FROM versions WHERE project_id = ? AND parent_version_id IS NULL')
                    .get(input.projectId) as Row,
                'c'
            );
            label = labelForIndex(rootCount);
        }

        db.prepare(
            `INSERT INTO versions (id, project_id, run_id, item_id, asset_id, parent_version_id, label,
                is_baseline, review_json, review_status, created_at, mock)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 'pending', ?, ?)`
        ).run(
            id,
            input.projectId,
            input.runId,
            input.itemId,
            input.assetId,
            input.parentVersionId,
            label,
            now,
            input.mock ? 1 : 0
        );
        const rootCountAfter = num(
            db
                .prepare('SELECT COUNT(*) AS c FROM versions WHERE project_id = ? AND parent_version_id IS NULL')
                .get(input.projectId) as Row,
            'c'
        );
        if (rootCountAfter === 1) {
            db.prepare('UPDATE projects SET baseline_version_id = ?, updated_at = ? WHERE id = ?').run(
                id,
                now,
                input.projectId
            );
            db.prepare('UPDATE versions SET is_baseline = 1 WHERE id = ?').run(id);
        } else {
            db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, input.projectId);
        }
    });
    return getVersion(id)!;
}

export function getVersion(versionId: string): VersionRecord | null {
    const db = sqlite();
    const row = db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId) as Row | undefined;
    if (!row) return null;
    const assetRow = db.prepare('SELECT * FROM assets WHERE id = ?').get(text(row, 'asset_id')) as Row | undefined;
    if (!assetRow) return null;
    const runRow = db.prepare('SELECT action FROM runs WHERE id = ?').get(text(row, 'run_id')) as Row | undefined;
    return mapVersion(row, mapAsset(assetRow), (runRow ? text(runRow, 'action') : 'generate') as RunAction);
}

export function listVersions(projectId: string): VersionRecord[] {
    const db = sqlite();
    const rows = db
        .prepare('SELECT * FROM versions WHERE project_id = ? ORDER BY created_at ASC')
        .all(projectId) as Row[];
    const result: VersionRecord[] = [];
    for (const row of rows) {
        const assetRow = db.prepare('SELECT * FROM assets WHERE id = ?').get(text(row, 'asset_id')) as Row | undefined;
        if (!assetRow) continue;
        const runRow = db.prepare('SELECT action FROM runs WHERE id = ?').get(text(row, 'run_id')) as Row | undefined;
        result.push(mapVersion(row, mapAsset(assetRow), (runRow ? text(runRow, 'action') : 'generate') as RunAction));
    }
    return result;
}

export function setVersionReviewStatus(versionId: string, status: VersionRecord['reviewStatus']) {
    tx((db) => {
        db.prepare('UPDATE versions SET review_status = ? WHERE id = ?').run(status, versionId);
    });
}

export function setVersionReview(versionId: string, review: ReviewResult) {
    tx((db) => {
        db.prepare(`UPDATE versions SET review_json = ?, review_status = 'available' WHERE id = ?`).run(
            JSON.stringify(review),
            versionId
        );
    });
}

export function listRunVersions(runId: string): VersionRecord[] {
    const mine = listVersionsByRun(runId);
    return mine;
}

function listVersionsByRun(runId: string): VersionRecord[] {
    const db = sqlite();
    const rows = db.prepare('SELECT * FROM versions WHERE run_id = ? ORDER BY created_at ASC').all(runId) as Row[];
    const result: VersionRecord[] = [];
    for (const row of rows) {
        const assetRow = db.prepare('SELECT * FROM assets WHERE id = ?').get(text(row, 'asset_id')) as Row | undefined;
        if (!assetRow) continue;
        const runRow = db.prepare('SELECT action FROM runs WHERE id = ?').get(text(row, 'run_id')) as Row | undefined;
        result.push(mapVersion(row, mapAsset(assetRow), (runRow ? text(runRow, 'action') : 'generate') as RunAction));
    }
    return result;
}

export function abandonUnknownItems(runId: string): number {
    return tx((db) => {
        const now = nowIso();
        const result = db
            .prepare(
                `UPDATE run_items SET status = 'skipped', error_code = 'UNKNOWN_ABANDONED',
                    error_message = '用户确认放弃核实该未知结果；未自动重发。', finished_at = ?, updated_at = ?
                 WHERE run_id = ? AND status = 'unknown'`
            )
            .run(now, now, runId);
        return Number(result.changes ?? 0);
    });
}

export function setBaseline(projectId: string, versionId: string) {
    tx((db) => {
        const version = db.prepare('SELECT id FROM versions WHERE id = ? AND project_id = ?').get(versionId, projectId) as
            | Row
            | undefined;
        if (!version) throw new Error('VERSION_NOT_FOUND');
        db.prepare('UPDATE versions SET is_baseline = 0 WHERE project_id = ?').run(projectId);
        db.prepare('UPDATE versions SET is_baseline = 1 WHERE id = ?').run(versionId);
        db.prepare('UPDATE projects SET baseline_version_id = ?, updated_at = ? WHERE id = ?').run(
            versionId,
            nowIso(),
            projectId
        );
    });
}

function labelForIndex(index: number): string {
    let value = index;
    let label = '';
    do {
        label = String.fromCharCode(65 + (value % 26)) + label;
        value = Math.floor(value / 26) - 1;
    } while (value >= 0);
    return label;
}

export function setWorkerHeartbeat(payload: { tickAt: string; didWork: boolean; runId?: string | null }) {
    tx((db) => {
        db.prepare(
            `INSERT INTO meta (key, value) VALUES ('worker_heartbeat', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).run(JSON.stringify(payload));
    });
}

export function hasActiveRuns(): boolean {
    const row = sqlite()
        .prepare(
            `SELECT COUNT(*) AS c FROM runs r
             WHERE r.status IN ('queued', 'running')
                OR EXISTS (SELECT 1 FROM run_items i WHERE i.run_id = r.id AND i.status = 'sending')`
        )
        .get() as Row;
    return num(row, 'c') > 0;
}

export function getWorkerHeartbeat(): { tickAt: string; didWork: boolean; runId?: string | null } | null {
    const row = sqlite().prepare(`SELECT value FROM meta WHERE key = 'worker_heartbeat'`).get() as Row | undefined;
    if (!row) return null;
    return parseJson(row.value, null);
}

export function assetFilePath(asset: AssetMeta): string {
    return path.join(/*turbopackIgnore: true*/ getAssetsDir(), asset.filename);
}

