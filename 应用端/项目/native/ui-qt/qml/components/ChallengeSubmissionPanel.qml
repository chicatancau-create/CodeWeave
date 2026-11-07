import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: panel
    objectName: "challengeSubmissionPanel"
    required property QtObject ds
    readonly property string challengeId: uiShell.selectedChallenge.id || ""
    readonly property bool external: uiShell.selectedChallenge.runner === "external"
    readonly property bool busy: uiShell.challengeHistoryBusy || uiShell.accountBusy
    spacing: ds.s12

    function statusLabel(status) {
        if (status === "passed") return "自动判定通过";
        if (status === "verified") return "人工确认通过";
        if (status === "rejected") return "人工标记不通过";
        return "待人工确认";
    }

    onChallengeIdChanged: {
        evidence.text = "";
        environment.text = "";
        command.text = "";
        summary.text = "";
        artifact.text = "";
        date.text = Qt.formatDate(new Date(), "yyyy-MM-dd");
    }
    Rectangle { Layout.fillWidth: true; height: 1; color: panel.ds.line }
    Text {
        text: "01  本地草稿与证据"
        color: panel.ds.accent; font.family: panel.ds.ui; font.pixelSize: 13
    }
    Text {
        Layout.fillWidth: true
        visible: panel.external
        text: "外部证据待人工确认，提交时不计入已通过。"
        color: panel.ds.warning; font.family: panel.ds.ui; font.pixelSize: 13
        wrapMode: Text.WordWrap
    }
    ColumnLayout {
        Layout.fillWidth: true
        visible: panel.external
        spacing: panel.ds.s8
        Text { text: "执行环境"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 13 }
        ShellField { id: environment; objectName: "challengeExternalEnvironment"; ds: panel.ds; Layout.fillWidth: true; enabled: !panel.busy; maximumLength: 600 }
        Text { text: "执行命令"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 13 }
        ShellField { id: command; objectName: "challengeExternalCommand"; ds: panel.ds; Layout.fillWidth: true; enabled: !panel.busy; maximumLength: 600 }
        Text { text: "结果摘要"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 13 }
        TextArea {
            id: summary
            objectName: "challengeExternalSummary"
            Layout.fillWidth: true; Layout.preferredHeight: 96
            enabled: !panel.busy; wrapMode: TextEdit.WrapAnywhere; selectByMouse: true
            color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 13
            background: Rectangle { color: panel.ds.inset; border.color: panel.ds.lineStrong }
        }
        Text { text: "日志 / 截图引用（可选）"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 13 }
        ShellField { id: artifact; objectName: "challengeExternalArtifact"; ds: panel.ds; Layout.fillWidth: true; enabled: !panel.busy; maximumLength: 300 }
        Text { text: "复现日期"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 13 }
        ShellField {
            id: date; objectName: "challengeExternalDate"; ds: panel.ds
            Layout.fillWidth: true; enabled: !panel.busy; maximumLength: 10
            text: Qt.formatDate(new Date(), "yyyy-MM-dd")
        }
    }
    Text {
        visible: !panel.external
        text: "完成证据说明"
        color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 13
    }
    TextArea {
        id: evidence
        objectName: "challengeEvidenceNote"
        visible: !panel.external
        Layout.fillWidth: true; Layout.preferredHeight: 96
        enabled: !panel.busy; selectByMouse: true; wrapMode: TextEdit.WrapAnywhere
        color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 13
        background: Rectangle { color: panel.ds.inset; border.color: panel.ds.lineStrong }
    }
    QuietButton {
        objectName: "challengeSubmit"
        ds: panel.ds
        Layout.alignment: Qt.AlignRight
        label: panel.external ? "提交证据（待人工确认）" : "提交答案"
        enabled: uiShell.hasActiveAccount && !panel.busy && !uiShell.challengeRunBusy
                 && !uiShell.operationBusy && !uiShell.executionBusy
                 && (panel.external ? environment.text.trim() !== "" && command.text.trim() !== ""
                        && summary.text.trim() !== "" && date.text.trim() !== ""
                     : uiShell.challengeRunResult.passed === true && evidence.text.trim() !== "")
        onClicked: uiShell.submitChallenge(evidence.text, {
            environment: environment.text, command: command.text, resultSummary: summary.text,
            artifactRef: artifact.text, reproducedOn: date.text
        })
    }
    Text {
        visible: !uiShell.hasActiveAccount
        text: "登录后可提交挑战。"
        color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 13
    }
    Rectangle { Layout.fillWidth: true; height: 1; color: panel.ds.line }
    RowLayout {
        Layout.fillWidth: true
        Text { text: "02  已提交记录"; color: panel.ds.accent; font.family: panel.ds.ui; font.pixelSize: 13 }
        Item { Layout.fillWidth: true }
        QuietButton { objectName: "challengeHistoryRefresh"; ds: panel.ds; label: "刷新"; enabled: uiShell.hasActiveAccount && !panel.busy; onClicked: uiShell.refreshChallengeHistory() }
        BusyIndicator { Layout.preferredWidth: 24; Layout.preferredHeight: 24; visible: panel.busy; running: visible }
    }
    Text {
        objectName: "challengeHistoryStatus"
        Layout.fillWidth: true
        text: uiShell.challengeHistoryStatus
        visible: text !== ""
        color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 13
        wrapMode: Text.WrapAnywhere
    }
    Text {
        visible: !panel.busy && uiShell.challengeHistory.length === 0
        text: "暂无提交记录"
        color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 13
    }
    Repeater {
        model: uiShell.challengeHistory
        delegate: ColumnLayout {
            id: submission
            required property var modelData
            required property int index
            Layout.fillWidth: true
            spacing: panel.ds.s8
            Text {
                objectName: "challengeSubmissionStatus-" + submission.index
                Layout.fillWidth: true
                text: panel.statusLabel(submission.modelData.status) + " · " + submission.modelData.submittedAt
                color: submission.modelData.status === "passed" || submission.modelData.status === "verified"
                       ? panel.ds.success : submission.modelData.status === "rejected" ? panel.ds.danger : panel.ds.warning
                font.family: panel.ds.ui; font.pixelSize: 13; wrapMode: Text.WrapAnywhere
            }
            Text {
                objectName: "challengeSubmissionEvidence-" + submission.index
                Layout.fillWidth: true
                text: submission.modelData.evidence
                textFormat: Text.PlainText
                color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 13; wrapMode: Text.WrapAnywhere
            }
            Text {
                Layout.fillWidth: true
                text: "执行等级：" + submission.modelData.tier + " · 判定口径："
                      + (submission.modelData.judgeMode || "外部证据人工确认")
                color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
            }
            Text {
                visible: submission.modelData.reviewedAt !== ""
                Layout.fillWidth: true
                text: "复核时间：" + submission.modelData.reviewedAt
                      + (submission.modelData.observation ? " · " + ({completed: "已完成", "partially-completed": "部分完成", attempted: "已尝试"})[submission.modelData.observation] : "")
                color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
            }
            ColumnLayout {
                visible: submission.modelData.status === "submitted"
                Layout.fillWidth: true
                ComboBox {
                    id: observation
                    objectName: "challengeObservation-" + submission.index
                    Layout.fillWidth: true
                    enabled: !panel.busy
                    model: ["不标注", "已完成", "部分完成", "已尝试"]
                    Accessible.name: "学习状态标注"
                    contentItem: Text {
                        leftPadding: panel.ds.s8
                        text: observation.displayText
                        color: panel.ds.ink
                        font.family: panel.ds.ui
                        font.pixelSize: 13
                        verticalAlignment: Text.AlignVCenter
                        elide: Text.ElideRight
                    }
                    background: Rectangle {
                        color: panel.ds.inset
                        border.color: observation.activeFocus ? panel.ds.accent : panel.ds.lineStrong
                    }
                }
                QuietButton {
                    objectName: "challengeVerify-" + submission.index
                    ds: panel.ds; label: "确认通过（人工复核）"; enabled: !panel.busy
                    onClicked: uiShell.reviewChallengeSubmission(submission.modelData.id, true,
                        ["", "completed", "partially-completed", "attempted"][observation.currentIndex])
                }
                QuietButton {
                    objectName: "challengeReject-" + submission.index
                    ds: panel.ds; label: "标记不通过"; enabled: !panel.busy
                    onClicked: uiShell.reviewChallengeSubmission(submission.modelData.id, false,
                        ["", "completed", "partially-completed", "attempted"][observation.currentIndex])
                }
            }
            Rectangle { Layout.fillWidth: true; height: 1; color: panel.ds.line }
        }
    }
}
