import type {
    AssetAnalysis,
    DesignCard,
    DesignChange,
    DesignConflict,
    DesignFieldKey,
    DesignUpdateResult,
    ReferencePurpose,
    ReviewIssue,
    ReviewResult
} from '@/lib/workbench/types';
import { DESIGN_FIELD_KEYS, REFERENCE_PURPOSES } from '@/lib/workbench/types';

export class StructuredOutputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StructuredOutputError';
    }
}

const MAX_FIELD_LENGTH = 1200;
const MAX_LIST_ITEMS = 12;

function asString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value.slice(0, MAX_FIELD_LENGTH) : fallback;
}

function asStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().slice(0, MAX_FIELD_LENGTH))
        .slice(0, MAX_LIST_ITEMS);
}

export function sanitizeDesignCard(value: unknown): DesignCard {
    if (!value || typeof value !== 'object') throw new StructuredOutputError('设计卡不是对象。');
    const raw = value as Record<string, unknown>;
    const assumptionsRaw = Array.isArray(raw.assumptions) ? raw.assumptions : [];

    return {
        subject: asString(raw.subject),
        subjectVersion: asString(raw.subjectVersion),
        sceneIntent: asString(raw.sceneIntent),
        composition: asString(raw.composition),
        actionView: asString(raw.actionView),
        colorLight: asString(raw.colorLight),
        artStyle: asString(raw.artStyle),
        aspectRatio: asString(raw.aspectRatio, '16:9'),
        mustKeep: asStringList(raw.mustKeep),
        mayChange: asStringList(raw.mayChange),
        missingReferences: asStringList(raw.missingReferences),
        assumptions: assumptionsRaw
            .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
            .map((item) => ({
                field: asString(item.field),
                value: asString(item.value),
                reason: asString(item.reason)
            }))
            .filter((item) => item.field || item.value)
            .slice(0, MAX_LIST_ITEMS)
    };
}

function fieldValue(card: DesignCard, field: DesignFieldKey): string {
    const value = card[field];
    return Array.isArray(value) ? value.join('；') : value;
}

export function computeDesignDiff(before: DesignCard, after: DesignCard): DesignChange[] {
    const changes: DesignChange[] = [];
    for (const field of DESIGN_FIELD_KEYS) {
        const previous = fieldValue(before, field);
        const next = fieldValue(after, field);
        if (previous !== next) changes.push({ field, before: previous, after: next });
    }
    return changes;
}

export function mergeDesignProposal(input: {
    current: DesignCard;
    proposed: DesignCard;
    lockedFields: DesignFieldKey[];
}): DesignUpdateResult {
    const merged: DesignCard = {
        ...input.current,
        mustKeep: [...input.current.mustKeep],
        mayChange: [...input.current.mayChange],
        missingReferences: [...input.current.missingReferences],
        assumptions: [...input.current.assumptions]
    };
    const conflicts: DesignConflict[] = [];

    for (const field of DESIGN_FIELD_KEYS) {
        const proposedValue = fieldValue(input.proposed, field);
        const currentValue = fieldValue(input.current, field);
        if (proposedValue === currentValue) continue;

        if (input.lockedFields.includes(field)) {
            conflicts.push({
                field,
                locked: true,
                proposed: proposedValue,
                reason: '该字段已锁定，未应用模型提出的变化；如需修改请先解锁。'
            });
            continue;
        }

        if (field === 'mustKeep' || field === 'mayChange') {
            merged[field] = [...input.proposed[field]];
        } else {
            merged[field] = proposedValue;
        }
    }

    merged.assumptions = input.proposed.assumptions.length > 0 ? input.proposed.assumptions : input.current.assumptions;
    merged.missingReferences =
        input.proposed.missingReferences.length > 0
            ? input.proposed.missingReferences
            : input.current.missingReferences;

    return {
        card: merged,
        changeSummary: computeDesignDiff(input.current, merged),
        conflicts,
        requiresUnlock: conflicts.filter((item) => item.locked).map((item) => item.field)
    };
}

export function isDesignFieldKey(value: unknown): value is DesignFieldKey {
    return typeof value === 'string' && (DESIGN_FIELD_KEYS as readonly string[]).includes(value);
}

export function isReferencePurposeValue(value: unknown): value is ReferencePurpose {
    return typeof value === 'string' && (REFERENCE_PURPOSES as readonly string[]).includes(value);
}

export function parseAnalysis(value: unknown): AssetAnalysis {
    if (!value || typeof value !== 'object') throw new StructuredOutputError('图片分析结果不是对象。');
    const raw = value as Record<string, unknown>;
    const purpose = isReferencePurposeValue(raw.suggestedPurpose) ? raw.suggestedPurpose : 'style';
    return {
        observable: asStringList(raw.observable),
        inferences: asStringList(raw.inferences),
        uncertainties: asStringList(raw.uncertainties),
        styleLanguage: asString(raw.styleLanguage),
        suggestedPurpose: purpose,
        notes: asString(raw.notes),
        model: asString(raw.model),
        analyzedAt: asString(raw.analyzedAt),
        cacheKey: asString(raw.cacheKey)
    };
}

const ISSUE_TYPES = ['visible_deviation', 'uncertainty', 'aesthetic'] as const;
const CONFIDENCE = ['high', 'medium', 'low'] as const;

export function parseReview(value: unknown, meta: { model: string; mock: boolean }): ReviewResult {
    if (!value || typeof value !== 'object') throw new StructuredOutputError('审稿结果不是对象。');
    const raw = value as Record<string, unknown>;
    const issuesRaw = Array.isArray(raw.issues) ? raw.issues : [];
    const issues: ReviewIssue[] = issuesRaw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .slice(0, 2)
        .map((item) => ({
            type: ISSUE_TYPES.includes(item.type as (typeof ISSUE_TYPES)[number])
                ? (item.type as ReviewIssue['type'])
                : 'uncertainty',
            aspect: asString(item.aspect),
            problem: asString(item.problem),
            evidence: asString(item.evidence),
            confidence: CONFIDENCE.includes(item.confidence as (typeof CONFIDENCE)[number])
                ? (item.confidence as ReviewIssue['confidence'])
                : 'low',
            keep: asString(item.keep),
            change: asString(item.change)
        }))
        .filter((item) => item.problem);

    const compliantRaw = Array.isArray(raw.compliant) ? raw.compliant : [];
    const compliant = compliantRaw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({ aspect: asString(item.aspect), note: asString(item.note) }))
        .filter((item) => item.aspect || item.note)
        .slice(0, 6);

    const comparisonRaw =
        raw.comparison && typeof raw.comparison === 'object' ? (raw.comparison as Record<string, unknown>) : null;
    const recommended = comparisonRaw ? asString(comparisonRaw.recommended) : 'none';
    const comparison =
        comparisonRaw && (recommended === 'first' || recommended === 'second')
            ? {
                  recommendedVersionId: '',
                  recommendedLabel: recommended,
                  reason: asString(comparisonRaw.reason)
              }
            : null;

    return {
        acceptable: raw.acceptable === true,
        summary: asString(raw.summary),
        compliant,
        issues,
        comparison,
        model: meta.model,
        reviewedAt: new Date().toISOString(),
        mock: meta.mock
    };
}

const designCardSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'subject',
        'subjectVersion',
        'sceneIntent',
        'composition',
        'actionView',
        'colorLight',
        'artStyle',
        'aspectRatio',
        'mustKeep',
        'mayChange',
        'missingReferences',
        'assumptions'
    ],
    properties: {
        subject: { type: 'string' },
        subjectVersion: { type: 'string' },
        sceneIntent: { type: 'string' },
        composition: { type: 'string' },
        actionView: { type: 'string' },
        colorLight: { type: 'string' },
        artStyle: { type: 'string' },
        aspectRatio: { type: 'string' },
        mustKeep: { type: 'array', items: { type: 'string' } },
        mayChange: { type: 'array', items: { type: 'string' } },
        missingReferences: { type: 'array', items: { type: 'string' } },
        assumptions: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['field', 'value', 'reason'],
                properties: {
                    field: { type: 'string' },
                    value: { type: 'string' },
                    reason: { type: 'string' }
                }
            }
        }
    }
} as const;

export const DESIGN_SCHEMA = {
    name: 'design_card',
    schema: designCardSchema
};

export const ANALYSIS_SCHEMA = {
    name: 'reference_analysis',
    schema: {
        type: 'object',
        additionalProperties: false,
        required: ['observable', 'inferences', 'uncertainties', 'styleLanguage', 'suggestedPurpose', 'notes'],
        properties: {
            observable: { type: 'array', items: { type: 'string' } },
            inferences: { type: 'array', items: { type: 'string' } },
            uncertainties: { type: 'array', items: { type: 'string' } },
            styleLanguage: { type: 'string' },
            suggestedPurpose: { type: 'string', enum: [...REFERENCE_PURPOSES] },
            notes: { type: 'string' }
        }
    }
} as const;

export const REVIEW_SCHEMA = {
    name: 'image_review',
    schema: {
        type: 'object',
        additionalProperties: false,
        required: ['acceptable', 'summary', 'compliant', 'issues', 'comparison'],
        properties: {
            acceptable: { type: 'boolean' },
            summary: { type: 'string' },
            compliant: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['aspect', 'note'],
                    properties: { aspect: { type: 'string' }, note: { type: 'string' } }
                }
            },
            issues: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['type', 'aspect', 'problem', 'evidence', 'confidence', 'keep', 'change'],
                    properties: {
                        type: { type: 'string', enum: [...ISSUE_TYPES] },
                        aspect: { type: 'string' },
                        problem: { type: 'string' },
                        evidence: { type: 'string' },
                        confidence: { type: 'string', enum: [...CONFIDENCE] },
                        keep: { type: 'string' },
                        change: { type: 'string' }
                    }
                }
            },
            comparison: {
                type: ['object', 'null'],
                additionalProperties: false,
                required: ['recommended', 'reason'],
                properties: {
                    recommended: { type: 'string', enum: ['first', 'second', 'none'] },
                    reason: { type: 'string' }
                }
            }
        }
    }
} as const;
