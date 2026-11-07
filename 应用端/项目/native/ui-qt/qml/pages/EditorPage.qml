import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"

Item {
    property var hostRoot
    property QtObject ds
    id: editorPage
    property int activeWorkspacePane: 0

        ColumnLayout {
            anchors.fill: parent
            spacing: ds.s12

            Rectangle {
                Layout.fillWidth: true
                visible: hostRoot.isErrorStatus(uiShell.contentStatus)
                implicitHeight: statusRow.implicitHeight + ds.s16
                radius: ds.radiusSm
                color: ds.bannerBg
                border.color: ds.warning
                RowLayout {
                    id: statusRow
                    anchors.fill: parent
                    anchors.margins: ds.s8
                    Text {
                        Layout.fillWidth: true
                        text: uiShell.contentStatus
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                    }
                    QuietButton {
                        ds: editorPage.ds
                        label: "重试保存"
                        enabled: uiShell.hasSelectedContent && !uiShell.draftSaving
                        onClicked: uiShell.saveDraft()
                    }
                    QuietButton { ds: editorPage.ds; label: "知道了"; onClicked: uiShell.dismissContentStatus() }
                }
            }

            // Workspace header
            RowLayout {
                Layout.fillWidth: true
                spacing: ds.s12
                QuietButton { ds: editorPage.ds; label: "←"; onClicked: uiShell.selectPage("学习") }
                ColumnLayout {
                    spacing: 2
                    Text {
                        text: hostRoot.selectedLesson
                              ? ((hostRoot.selectedLesson.label || hostRoot.selectedLesson.id || "")
                                 + " · " + (hostRoot.selectedLesson.title || "未命名课程"))
                              : "未选择课程"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 20
                        font.weight: Font.DemiBold
                    }
                    Text {
                        text: (hostRoot.selectedLesson && hostRoot.selectedLesson.level
                               ? hostRoot.selectedLesson.level : "等级待定")
                              + " · "
                              + (hostRoot.selectedLesson && hostRoot.selectedLesson.duration
                                 ? hostRoot.selectedLesson.duration : "时长待定")
                              + " · "
                              + (uiShell.starterLanguage !== "" ? uiShell.starterLanguage : "无代码练习")
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 12
                    }
                }
                Item { Layout.fillWidth: true }
                QuietButton {
                    ds: editorPage.ds
                    label: uiShell.draftDirty ? "保存草稿 *" : "保存草稿"
                    enabled: uiShell.hasSelectedContent && !uiShell.draftPersistenceBlocked
                    onClicked: uiShell.saveDraft()
                }
                QuietButton {
                    ds: editorPage.ds
                    label: "记录实践证据"
                    onClicked: hostRoot.openEvidenceDialog()
                }
                QuietButton {
                    ds: editorPage.ds
                    label: "重置"
                    enabled: uiShell.hasSelectedContent
                    onClicked: uiShell.resetDraftCode()
                }
            }

            // .cw-pane-nav
            RowLayout {
                Layout.fillWidth: true
                spacing: ds.s16
                Repeater {
                    model: ["代码", "程序状态", "控制台"]
                    delegate: ColumnLayout {
                        required property var modelData
                        required property int index
                        spacing: 2
                        QuietButton {
                            id: paneButton
                            ds: editorPage.ds
                            label: (index + 1 < 10 ? "0" : "") + (index + 1) + "  " + modelData
                            onClicked: {
                                editorPage.activeWorkspacePane = index;
                                if (index === 0) codeEditor.forceActiveFocus();
                                else if (index === 1) stagePanel.forceActiveFocus();
                                else outputArea.forceActiveFocus();
                            }
                            Accessible.name: "工作台分区：" + modelData
                        }
                        Rectangle {
                            width: paneButton.width
                            height: 2
                            color: editorPage.activeWorkspacePane === index ? ds.accent : "transparent"
                        }
                    }
                }
                Item { Layout.fillWidth: true }
            }
            Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }

            // Editor + run stage
            RowLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: ds.s16

                // LEFT — code pane
                Rectangle {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.horizontalStretchFactor: 5
                    radius: ds.radius
                    color: ds.page
                    border.color: ds.line
                    border.width: 1
                    clip: true

                    ColumnLayout {
                        anchors.fill: parent
                        spacing: 0

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: 40
                            color: ds.chrome
                            RowLayout {
                                anchors { fill: parent; leftMargin: ds.s14; rightMargin: ds.s14 }
                                spacing: ds.s8
                                Text {
                                    text: "代码"
                                    color: ds.ink
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                    font.weight: Font.DemiBold
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Item { Layout.fillWidth: true }
                                Text {
                                    text: uiShell.draftSaving ? "保存中…"
                                          : (uiShell.draftDirty ? "未保存" : "已保存")
                                    color: uiShell.draftDirty ? ds.warning : ds.success
                                    font.family: ds.mono
                                    font.pixelSize: 11
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                            Rectangle {
                                anchors {
                                    left: parent.left
                                    right: parent.right
                                    bottom: parent.bottom
                                }
                                height: 1
                                color: ds.line
                            }
                        }

                        // web div.code-editor
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            color: ds.editorBg

                            RowLayout {
                                anchors.fill: parent
                                spacing: 0

                                // div.line-numbers — 44px
                                Item {
                                    Layout.preferredWidth: 44
                                    Layout.fillHeight: true
                                    Text {
                                        anchors {
                                            fill: parent
                                            topMargin: ds.s12
                                            rightMargin: ds.s10
                                        }
                                        text: {
                                            const n = (uiShell.draftCode + "\n").split("\n").length;
                                            let t = "";
                                            for (let i = 1; i < n; ++i) t += i + "\n";
                                            return t;
                                        }
                                        color: ds.muted
                                        font.family: ds.mono
                                        font.pixelSize: 13
                                        horizontalAlignment: Text.AlignRight
                                        lineHeight: 1.4
                                        Accessible.ignored: true
                                    }
                                }
                                Rectangle {
                                    Layout.preferredWidth: 1
                                    Layout.fillHeight: true
                                    color: ds.line
                                }
                                ScrollView {
                                    Layout.fillWidth: true
                                    Layout.fillHeight: true
                                    ScrollBar.horizontal.policy: ScrollBar.AsNeeded
                                    TextArea {
                                        id: codeEditor
                                        objectName: "codeEditor"
                                        text: uiShell.draftCode
                                        readOnly: uiShell.starterLanguage.length === 0
                                                  || uiShell.contentBusy
                                                  || uiShell.draftPersistenceBlocked
                                        wrapMode: TextArea.NoWrap
                                        color: ds.ink
                                        selectionColor: ds.accent
                                        selectedTextColor: ds.inkOnAccent
                                        font.family: ds.mono
                                        font.pixelSize: 13
                                        topPadding: ds.s12
                                        leftPadding: ds.s12
                                        background: null
                                        onTextChanged: {
                                            if (text !== uiShell.draftCode)
                                                uiShell.updateDraftCode(text);
                                        }
                                        Accessible.name: "代码编辑器"
                                    }
                                }
                            }
                        }

                        // div.code-footer
                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: 40
                            color: ds.chrome
                            RowLayout {
                                anchors { fill: parent; leftMargin: ds.s14; rightMargin: ds.s14 }
                                spacing: ds.s8
                                Text {
                                    text: {
                                        const before = codeEditor.text.slice(0, codeEditor.cursorPosition);
                                        const lines = before.split("\n");
                                        return "行 " + lines.length + "，列 "
                                            + (lines[lines.length - 1].length + 1);
                                    }
                                    color: ds.muted
                                    font.family: ds.mono
                                    font.pixelSize: 12
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Item { Layout.fillWidth: true }
                                Text {
                                    text: uiShell.starterLanguage || "—"
                                    color: ds.faint
                                    font.family: ds.mono
                                    font.pixelSize: 12
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                            Rectangle {
                                anchors { left: parent.left; right: parent.right; top: parent.top }
                                height: 1
                                color: ds.line
                            }
                        }
                    }
                }

                // RIGHT — run stage + output
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.horizontalStretchFactor: 5
                    spacing: ds.s12

                    // div.rs-stage
                    Rectangle {
                        id: stagePanel
                        focus: true
                        Accessible.name: "程序状态图区域"
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        radius: ds.radius
                        color: ds.page
                        border.color: ds.line
                        border.width: 1

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: ds.s14
                            spacing: ds.s10

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: ds.s8
                                Text {
                                    text: uiShell.executionBusy ? "运行中" : "程序状态图"
                                    color: ds.ink
                                    font.family: ds.mono
                                    font.pixelSize: 13
                                    font.weight: Font.DemiBold
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Item { Layout.fillWidth: true }
                                Rectangle {
                                    implicitWidth: counterText.implicitWidth + ds.s12
                                    implicitHeight: 20
                                    radius: 3
                                    color: "transparent"
                                    border.color: ds.accentRing
                                    border.width: 1
                                    Text {
                                        id: counterText
                                        anchors.centerIn: parent
                                        text: "执行轨迹待接入"
                                        color: ds.accent
                                        font.family: ds.mono
                                        font.pixelSize: 11
                                    }
                                }
                            }

                            // div.rs-canvas-wrap — grid paper
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                radius: ds.radiusSm
                                color: ds.stageBg
                                border.color: ds.line
                                border.width: 1
                                clip: true

                                Canvas {
                                    anchors.fill: parent
                                    onPaint: {
                                        const ctx = getContext("2d");
                                        ctx.clearRect(0, 0, width, height);
                                        ctx.strokeStyle = "#182438";
                                        ctx.lineWidth = 1;
                                        for (let x = 0; x <= width; x += 20) {
                                            ctx.beginPath();
                                            ctx.moveTo(x + 0.5, 0);
                                            ctx.lineTo(x + 0.5, height);
                                            ctx.stroke();
                                        }
                                        for (let y = 0; y <= height; y += 20) {
                                            ctx.beginPath();
                                            ctx.moveTo(0, y + 0.5);
                                            ctx.lineTo(width, y + 0.5);
                                            ctx.stroke();
                                        }
                                    }
                                }

                                Repeater {
                                    model: hostRoot.selectedLesson ? (hostRoot.selectedLesson.flow || []) : []
                                    delegate: Item {
                                        required property var modelData
                                        required property int index
                                        x: 16 + (index % 4) * 118
                                        y: 20 + Math.floor(index / 4) * 74
                                        width: 96
                                        height: 50

                                        Rectangle {
                                            anchors.fill: parent
                                            radius: modelData.kind === "decision" ? 6 : 6
                                            rotation: modelData.kind === "decision" ? 45 : 0
                                            color: uiShell.executionBusy && index === 0
                                                   ? ds.accentFill : "#121e30"
                                            border.color: uiShell.executionBusy && index === 0
                                                          ? ds.accent : "#44566f"
                                            border.width: 2
                                        }
                                        Column {
                                            anchors.centerIn: parent
                                            spacing: 1
                                            Text {
                                                anchors.horizontalCenter: parent.horizontalCenter
                                                text: modelData.label || ""
                                                color: ds.ink
                                                font.family: ds.ui
                                                font.pixelSize: 11
                                                width: 84
                                                horizontalAlignment: Text.AlignHCenter
                                                elide: Text.ElideRight
                                            }
                                            Text {
                                                anchors.horizontalCenter: parent.horizontalCenter
                                                visible: modelData.kind !== "decision"
                                                text: modelData.kind || ""
                                                color: ds.faint
                                                font.family: ds.mono
                                                font.pixelSize: 9
                                            }
                                        }
                                    }
                                }

                                Text {
                                    anchors.centerIn: parent
                                    visible: !hostRoot.selectedLesson || (hostRoot.selectedLesson.flow || []).length === 0
                                    text: "选择课程后显示程序状态图"
                                    color: ds.faint
                                    font.family: ds.ui
                                    font.pixelSize: 12
                                }
                            }

                            Rectangle {
                                Layout.fillWidth: true
                                height: 1
                                color: ds.line
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: ds.s8
                                CheckBox {
                                    text: "独立完成"
                                    checked: uiShell.independentAttempt
                                    enabled: uiShell.hasSelectedContent && !uiShell.contentBusy
                                    onToggled: uiShell.independentAttempt = checked
                                    Accessible.name: "标记为独立完成"
                                }
                                PrimaryButton {
                                    ds: editorPage.ds
                                    label: uiShell.executionBusy ? "取消" : "运行"
                                    enabled: uiShell.hasActiveAccount
                                             && uiShell.starterLanguage.length > 0
                                             && !uiShell.contentBusy
                                    onClicked: uiShell.executionBusy
                                               ? uiShell.cancelExecution()
                                               : uiShell.runCode()
                                }
                                QuietButton {
                                    ds: editorPage.ds
                                    label: "暂停"
                                    enabled: uiShell.executionBusy && !uiShell.executionPaused
                                    onClicked: uiShell.pauseExecution()
                                }
                                QuietButton {
                                    ds: editorPage.ds
                                    label: "继续"
                                    enabled: uiShell.executionBusy && uiShell.executionPaused
                                    onClicked: uiShell.resumeExecution()
                                }
                                QuietButton {
                                    ds: editorPage.ds
                                    label: "单步"
                                    enabled: uiShell.executionBusy && uiShell.executionPaused
                                    onClicked: uiShell.stepExecution()
                                }
                                Item { Layout.fillWidth: true }
                            }
                        }
                    }

                    // Output strip
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 130
                        radius: ds.radius
                        color: ds.panel
                        border.color: ds.line
                        border.width: 1
                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: ds.s12
                            spacing: ds.s6
                            Text {
                                text: "输出"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 12
                                font.weight: Font.DemiBold
                            }
                            ScrollView {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                                TextArea {
                                    id: outputArea
                                    focus: true
                                    text: uiShell.executionOutput
                                    readOnly: true
                                    wrapMode: TextArea.Wrap
                                    color: ds.success
                                    font.family: ds.mono
                                    font.pixelSize: 12
                                    background: null
                                    placeholderText: "运行后显示输出"
                                    placeholderTextColor: ds.faint
                                    Accessible.name: "执行输出"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
