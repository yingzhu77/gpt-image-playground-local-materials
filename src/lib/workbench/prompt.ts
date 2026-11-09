import { REFERENCE_PURPOSE_LABELS } from '@/lib/workbench/types';
import type { DesignCard, DesignFieldKey, ReferenceBinding } from '@/lib/workbench/types';
import { DESIGN_FIELD_LABELS } from '@/lib/workbench/types';

export type CompiledPrompt = {
    text: string;
    avoid: string;
    acceptance: string;
};

export function compilePrompt(input: {
    design: DesignCard;
    lockedFields: DesignFieldKey[];
    references: ReferenceBinding[];
}): CompiledPrompt {
    const { design, lockedFields, references } = input;
    const lines: string[] = [];

    lines.push(`【主体】${design.subject || '未填写'}`);
    lines.push(`【角色版本】${design.subjectVersion || '未指定，按设计卡假设'}`);
    lines.push(`【场景意图】${design.sceneIntent || '未填写'}`);
    lines.push(`【构图与人物占比】${design.composition || '未填写'}`);
    lines.push(`【动作与视角】${design.actionView || '未填写'}`);
    lines.push(`【色彩与光线】${design.colorLight || '未填写'}`);
    lines.push(`【绘画语言】${design.artStyle || '未填写'}`);
    lines.push(`【画幅比例】${design.aspectRatio || '16:9'}`);
    lines.push(`【必须保留】${design.mustKeep.length > 0 ? design.mustKeep.join('；') : '无'}`);
    lines.push(`【允许变化】${design.mayChange.length > 0 ? design.mayChange.join('；') : '无'}`);

    if (lockedFields.length > 0) {
        lines.push(
            `【锁定要求】${lockedFields
                .map((field) => DESIGN_FIELD_LABELS[field])
                .join('、')}为本次锁定项，生成时不得改变；若与镜头/动作产生冲突，优先保持锁定项。`
        );
    }

    if (references.length > 0) {
        lines.push('【参考图使用顺序】以下顺序就是实际传入的图像顺序，只借用各自说明的部分：');
        const ordered = [...references].sort((a, b) => a.position - b.position);
        ordered.forEach((binding, index) => {
            const purpose = REFERENCE_PURPOSE_LABELS[binding.purpose];
            const borrow = binding.borrow || '仅按用途借用可见特征';
            const exclude = binding.exclude || '不要照抄用途之外的内容';
            lines.push(`${index + 1}. 参考图 ${index + 1}（${binding.asset.originalName}）用途：${purpose}。借用：${borrow}。不借用：${exclude}。`);
        });
    } else {
        lines.push('【参考图使用顺序】本次没有参考图，仅按设计卡生成。');
    }

    lines.push('【一致性要求】以上所有条目属于同一次生成，不要自行增加互相矛盾的角色版本、服装或空间关系。');

    const avoidParts: string[] = [];
    if (lockedFields.length > 0) {
        avoidParts.push(`避免改变锁定的${lockedFields.map((field) => DESIGN_FIELD_LABELS[field]).join('、')}`);
    }
    if (references.length > 0) {
        const excludes = references
            .filter((binding) => binding.exclude.trim())
            .map((binding) => `${binding.asset.originalName}：${binding.exclude.trim()}`);
        if (excludes.length > 0) avoidParts.push(`避免借用参考图中明确排除的部分（${excludes.join('；')}）`);
    }
    avoidParts.push('避免照抄任何参考图的完整构图或立绘站姿');
    avoidParts.push('避免出现多余肢体、断裂结构、文字水印或与原设定冲突的服装');
    avoidParts.push('避免把不同参考图的内容拼贴成互不相干的空间');

    const acceptanceParts: string[] = [];
    if (design.mustKeep.length > 0) acceptanceParts.push(...design.mustKeep);
    if (lockedFields.length > 0) {
        acceptanceParts.push(...lockedFields.map((field) => `${DESIGN_FIELD_LABELS[field]}与设计卡一致`));
    }
    acceptanceParts.push('人物尺度与构图符合设计卡', '参考图用途与顺序正确', '画面风格与设计卡一致');

    return {
        text: lines.join('\n'),
        avoid: avoidParts.join('；'),
        acceptance: [...new Set(acceptanceParts)].join('；')
    };
}
