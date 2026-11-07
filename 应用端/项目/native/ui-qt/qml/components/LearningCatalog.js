.pragma library

function subjectLabel(lesson) {
    return lesson.languageLabel || lesson.language || "未标注科目";
}

function subjectSummary(lessons, label) {
    const selected = lessons.filter(function(lesson) { return subjectLabel(lesson) === label; });
    return {
        count: selected.length,
        hasVault: selected.some(function(lesson) { return !!lesson.contentId; }),
        executable: selected.some(function(lesson) { return lesson.executable !== false; })
    };
}

function heldStateLabels(states) {
    if (!states) return [];
    return [
        ["read", "已阅读"], ["practiced", "已练习"], ["submittedEvidence", "已提交证据"],
        ["selfDeclaredPassed", "自评通过"], ["autoVerifiedPassed", "自动验证通过"], ["reviewMastered", "延迟复测掌握"]
    ].filter(function(item) { return states[item[0]] === true; }).map(function(item) { return item[1]; });
}

function holdsCompletion(states) {
    return !!states && (states.selfDeclaredPassed === true || states.autoVerifiedPassed === true
                        || states.reviewMastered === true);
}

function stageKey(lesson) {
    return String(lesson.stageId || lesson.label || "").trim();
}

function isNumberedStage(key) {
    return /^S[0-9]$/.test(key);
}

function sourceLabel(lesson) {
    if (lesson.contentId) return "资料库正式内容";
    if (lesson.legacy) return "旧内置课程 · 未迁入资料库";
    return "来源未标注";
}

function gapLabels(lesson) {
    const labels = [];
    if (!lesson.contentId && !lesson.legacy) labels.push("来源未标注");
    if (lesson.contentId && !(lesson.source && lesson.source.path)) labels.push("来源未定位");
    if (lesson.source && lesson.source.path && !lesson.source.verificationStatus) labels.push("核验状态未记录");
    if (lesson.contentId && !lesson.exercise) labels.push("无练习契约");
    if (!isNumberedStage(stageKey(lesson))) labels.push("未并入 S0—S9 编号阶段");
    return labels;
}

function stageGroups(lessons) {
    const groups = [];
    for (let i = 0; i < 10; i++) {
        const key = "S" + i;
        groups.push({ key: key, title: key, numbered: true, lessons: lessons.filter(function(lesson) {
            return stageKey(lesson) === key;
        }) });
    }
    const unnumbered = lessons.filter(function(lesson) { return !isNumberedStage(stageKey(lesson)); });
    if (unnumbered.length > 0) groups.push({ key: "unnumbered", title: "未并入编号阶段", numbered: false, lessons: unnumbered });
    return groups;
}

// Match the web ledger: only gaps between observed numbered stages are counted.
function stageGapCount(groups) {
    const observed = groups.filter(function(group) { return group.numbered && group.lessons.length > 0; });
    if (observed.length < 2) return 0;
    return Number(observed[observed.length - 1].key.slice(1)) - Number(observed[0].key.slice(1)) + 1 - observed.length;
}
