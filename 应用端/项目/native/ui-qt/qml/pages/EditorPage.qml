import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"
import "../components/ExecutionStage.js" as Stage

Item {
    property var hostRoot
    property QtObject ds
    id: editorPage
    objectName: "editorPageRoot"
    property int activeWorkspacePane: 0
    property bool consoleOutputCleared: false
    property string consoleCopyStatus: ""
    property string evidenceAccountRequested: ""
    property bool showExecutionTrace: false
    property bool codeMode: false
    property string modeDocumentId: ""
    function syncCodeMode() {
        if (modeDocumentId === uiShell.documentId) return;
        modeDocumentId = uiShell.documentId;
        codeMode = uiShell.starterLanguage.length > 0
                   || (currentLesson !== null && (currentLesson.flow || []).length > 0);
        courseGuide.close();
    }
    Component.onCompleted: syncCodeMode()
    readonly property var currentLesson: {
        for (const lesson of uiShell.lessonMeta)
            if (lesson.id === uiShell.documentId) return lesson;
        return null;
    }
    readonly property string currentTitle: {
        const index = uiShell.publishedIds.indexOf(uiShell.documentId);
        return currentLesson ? (currentLesson.title || uiShell.documentId)
               : index >= 0 ? uiShell.publishedTitles[index] : "未选择课程";
    }
    function revealItem(item) {
        const top = item.mapToItem(workspaceContent, 0, 0).y;
        workspaceScroll.contentItem.contentY = Math.max(0, Math.min(top,
            workspaceScroll.contentItem.contentHeight - workspaceScroll.availableHeight));
    }
    function revealExecutionTrace() { revealItem(stagePanel); }

    Connections {
        target: uiShell
        function onSelectedContentChanged() { Qt.callLater(editorPage.syncCodeMode); }
        function onAccountChanged() { editorPage.evidenceAccountRequested = ""; }
        function onExecutionTraceChanged() {
            editorPage.showExecutionTrace = (uiShell.executionTrace.events || []).length > 0;
        }
        function onExecutionOutputChanged() {
            editorPage.consoleOutputCleared = false;
            editorPage.consoleCopyStatus = "";
        }
    }
    Timer {
        interval: 100
        repeat: true
        running: editorPage.visible && uiShell.hasActiveAccount && !uiShell.lessonEvidenceReady
                 && editorPage.evidenceAccountRequested !== uiShell.activeAccountId
        onTriggered: {
            if (uiShell.accountBusy || uiShell.contentBusy || uiShell.operationBusy || uiShell.executionBusy
                    || uiShell.draftSaving || uiShell.challengeHistoryBusy) return;
            editorPage.evidenceAccountRequested = uiShell.activeAccountId;
            uiShell.refreshReviewSummary();
        }
    }

        ScrollView {
            id: workspaceScroll
            anchors.fill: parent
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

        ColumnLayout {
            id: workspaceContent
            width: workspaceScroll.availableWidth
            height: Math.max(workspaceScroll.availableHeight, implicitHeight)
            spacing: ds.s12

            Rectangle {
                objectName: "workspaceSaveError"
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
                        objectName: "workspaceRetrySave"
                        ds: editorPage.ds
                        label: "重试保存"
                        enabled: uiShell.hasSelectedContent && !uiShell.draftSaving
                        onClicked: uiShell.saveDraft()
                    }
                    QuietButton { objectName: "workspaceDismissError"; ds: editorPage.ds; label: "知道了"; onClicked: uiShell.dismissContentStatus() }
                }
            }

            // Workspace header
            RowLayout {
                Layout.fillWidth: true
                spacing: ds.s12
                QuietButton {
                    objectName: "workspaceBack"
                    ds: editorPage.ds; label: "←"
                    onClicked: uiShell.selectPage("学习")
                    Accessible.name: "返回课程列表"
                    ToolTip.visible: backHover.hovered
                    ToolTip.text: "返回课程列表"
                    HoverHandler { id: backHover }
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Text {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        textFormat: Text.PlainText
                        objectName: "workspaceLessonTitle"
                        text: (editorPage.currentLesson ? (editorPage.currentLesson.label || "") + " · " : "")
                              + editorPage.currentTitle
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 20
                        font.weight: Font.DemiBold
                    }
                    Text {
                        visible: !editorPage.codeMode
                        text: (editorPage.currentLesson && editorPage.currentLesson.level
                               ? editorPage.currentLesson.level : "等级待定")
                              + " · "
                              + (editorPage.currentLesson && editorPage.currentLesson.duration
                                 ? editorPage.currentLesson.duration : "时长待定")
                              + " · "
                              + (uiShell.starterLanguage !== "" ? uiShell.starterLanguage : "无代码练习")
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 12
                    }
                }
                PreferenceToggle {
                    objectName: "workspaceCodeModeToggle"
                    ds: editorPage.ds
                    text: "代码模式"
                    checked: editorPage.codeMode
                    onToggled: editorPage.codeMode = checked
                    Accessible.name: "代码模式"
                }
                IconButton {
                    id: guideButton
                    objectName: "workspaceGuideButton"
                    ds: editorPage.ds
                    glyph: "▤"
                    tip: "课程指南"
                    enabled: editorPage.currentLesson !== null
                    onClicked: courseGuide.open()
                }
                IconButton {
                    id: workspaceHelpButton
                    objectName: "workspaceHelpButton"
                    ds: editorPage.ds
                    glyph: "?"
                    tip: "查看学习指南"
                    onClicked: hostRoot.openLearningHelp(workspaceHelpButton)
                }
                QuietButton {
                    objectName: "workspaceSaveDraft"
                    ds: editorPage.ds
                    label: uiShell.draftDirty ? "保存草稿 *" : "保存草稿"
                    enabled: uiShell.hasSelectedContent && !uiShell.draftPersistenceBlocked && !uiShell.draftSaving
                    onClicked: uiShell.saveDraft()
                }
                QuietButton {
                    id: lessonEvidenceButton
                    objectName: "lessonEvidenceOpen"
                    ds: editorPage.ds
                    label: "课程证据"
                    enabled: uiShell.hasSelectedContent
                    onClicked: {
                        hostRoot.dialogReturnFocusItem = lessonEvidenceButton;
                        hostRoot.openEvidenceDialog();
                    }
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
                                editorPage.revealItem(index === 0 ? codeEditor : index === 1 ? stagePanel : outputArea);
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

            RowLayout {
                visible: !editorPage.codeMode
                Layout.fillWidth: true
                Text {
                    Layout.fillWidth: true
                    text: uiShell.lessonAssessment.completed
                          ? "已完成 · " + uiShell.lessonAssessment.completionSource
                          : uiShell.lessonAssessment.buttonLabel
                    textFormat: Text.PlainText; wrapMode: Text.WordWrap
                    color: uiShell.lessonAssessment.completed ? ds.success : ds.muted
                    font.family: ds.ui; font.pixelSize: 12
                }
                QuietButton {
                    id: completeLessonButton
                    objectName: "workspaceCompleteLesson"
                    ds: editorPage.ds
                    label: uiShell.lessonAssessment.external ? "填写完成证据" : "标记完成"
                    enabled: uiShell.lessonAssessment.canComplete === true
                    onClicked: {
                        if (uiShell.lessonAssessment.external) {
                            hostRoot.dialogReturnFocusItem = completeLessonButton;
                            hostRoot.openEvidenceDialog();
                        } else uiShell.completeLesson({});
                    }
                }
            }

            Rectangle {
                objectName: "workspaceLessonReader"
                visible: !editorPage.codeMode
                Layout.fillWidth: true
                Layout.preferredHeight: 176
                radius: ds.radius
                color: ds.panel
                border.color: ds.line
                border.width: 1
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: ds.s12
                    spacing: ds.s8
                    RowLayout {
                        Layout.fillWidth: true
                        Text {
                            text: "主题原文"
                            color: ds.ink
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.weight: Font.DemiBold
                        }
                        Item { Layout.fillWidth: true }
                        BusyIndicator {
                            implicitWidth: 20
                            implicitHeight: 20
                            running: uiShell.hasSelectedContent && uiShell.contentBusy
                                     && uiShell.selectedContentBody.length === 0
                            visible: running
                        }
                        Text {
                            visible: uiShell.hasSelectedContent && uiShell.contentBusy
                                     && uiShell.selectedContentBody.length === 0
                            text: "正在读取课程正文…"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 12
                        }
                    }
                    ScrollView {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        visible: uiShell.selectedContentBody.length > 0
                        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                        Text {
                            width: parent.width
                            text: uiShell.selectedContentBody
                            textFormat: Text.MarkdownText
                            color: ds.ink
                            linkColor: ds.accent
                            wrapMode: Text.Wrap
                            font.family: ds.ui
                            font.pixelSize: 12
                        }
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        visible: uiShell.hasSelectedContent && !uiShell.contentBusy
                                 && uiShell.selectedContentBody.length === 0
                        Text {
                            Layout.fillWidth: true
                            text: hostRoot.isErrorStatus(uiShell.contentStatus)
                                  ? "课程正文读取失败：" + uiShell.contentStatus
                                  : "暂无主题原文"
                            color: hostRoot.isErrorStatus(uiShell.contentStatus) ? ds.warning : ds.muted
                            font.family: ds.ui
                            font.pixelSize: 12
                            wrapMode: Text.WordWrap
                        }
                        QuietButton {
                            ds: editorPage.ds
                            visible: hostRoot.isErrorStatus(uiShell.contentStatus)
                            label: "重试读取"
                            enabled: hostRoot.safeSelectedLessonIndex >= 0 && !uiShell.draftDirty
                                     && !uiShell.draftSaving
                            onClicked: uiShell.openPublishedContent(hostRoot.safeSelectedLessonIndex)
                        }
                    }
                    Text {
                        Layout.fillWidth: true
                        visible: !uiShell.hasSelectedContent && !uiShell.contentBusy
                        text: "选择课程后显示主题原文"
                        color: ds.faint
                        font.family: ds.ui
                        font.pixelSize: 12
                    }
                }
            }

            // Editor + run stage
            GridLayout {
                objectName: "workspacePaneLayout"
                columns: editorPage.width >= 1000 ? 2 : 1
                Layout.fillWidth: true
                Layout.fillHeight: true
                columnSpacing: ds.s16
                rowSpacing: ds.s16

                // LEFT — code pane
                Rectangle {
                    objectName: "workspaceCodePane"
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.minimumHeight: 320
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
                                    clip: true
                                    Text {
                                        objectName: "codeLineNumbers"
                                        width: parent.width - ds.s10
                                        y: codeEditor.topPadding - codeScroll.contentItem.contentY
                                        readonly property real lineAdvance: {
                                            const firstBreak = codeEditor.text.indexOf("\n");
                                            return firstBreak >= 0
                                                ? codeEditor.positionToRectangle(firstBreak + 1).y
                                                  - codeEditor.positionToRectangle(0).y
                                                : codeEditor.cursorRectangle.height;
                                        }
                                        text: {
                                            const n = (uiShell.draftCode + "\n").split("\n").length;
                                            let t = "";
                                            for (let i = 1; i < n; ++i) t += i + "\n";
                                            return t.slice(0, -1);
                                        }
                                        color: ds.muted
                                        font.family: ds.mono
                                        font.pixelSize: 13
                                        horizontalAlignment: Text.AlignRight
                                        lineHeight: lineAdvance
                                        lineHeightMode: Text.FixedHeight
                                        Accessible.ignored: true
                                    }
                                }
                                Rectangle {
                                    Layout.preferredWidth: 1
                                    Layout.fillHeight: true
                                    color: ds.line
                                }
                                ScrollView {
                                    id: codeScroll
                                    objectName: "codeScroll"
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
                    objectName: "workspaceRuntimePane"
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
                        implicitHeight: stageContent.implicitHeight + ds.s14 * 2
                        Layout.minimumHeight: implicitHeight
                        radius: ds.radius
                        color: ds.page
                        border.color: ds.line
                        border.width: 1

                        ColumnLayout {
                            id: stageContent
                            anchors.fill: parent
                            anchors.margins: ds.s14
                            spacing: ds.s10

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: ds.s8
                                TabBar {
                                    id: traceTabs
                                    background: null
                                    currentIndex: editorPage.showExecutionTrace ? 1 : 0
                                    onCurrentIndexChanged: editorPage.showExecutionTrace = currentIndex === 1
                                    Repeater {
                                        model: ["课程结构", "执行事件"]
                                        TabButton {
                                            id: traceTab
                                            required property string modelData
                                            text: modelData
                                            implicitHeight: 32
                                            implicitWidth: 76
                                            background: Rectangle {
                                                radius: ds.radiusSm
                                                color: traceTab.checked ? ds.accentSoft : traceTab.hovered ? ds.hoverWash : ds.page
                                                border.color: traceTab.checked || traceTab.activeFocus ? ds.accent : ds.line
                                            }
                                            contentItem: Text {
                                                text: traceTab.text
                                                color: traceTab.checked ? ds.accent : ds.muted
                                                font.family: ds.ui
                                                font.pixelSize: 12
                                                horizontalAlignment: Text.AlignHCenter
                                                verticalAlignment: Text.AlignVCenter
                                            }
                                        }
                                    }
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
                                        text: (uiShell.executionTrace.events || []).length > 0
                                              ? (uiShell.executionTrace.events || []).length + " 个事件"
                                              : "暂无执行事件"
                                        color: ds.accent
                                        font.family: ds.mono
                                        font.pixelSize: 11
                                    }
                                }
                            }

                            StageDiagram {
                                objectName: "workspaceFlowNodes"
                                visible: !editorPage.showExecutionTrace
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                Layout.minimumHeight: 176
                                ds: editorPage.ds
                                frame: Stage.skeleton(editorPage.currentLesson ? (editorPage.currentLesson.flow || []) : [])
                                emptyText: "选择课程后显示流程结构"
                            }

                            ExecutionTracePanel {
                                id: executionPanel
                                objectName: "executionTracePanel"
                                visible: editorPage.showExecutionTrace
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                Layout.minimumHeight: implicitHeight
                                ds: editorPage.ds
                                trace: uiShell.executionTrace
                                busy: uiShell.executionBusy
                                draftRevision: uiShell.draftRevision
                            }

                            TraceVariables {
                                objectName: "executionVariableTable"
                                Layout.fillWidth: true
                                Layout.preferredHeight: implicitHeight
                                ds: editorPage.ds
                                frame: executionPanel.frame
                            }

                            Rectangle {
                                Layout.fillWidth: true
                                height: 1
                                color: ds.line
                            }

                            Flow {
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
                                    objectName: "workspaceRunCode"
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
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: ds.s6
                                Text {
                                    text: "输出"
                                    color: uiShell.executionOutputError ? ds.danger : ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 12
                                    font.weight: Font.DemiBold
                                }
                                Text {
                                    visible: uiShell.executionOutputError
                                    text: "运行错误"
                                    color: ds.danger
                                    font.family: ds.ui
                                    font.pixelSize: 11
                                }
                                Item { Layout.fillWidth: true }
                                QuietButton {
                                    id: copyOutputButton
                                    objectName: "copyOutputButton"
                                    ds: editorPage.ds
                                    label: editorPage.consoleCopyStatus || "复制"
                                    enabled: !editorPage.consoleOutputCleared
                                             && uiShell.executionOutput.length > 0
                                    onClicked: {
                                        outputArea.selectAll();
                                        outputArea.copy();
                                        outputArea.deselect();
                                        editorPage.consoleCopyStatus = "已复制";
                                    }
                                    Accessible.name: editorPage.consoleCopyStatus || "复制执行输出"
                                }
                                QuietButton {
                                    id: clearOutputButton
                                    objectName: "clearOutputButton"
                                    ds: editorPage.ds
                                    label: "清空"
                                    enabled: !editorPage.consoleOutputCleared
                                             && uiShell.executionOutput.length > 0
                                    onClicked: {
                                        editorPage.consoleOutputCleared = true;
                                        editorPage.consoleCopyStatus = "";
                                    }
                                    Accessible.name: "清空控制台显示，不删除执行记录"
                                }
                            }
                            ScrollView {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                                TextArea {
                                    id: outputArea
                                    objectName: "outputArea"
                                    focus: true
                                    text: editorPage.consoleOutputCleared ? "" : uiShell.executionOutput
                                    readOnly: true
                                    wrapMode: TextArea.Wrap
                                    color: uiShell.executionOutputError ? ds.danger : ds.success
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
    ShellDialog {
        id: courseGuide
        objectName: "workspaceCourseGuide"
        ds: editorPage.ds
        parent: Overlay.overlay
        title: "课程指南"
        width: Math.min(760, editorPage.hostRoot.width - editorPage.ds.s32)
        height: Math.min(640, editorPage.hostRoot.height - editorPage.ds.s32)
        x: (parent.width - width) / 2
        y: (parent.height - height) / 2
        onClosed: guideButton.forceActiveFocus(Qt.PopupFocusReason)
        contentItem: ScrollView {
            id: guideScroll
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            LessonGuide {
                width: guideScroll.availableWidth
                ds: editorPage.ds
                lesson: editorPage.currentLesson
            }
        }
    }
    }
