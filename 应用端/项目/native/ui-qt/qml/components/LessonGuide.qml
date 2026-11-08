import QtQuick
import QtQuick.Layouts

ColumnLayout {
    id: guide
    required property QtObject ds
    required property var lesson
    readonly property var content: lesson ? (lesson.content || {}) : ({})
    spacing: ds.s16

    Text {
        objectName: "workspaceGuideTitle"
        Layout.fillWidth: true
        text: guide.lesson ? guide.lesson.title : "未选择课程"
        textFormat: Text.PlainText
        wrapMode: Text.WrapAnywhere
        color: guide.ds.ink
        font.family: guide.ds.ui
        font.pixelSize: 16
        font.weight: Font.DemiBold
    }
    Repeater {
        model: [
            { title: "目标", value: guide.content.objective || "" },
            { title: "先备知识", value: (guide.content.prerequisites || []).join("\n") },
            { title: "讲解", value: (guide.content.explanation || []).join("\n") },
            { title: "例子与反例", value: (guide.content.examples || []).map(function(example) {
                return example.good + (example.bad ? "\n反例：" + example.bad : "")
                       + (example.why ? "\n" + example.why : "");
            }).join("\n\n") },
            { title: "跟做步骤", value: (guide.content.guidedSteps || []).join("\n") },
            { title: "独立题", value: guide.content.exercise || "" },
            { title: "变式题", value: guide.content.variant || "" },
            { title: "项目任务", value: guide.content.projectTask || "" },
            { title: "常见错误", value: (guide.content.mistakes || []).join("\n") },
            { title: "运行验证", value: guide.content.runCommand || "" },
            { title: "完成证据", value: guide.content.completion || "" },
            { title: "验收标准", value: (guide.content.acceptanceCriteria || []).join("\n") }
        ]
        delegate: ColumnLayout {
            required property var modelData
            Layout.fillWidth: true
            spacing: guide.ds.s6
            Text {
                Layout.fillWidth: true
                text: modelData.title
                color: guide.ds.accent
                font.family: guide.ds.ui
                font.pixelSize: 12
                font.weight: Font.DemiBold
            }
            Text {
                Layout.fillWidth: true
                text: modelData.value || "暂无内容"
                textFormat: Text.PlainText
                wrapMode: Text.WrapAnywhere
                color: modelData.value ? guide.ds.ink : guide.ds.muted
                font.family: guide.ds.ui
                font.pixelSize: 13
            }
        }
    }
}
