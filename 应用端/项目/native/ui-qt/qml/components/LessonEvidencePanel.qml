import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: panel
    required property QtObject ds
    readonly property var assessment: uiShell.lessonAssessment
    readonly property var states: uiShell.lessonEvidenceStates[uiShell.documentId] || ({})
    readonly property string documentId: uiShell.documentId
    readonly property bool busy: uiShell.operationBusy || uiShell.executionBusy || uiShell.contentBusy
                                 || uiShell.accountBusy || uiShell.draftSaving
    readonly property bool fieldsFilled: environment.text.trim() !== "" && command.text.trim() !== ""
                                         && summary.text.trim() !== "" && date.text.trim() !== ""
    spacing: ds.s12

    function resetForm() {
        environment.text = "";
        command.text = "";
        summary.text = "";
        artifact.text = "";
        date.text = Qt.formatDate(new Date(), "yyyy-MM-dd");
    }
    function fields() {
        return { environment: environment.text, command: command.text, resultSummary: summary.text,
                 artifactRef: artifact.text, reproducedOn: date.text };
    }
    onDocumentIdChanged: resetForm()
    Connections {
        target: uiShell
        function onAccountChanged() { panel.resetForm(); }
    }
    Text {
        Layout.fillWidth: true
        text: uiShell.hasSelectedContent ? uiShell.documentId : "尚未选择课程"
        textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere
        color: panel.ds.muted; font.family: panel.ds.mono; font.pixelSize: 12
    }
    Text {
        Layout.fillWidth: true
        text: panel.assessment.completed ? "本单元已完成（" + panel.assessment.completionSource + "）"
              : panel.assessment.buttonLabel
        textFormat: Text.PlainText; wrapMode: Text.WordWrap
        color: panel.assessment.completed ? panel.ds.success : panel.ds.ink
        font.family: panel.ds.ui; font.pixelSize: 14
    }
    Text {
        Layout.fillWidth: true
        visible: panel.assessment.external === true
        text: "外部证据提交后待人工确认；标记完成只代表学习者自行声明，系统未验证真实环境。"
        color: panel.ds.warning; font.family: panel.ds.ui; font.pixelSize: 12
        wrapMode: Text.WordWrap
    }
    ColumnLayout {
        Layout.fillWidth: true
        visible: panel.assessment.external === true
        spacing: panel.ds.s6
        Text { text: "执行环境"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 12 }
        ShellField { id: environment; objectName: "lessonExternalEnvironment"; ds: panel.ds; Layout.fillWidth: true; enabled: !panel.busy; maximumLength: 600; Accessible.name: "执行环境" }
        Text { text: "执行命令"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 12 }
        ShellField { id: command; objectName: "lessonExternalCommand"; ds: panel.ds; Layout.fillWidth: true; enabled: !panel.busy; maximumLength: 600; Accessible.name: "执行命令" }
        Text { text: "结果摘要"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 12 }
        TextArea {
            id: summary; objectName: "lessonExternalSummary"
            Layout.fillWidth: true; Layout.preferredHeight: 88
            enabled: !panel.busy; selectByMouse: true; wrapMode: TextEdit.WrapAnywhere
            color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 12
            background: Rectangle { color: panel.ds.inset; border.color: panel.ds.lineStrong }
            Accessible.name: "结果摘要"
        }
        Text { text: "日志 / 截图引用（可选）"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 12 }
        ShellField { id: artifact; objectName: "lessonExternalArtifact"; ds: panel.ds; Layout.fillWidth: true; enabled: !panel.busy; maximumLength: 300; Accessible.name: "日志或截图引用" }
        Text { text: "复现日期"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 12 }
        ShellField {
            id: date; objectName: "lessonExternalDate"; ds: panel.ds
            Layout.fillWidth: true; enabled: !panel.busy; maximumLength: 10
            text: Qt.formatDate(new Date(), "yyyy-MM-dd"); Accessible.name: "复现日期"
        }
        QuietButton {
            objectName: "lessonSubmitExternal"; ds: panel.ds
            label: "提交外部证据（待确认）"
            enabled: panel.assessment.ready && uiShell.hasActiveAccount && !panel.busy && panel.fieldsFilled
            onClicked: uiShell.saveExternalEvidence(environment.text, command.text, summary.text, artifact.text, date.text)
        }
    }
    Repeater {
        model: panel.assessment.cases || []
        delegate: Text {
            required property var modelData
            Layout.fillWidth: true
            text: (modelData.matched ? "命中 · " : "未命中 · ") + modelData.expected
                  + (modelData.reason ? "\n" + modelData.reason : "")
            textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere
            color: modelData.matched ? panel.ds.success : panel.ds.warning
            font.family: panel.ds.mono; font.pixelSize: 12
        }
    }
    Text {
        Layout.fillWidth: true
        visible: (panel.assessment.extraLines || []).length > 0
        text: "多印且未匹配的行：" + (panel.assessment.extraLines || []).join(" / ")
        textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere
        color: panel.ds.muted; font.family: panel.ds.mono; font.pixelSize: 12
    }
    Text {
        Layout.fillWidth: true
        visible: panel.assessment.ready && !panel.assessment.external && (panel.assessment.cases || []).length === 0
        text: "本课没有结构化验收点，完成记录为学习者自行声明。"
        color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
    }
    QuietButton {
        objectName: "lessonComplete"; ds: panel.ds
        label: panel.assessment.buttonLabel || "课程契约未就绪"
        enabled: panel.assessment.canComplete === true && (!panel.assessment.external || panel.fieldsFilled)
        onClicked: uiShell.completeLesson(panel.fields())
    }
    Rectangle { Layout.fillWidth: true; height: 1; color: panel.ds.line }
    Text {
        text: uiShell.lessonEvidenceReady ? "本单元证据状态" : "本单元证据状态尚未读取"
        color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 14
    }
    Repeater {
        model: [
            { key: "read", label: "已阅读", meaning: "学习者标记读过正文，非完成证明" },
            { key: "practiced", label: "已练习", meaning: "本机真实跑完过一次，非完成证明" },
            { key: "submittedEvidence", label: "已提交证据", meaning: "结构化外部证据，系统未比对" },
            { key: "selfDeclaredPassed", label: "自评通过", meaning: "学习者自行声明，系统未比对输出" },
            { key: "autoVerifiedPassed", label: "自动验证通过", meaning: "该题验收点整行命中" },
            { key: "reviewMastered", label: "延迟复测掌握", meaning: "至少一次到期复测判为通过" }
        ]
        delegate: RowLayout {
            required property var modelData
            readonly property bool held: panel.states[modelData.key] === true
            Layout.fillWidth: true; spacing: panel.ds.s12
            Text {
                Layout.preferredWidth: 142
                text: (uiShell.lessonEvidenceReady ? (parent.held ? "已记录 · " : "未记录 · ") : "未知 · ") + modelData.label
                color: parent.held ? panel.ds.success : panel.ds.muted
                font.family: panel.ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
            }
            Text {
                Layout.fillWidth: true; text: modelData.meaning
                color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
            }
        }
    }
    RowLayout {
        Layout.fillWidth: true; spacing: panel.ds.s8
        QuietButton {
            objectName: "lessonMarkRead"; ds: panel.ds; label: panel.states.read ? "已标记阅读" : "标记已阅读"
            enabled: panel.assessment.canMarkRead === true
            onClicked: uiShell.markLessonRead()
        }
        QuietButton {
            objectName: "lessonEvidenceRefresh"; ds: panel.ds; label: "刷新证据"
            enabled: uiShell.hasActiveAccount && !panel.busy
            onClicked: uiShell.refreshReviewSummary()
        }
        MotionAwareBusyIndicator {
            ds: panel.ds
            implicitWidth: 24; implicitHeight: 24
            busy: panel.busy
            accessibleName: "正在更新学习证据"
        }
    }
    Text {
        objectName: "lessonEvidenceStatus"
        Layout.fillWidth: true; visible: text.length > 0
        text: uiShell.operationStatus; textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere
        color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 12
        Accessible.role: Accessible.AlertMessage
    }
}
