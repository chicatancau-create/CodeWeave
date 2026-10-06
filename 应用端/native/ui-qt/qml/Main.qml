import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Shapes

// ── Design tokens ────────────────────────────────────────────────────────────
// Off-black canvas (#080d13), cold blue-grey text (#e7f6ff), cyan accent (#36d7ff).
// Sidebar slightly lighter (#0d151f), panels at #111c28 / #192a3b.
// Tone colours map to the web frontend's node tone system.

Rectangle {
    id: root
    width: 1280
    height: 820
    color: ds.canvas

    // Keep benchmarkScrolling so the performance probe can drive the list.
    property bool benchmarkScrolling: false

    // ── Token object ─────────────────────────────────────────────────────────
    QtObject {
        id: ds
        readonly property color canvas:      "#080d13"
        readonly property color sidebar:     "#0d151f"
        readonly property color panel:       "#111c28"
        readonly property color panelRaised: "#192a3b"
        readonly property color border:      "#263c50"
        readonly property color borderFaint: "#182437"
        readonly property color accent:      "#36d7ff"
        readonly property color accentDim:   "#1b5f75"
        readonly property color text:        "#e7f6ff"
        readonly property color muted:       "#7a9db5"
        readonly property color faint:       "#3d5a70"
        readonly property color success:     "#3fd3a4"
        readonly property color warning:     "#ffc457"
        readonly property color danger:      "#ff8371"
        readonly property color info:        "#4f7cff"
        // Node tone → fill / stroke
        readonly property color tonePurple:  "#a78bfa"
        readonly property color toneBlue:    "#60a5fa"
        readonly property color toneYellow:  "#fbbf24"
        readonly property color toneCoral:   "#f87171"
        readonly property color toneGreen:   "#34d399"
        // Typography
        readonly property string mono:       "Cascadia Mono, Consolas, monospace"
        readonly property string sans:       "Segoe UI Variable, Segoe UI, sans-serif"
        // Space rhythm (4 pt base)
        readonly property int sp4: 4;  readonly property int sp8: 8
        readonly property int sp12: 12; readonly property int sp16: 16
        readonly property int sp20: 20; readonly property int sp24: 24
    }

    // ── Grid background (mimics the web frontend's flowing grid) ─────────────
    Canvas {
        id: bgGrid
        anchors.fill: parent
        z: 0
        onPaint: {
            const ctx = getContext("2d");
            ctx.clearRect(0, 0, width, height);
            ctx.strokeStyle = "#111e2d";
            ctx.lineWidth = 1;
            const step = 40;
            for (let x = 0; x <= width; x += step) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
            }
            for (let y = 0; y <= height; y += step) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
            }
        }
        Component.onCompleted: requestPaint()
    }

    // ── Radial ambient glow behind content ───────────────────────────────────
    Rectangle {
        anchors.fill: parent
        z: 0
        gradient: Gradient {
            orientation: Gradient.Vertical
            GradientStop { position: 0.0; color: "#0a1522" }
            GradientStop { position: 1.0; color: "#080d13" }
        }
        opacity: 0.55
    }

    // ── Password change dialog ────────────────────────────────────────────────
    Dialog {
        id: passwordDialog
        title: "修改密码"
        anchors.centerIn: parent
        modal: true
        standardButtons: Dialog.Ok | Dialog.Cancel
        onAccepted: {
            uiShell.changePassword(oldPassword.text, newPassword.text)
            oldPassword.clear(); newPassword.clear()
        }
        onRejected: { oldPassword.clear(); newPassword.clear() }
        contentItem: ColumnLayout {
            spacing: ds.sp12
            CwField { id: oldPassword; placeholderText: "当前密码"; echoMode: TextInput.Password; Accessible.name: "当前密码" }
            CwField { id: newPassword; placeholderText: "新密码";   echoMode: TextInput.Password; Accessible.name: "新密码" }
        }
    }

    // ── External evidence dialog ──────────────────────────────────────────────
    Dialog {
        id: evidenceDialog
        title: "记录外部实践证据"
        anchors.centerIn: parent
        width: Math.min(620, root.width - 48)
        modal: true
        standardButtons: Dialog.Save | Dialog.Cancel
        onAccepted: uiShell.saveExternalEvidence(envField.text, cmdField.text,
            summaryArea.text, artifactField.text, dateField.text)
        contentItem: ColumnLayout {
            spacing: ds.sp12
            Label { Layout.fillWidth: true; text: "保存为待核验记录，不会自动提升进度。"
                    color: ds.muted; wrapMode: Text.WordWrap; font.pixelSize: 13 }
            CwField { id: envField;      Layout.fillWidth: true; placeholderText: "环境与版本"; Accessible.name: "外部实践环境与版本" }
            CwField { id: cmdField;      Layout.fillWidth: true; placeholderText: "执行命令或操作步骤"; Accessible.name: "外部实践命令" }
            TextArea  { id: summaryArea;  Layout.fillWidth: true; Layout.preferredHeight: 110
                        placeholderText: "实际结果与待完成事项"; wrapMode: TextArea.Wrap
                        color: ds.text; font.family: ds.sans; font.pixelSize: 13
                        background: Rectangle { color: ds.panelRaised; border.color: ds.border; radius: 4 }
                        Accessible.name: "外部实践结果" }
            CwField { id: artifactField; Layout.fillWidth: true; placeholderText: "产物引用（可选）"; Accessible.name: "外部实践产物引用" }
            CwField { id: dateField;     Layout.fillWidth: true;
                        text: Qt.formatDate(new Date(), "yyyy-MM-dd")
                        placeholderText: "复现日期 YYYY-MM-DD"; Accessible.name: "外部实践复现日期" }
        }
    }

    // ── Root layout: sidebar + main ───────────────────────────────────────────
    RowLayout {
        anchors.fill: parent
        spacing: 0
        z: 1

        // ── Left sidebar ──────────────────────────────────────────────────────
        Rectangle {
            Layout.preferredWidth: 220
            Layout.fillHeight: true
            color: ds.sidebar

            // Right border
            Rectangle {
                anchors.right: parent.right
                width: 1; height: parent.height
                color: ds.border; opacity: 0.5
            }

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: ds.sp16
                spacing: ds.sp8

                // Brand
                Column {
                    Layout.fillWidth: true
                    spacing: 2
                    Label {
                        text: "CodeWeave"
                        color: ds.text
                        font.family: ds.sans
                        font.pixelSize: 22
                        font.weight: Font.Bold
                        font.letterSpacing: -0.5
                    }
                    Label {
                        text: "本机学习环境"
                        color: ds.accent
                        font.family: ds.mono
                        font.pixelSize: 11
                        font.letterSpacing: 1
                    }
                }

                // Separator
                Rectangle { Layout.fillWidth: true; height: 1; color: ds.border; opacity: 0.6
                             Layout.topMargin: ds.sp4; Layout.bottomMargin: ds.sp4 }

                // Nav items
                Repeater {
                    model: [
                        { label: "学习",     icon: "📚", index: "01" },
                        { label: "编辑器",   icon: "✏️",  index: "02" },
                        { label: "运行记录", icon: "▶",  index: "03" },
                        { label: "账户",     icon: "👤", index: "04" },
                        { label: "复习与进度", icon: "📈", index: "05" }
                    ]
                    delegate: CwNavButton {
                        required property var modelData
                        Layout.fillWidth: true
                        navLabel: modelData.label
                        navIndex: modelData.index
                        active: uiShell.currentPage === modelData.label
                        onClicked: uiShell.selectPage(modelData.label)
                    }
                }

                Item { Layout.fillHeight: true }

                // Account status pill
                Rectangle {
                    Layout.fillWidth: true
                    height: 36
                    radius: 6
                    color: uiShell.hasActiveAccount ? "#0d2318" : ds.panelRaised
                    border.color: uiShell.hasActiveAccount ? ds.success : ds.border
                    border.width: 1
                    RowLayout {
                        anchors.fill: parent; anchors.margins: ds.sp8; spacing: ds.sp8
                        Rectangle {
                            width: 8; height: 8; radius: 4
                            color: uiShell.hasActiveAccount ? ds.success : ds.faint
                        }
                        Label {
                            Layout.fillWidth: true
                            text: uiShell.hasActiveAccount ? uiShell.accountName : "访客模式"
                            color: uiShell.hasActiveAccount ? ds.success : ds.muted
                            font.pixelSize: 12; elide: Text.ElideRight
                        }
                    }
                }

                Label {
                    text: "无服务器 · 无端口"
                    color: ds.faint; font.pixelSize: 10
                    font.letterSpacing: 0.5
                    Layout.bottomMargin: ds.sp4
                }
            }
        }

        // ── Main content area ─────────────────────────────────────────────────
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: ds.canvas

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: ds.sp24
                spacing: ds.sp16

                // Page header row
                RowLayout {
                    Layout.fillWidth: true
                    Label {
                        text: uiShell.currentPage
                        color: ds.text
                        font.family: ds.sans
                        font.pixelSize: 26
                        font.weight: Font.Bold
                    }
                    Item { Layout.fillWidth: true }
                    Label {
                        text: uiShell.contentBusy ? "同步中…" : uiShell.contentStatus
                        color: ds.muted; font.pixelSize: 12
                        elide: Text.ElideRight; visible: text.length > 0
                    }
                }

                // Status banner (operation / account status)
                Rectangle {
                    Layout.fillWidth: true; height: 28; radius: 4
                    color: "#0d1f2d"
                    border.color: ds.accentDim; border.width: 1
                    visible: (uiShell.operationStatus + uiShell.accountStatus).length > 0
                    Label {
                        anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter
                                  margins: ds.sp12 }
                        text: uiShell.operationStatus.length > 0 ? uiShell.operationStatus : uiShell.accountStatus
                        color: ds.accent; font.pixelSize: 12; elide: Text.ElideRight
                    }
                }

                // ── Page StackLayout ──────────────────────────────────────────
                StackLayout {
                    id: pages
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    currentIndex: ["学习", "编辑器", "运行记录", "账户", "复习与进度"].indexOf(uiShell.currentPage)

                    // ── 0: 学习 (course home) ─────────────────────────────────
                    Loader {
                        id: studyLoader
                        asynchronous: true
                        active: pages.currentIndex === 0 || studyLoader.status === Loader.Ready
                        sourceComponent: StudyPage {}
                    }

                    // ── 1: 编辑器 ─────────────────────────────────────────────
                    Loader {
                        id: editorLoader
                        asynchronous: true
                        active: pages.currentIndex === 1 || editorLoader.status === Loader.Ready
                        sourceComponent: EditorPage {}
                    }

                    // ── 2: 运行记录 ───────────────────────────────────────────
                    Loader {
                        id: runLogLoader
                        asynchronous: true
                        active: pages.currentIndex === 2 || runLogLoader.status === Loader.Ready
                        sourceComponent: RunLogPage {}
                    }

                    // ── 3: 账户 ───────────────────────────────────────────────
                    Loader {
                        id: accountLoader
                        asynchronous: true
                        active: pages.currentIndex === 3 || accountLoader.status === Loader.Ready
                        sourceComponent: AccountPage {}
                    }

                    // ── 4: 复习与进度 ─────────────────────────────────────────
                    Loader {
                        id: reviewLoader
                        asynchronous: true
                        active: pages.currentIndex === 4 || reviewLoader.status === Loader.Ready
                        sourceComponent: ReviewPage {}
                    }
                }
            }
        }
    }

    // ── Reusable component definitions ───────────────────────────────────────

    // Small text input with consistent styling
    component CwField: TextField {
        Layout.fillWidth: true
        color: ds.text
        font.family: ds.sans
        font.pixelSize: 13
        placeholderTextColor: ds.faint
        background: Rectangle {
            color: ds.panelRaised
            border.color: parent.activeFocus ? ds.accent : ds.border
            border.width: parent.activeFocus ? 1.5 : 1
            radius: 4
        }
        leftPadding: ds.sp12; rightPadding: ds.sp12
    }

    // Sidebar navigation button with index badge
    component CwNavButton: Item {
        property string navLabel: ""
        property string navIndex: ""
        property bool active: false
        signal clicked()
        implicitHeight: 40
        Rectangle {
            anchors.fill: parent; radius: 6
            color: active ? "#132030" : (hov.containsMouse ? "#0f1d2a" : "transparent")
            border.color: active ? ds.accent : "transparent"; border.width: 1
            RowLayout {
                anchors.fill: parent; anchors.leftMargin: ds.sp12; anchors.rightMargin: ds.sp8
                spacing: ds.sp10
                Label {
                    text: navIndex
                    color: active ? ds.accent : ds.faint
                    font.family: ds.mono; font.pixelSize: 11
                    font.letterSpacing: 0.5
                    verticalAlignment: Text.AlignVCenter
                }
                Label {
                    Layout.fillWidth: true
                    text: navLabel
                    color: active ? ds.text : ds.muted
                    font.family: ds.sans; font.pixelSize: 13
                    font.weight: active ? Font.Medium : Font.Normal
                    verticalAlignment: Text.AlignVCenter
                }
            }
            HoverHandler { id: hov }
        }
        MouseArea { anchors.fill: parent; onClicked: parent.clicked(); cursorShape: Qt.PointingHandCursor }
    }

    // ── EditorPage ────────────────────────────────────────────────────────────
    component EditorPage: Item {
        ColumnLayout {
            anchors.fill: parent; spacing: ds.sp12

            // Header row: lesson id + language + save state
            RowLayout {
                Layout.fillWidth: true
                Label {
                    text: uiShell.documentId.length > 0 ? uiShell.documentId : "尚未选择课程"
                    color: ds.text; font.pixelSize: 16; font.weight: Font.Bold; elide: Text.ElideRight
                }
                Label {
                    visible: uiShell.starterLanguage.length > 0
                    text: uiShell.starterLanguage + " · " + uiShell.executionPolicy
                    color: ds.accent; font.family: ds.mono; font.pixelSize: 12
                }
                Item { Layout.fillWidth: true }
                Rectangle {
                    height: 22; radius: 4; width: saveLabel.contentWidth + 16
                    color: uiShell.draftDirty ? "#2a1500" : "#0d2318"
                    border.color: uiShell.draftDirty ? ds.warning : ds.success; border.width: 1
                    Label {
                        id: saveLabel
                        anchors.centerIn: parent
                        text: uiShell.draftSaving ? "保存中…" : (uiShell.draftDirty ? "未保存" : "已保存")
                        color: uiShell.draftDirty ? ds.warning : ds.success
                        font.pixelSize: 11; font.family: ds.mono
                    }
                }
            }

            // Two-column: editor left, canvas right
            RowLayout {
                Layout.fillWidth: true; Layout.fillHeight: true; spacing: ds.sp12

                // ── Code editor ───────────────────────────────────────────────
                Rectangle {
                    Layout.fillWidth: true; Layout.fillHeight: true
                    color: "#06101a"; radius: 8; border.color: ds.border; border.width: 1
                    ColumnLayout {
                        anchors.fill: parent; anchors.margins: ds.sp12; spacing: ds.sp8
                        // Line numbers + editor in a row
                        RowLayout {
                            Layout.fillWidth: true; Layout.fillHeight: true; spacing: 0
                            // Fake line-number gutter
                            Rectangle {
                                Layout.fillHeight: true; width: 38
                                color: "#070e18"; radius: 4
                                Label {
                                    anchors.fill: parent
                                    text: {
                                        var lines = (uiShell.draftCode + "\n").split("\n").length;
                                        var t = "";
                                        for (var i = 1; i < lines; ++i) t += i + "\n";
                                        return t;
                                    }
                                    color: ds.faint; font.family: ds.mono; font.pixelSize: 12
                                    horizontalAlignment: Text.AlignRight
                                    topPadding: 4; rightPadding: 6; leftPadding: 6
                                    lineHeight: 1.5
                                    Accessible.ignored: true
                                }
                            }
                            // Editor
                            ScrollView {
                                Layout.fillWidth: true; Layout.fillHeight: true
                                ScrollBar.horizontal.policy: ScrollBar.AsNeeded
                                TextArea {
                                    objectName: "codeEditor"
                                    id: editorArea
                                    text: uiShell.draftCode
                                    readOnly: uiShell.starterLanguage.length === 0 || uiShell.contentBusy || uiShell.draftPersistenceBlocked
                                    wrapMode: TextArea.NoWrap
                                    color: ds.text; selectionColor: ds.accentDim
                                    font.family: "Cascadia Mono, Consolas, monospace"; font.pixelSize: 13
                                    lineHeight: 1.5
                                    background: null
                                    Accessible.name: "代码编辑器"
                                    leftPadding: ds.sp12
                                    // Keep Chinese guidance out of monospace layout path.
                                    Text {
                                        anchors.left: parent.left; anchors.leftMargin: parent.leftPadding
                                        anchors.top: parent.top; anchors.topMargin: parent.topPadding
                                        visible: editorArea.length === 0 && !editorArea.activeFocus
                                        text: "读取起始代码后开始编辑"
                                        color: ds.faint; font.pixelSize: 13; font.family: ds.mono
                                    }
                                    onTextChanged: if (activeFocus) uiShell.updateDraftCode(text)
                                }
                            }
                        }
                        // Editor toolbar
                        RowLayout {
                            Layout.fillWidth: true; spacing: ds.sp8
                            CwButton { label: "保存草稿"
                                       enabled: uiShell.hasActiveAccount && uiShell.draftDirty && !uiShell.draftSaving && !uiShell.draftPersistenceBlocked
                                       onClicked: uiShell.saveDraft() }
                            CwButton { label: "撤销"; enabled: uiShell.draftDirty && !uiShell.draftSaving; onClicked: uiShell.discardDraftChanges() }
                            CwButton { label: "恢复起始"; enabled: uiShell.starterLanguage.length > 0 && !uiShell.draftSaving; onClicked: uiShell.resetDraftCode() }
                            CheckBox {
                                text: "独立完成"
                                checked: uiShell.independentAttempt
                                enabled: !uiShell.executionBusy
                                onToggled: uiShell.independentAttempt = checked
                                contentItem: Label { text: parent.text; color: ds.muted; font.pixelSize: 12; leftPadding: parent.indicator.width + 6 }
                            }
                            Item { Layout.fillWidth: true }
                            ComboBox {
                                id: freeLang
                                model: ["cpp", "java", "python", "javascript"]
                                font.pixelSize: 12; font.family: ds.mono
                                Accessible.name: "自由编程语言"
                                background: Rectangle { color: ds.panelRaised; border.color: ds.border; border.width: 1; radius: 4 }
                                contentItem: Label { text: freeLang.currentText; color: ds.text; font: freeLang.font; leftPadding: 8 }
                            }
                            CwButton { label: "自由编程"; enabled: !uiShell.executionBusy; onClicked: uiShell.openFreeProgram(freeLang.currentText) }
                            CwButton { label: "选择工具"; enabled: uiShell.starterLanguage.length > 0 && !uiShell.executionBusy; onClicked: uiShell.requestToolSelection() }
                        }
                    }
                }

                // ── Right panel: execution canvas + controls ───────────────────
                Rectangle {
                    Layout.preferredWidth: parent.width * 0.42; Layout.fillHeight: true
                    color: ds.panel; radius: 8; border.color: ds.border; border.width: 1
                    ColumnLayout {
                        anchors.fill: parent; anchors.margins: ds.sp12; spacing: ds.sp8

                        // Canvas: show flow skeleton when a lesson with flow is loaded
                        Rectangle {
                            Layout.fillWidth: true; Layout.fillHeight: true
                            color: "#050b12"; radius: 6
                            clip: true

                            // Flow skeleton canvas — rendered from lessonMeta flow data
                            Item {
                                id: flowCanvas
                                anchors.fill: parent
                                property var flowNodes: {
                                    if (!uiShell.hasSelectedContent) return [];
                                    var id = uiShell.documentId;
                                    for (var i = 0; i < uiShell.lessonMeta.length; ++i) {
                                        if (uiShell.lessonMeta[i].id === id ||
                                            uiShell.lessonMeta[i].label + " · " + uiShell.lessonMeta[i].title === id)
                                            return uiShell.lessonMeta[i].flow || [];
                                    }
                                    return [];
                                }
                                property bool running: uiShell.executionBusy

                                Repeater {
                                    model: flowCanvas.flowNodes
                                    delegate: Item {
                                        required property var modelData
                                        required property int index
                                        // Simple grid layout: max 3 per row
                                        property int col: index % 3
                                        property int row: Math.floor(index / 3)
                                        property int nodeW: 150; property int nodeH: 70
                                        property int hGap: 24; property int vGap: 32
                                        property int startX: (flowCanvas.width - Math.min(flowCanvas.flowNodes.length, 3) * (nodeW + hGap) + hGap) / 2
                                        property int startY: 32
                                        x: startX + col * (nodeW + hGap)
                                        y: startY + row * (nodeH + vGap)
                                        width: nodeW; height: nodeH

                                        property color toneColor: {
                                            switch (modelData.tone) {
                                                case "purple": return ds.tonePurple
                                                case "blue":   return ds.toneBlue
                                                case "yellow": return ds.toneYellow
                                                case "coral":  return ds.toneCoral
                                                case "green":  return ds.toneGreen
                                                default:       return ds.muted
                                            }
                                        }

                                        // Draw node shape based on kind
                                        // start/end: rounded pill; decision: diamond; process: rect; output: parallelogram approximated as rect with slant label
                                        Rectangle {
                                            anchors.fill: parent
                                            radius: (modelData.kind === "start" || modelData.kind === "end") ? height / 2 :
                                                    (modelData.kind === "decision") ? 0 : 6
                                            color: "#07111c"
                                            border.color: parent.toneColor; border.width: 1.5
                                            rotation: modelData.kind === "decision" ? 45 : 0
                                            transformOrigin: Item.Center
                                            // Decision diamond uses rotation trick
                                            visible: modelData.kind !== "output"
                                        }
                                        // Output parallelogram via Canvas
                                        Canvas {
                                            anchors.fill: parent
                                            visible: modelData.kind === "output"
                                            onPaint: {
                                                const ctx = getContext("2d");
                                                ctx.clearRect(0, 0, width, height);
                                                const skew = 10;
                                                ctx.beginPath();
                                                ctx.moveTo(skew, 0); ctx.lineTo(width, 0);
                                                ctx.lineTo(width - skew, height); ctx.lineTo(0, height);
                                                ctx.closePath();
                                                ctx.strokeStyle = parent.toneColor;
                                                ctx.lineWidth = 1.5;
                                                ctx.fillStyle = "#07111c";
                                                ctx.fill(); ctx.stroke();
                                            }
                                        }
                                        Label {
                                            anchors.centerIn: parent
                                            text: modelData.label || ""
                                            color: parent.toneColor
                                            font.family: ds.mono; font.pixelSize: 11
                                            horizontalAlignment: Text.AlignHCenter
                                            wrapMode: Text.NoWrap; elide: Text.ElideRight
                                            width: parent.width - 12
                                        }
                                    }
                                }

                                // Empty state when no lesson
                                Label {
                                    anchors.centerIn: parent
                                    visible: flowCanvas.flowNodes.length === 0
                                    text: uiShell.hasSelectedContent ? "该课程无执行流程图" : "选择课程后查看执行流程"
                                    color: ds.faint; font.pixelSize: 12; horizontalAlignment: Text.AlignHCenter
                                }

                                Label {
                                    anchors { bottom: parent.bottom; horizontalCenter: parent.horizontalCenter; bottomMargin: ds.sp8 }
                                    visible: flowCanvas.flowNodes.length > 0
                                    text: uiShell.executionBusy ? (uiShell.executionPaused ? "已暂停" : "运行中…") : "骨架预览"
                                    color: uiShell.executionBusy ? (uiShell.executionPaused ? ds.warning : ds.accent) : ds.faint
                                    font.pixelSize: 11; font.family: ds.mono
                                }
                            }
                        }

                        // Timeout and run controls
                        RowLayout {
                            Layout.fillWidth: true; spacing: ds.sp8
                            Label { text: "超时"; color: ds.muted; font.pixelSize: 11 }
                            SpinBox {
                                from: 100; to: 120000; stepSize: 1000; editable: true
                                value: uiShell.executionTimeout
                                enabled: !uiShell.executionBusy
                                onValueModified: uiShell.executionTimeout = value
                                Accessible.name: "执行超时毫秒"
                                font.pixelSize: 12; font.family: ds.mono
                                background: Rectangle { color: ds.panelRaised; border.color: ds.border; radius: 4 }
                                contentItem: TextInput {
                                    text: parent.textFromValue(parent.value, parent.locale)
                                    color: ds.text; font: parent.font
                                    horizontalAlignment: Text.AlignHCenter
                                    readOnly: !parent.editable
                                }
                                up.indicator: Rectangle { x: parent.width - width; height: parent.height / 2; width: 20; color: "transparent"; Label { anchors.centerIn: parent; text: "▲"; color: ds.muted; font.pixelSize: 8 } }
                                down.indicator: Rectangle { y: parent.height / 2; height: parent.height / 2; width: 20; color: "transparent"; Label { anchors.centerIn: parent; text: "▼"; color: ds.muted; font.pixelSize: 8 } }
                            }
                        }
                        RowLayout {
                            Layout.fillWidth: true; spacing: ds.sp8
                            CwButton {
                                label: uiShell.executionBusy ? "取消" : "运行"
                                accent: !uiShell.executionBusy
                                enabled: uiShell.hasActiveAccount && uiShell.starterLanguage.length > 0 && !uiShell.contentBusy
                                onClicked: uiShell.executionBusy ? uiShell.cancelExecution() : uiShell.runCode()
                            }
                            CwButton { label: "暂停"; enabled: uiShell.executionBusy && !uiShell.executionPaused; onClicked: uiShell.pauseExecution() }
                            CwButton { label: "继续"; enabled: uiShell.executionBusy && uiShell.executionPaused; onClicked: uiShell.resumeExecution() }
                            CwButton { label: "单步"; enabled: uiShell.executionBusy && uiShell.executionPaused; onClicked: uiShell.stepExecution() }
                        }
                    }
                }
            }
        }
    }

    component StudyPage: Item {
        ColumnLayout {
            anchors.fill: parent; spacing: ds.sp12

            RowLayout {
                Layout.fillWidth: true
                Label { text: "课程目录"; color: ds.text; font.pixelSize: 18; font.weight: Font.Bold }
                Item { Layout.fillWidth: true }
                CwButton { label: uiShell.contentBusy ? "读取中…" : "重新读取"
                           enabled: !uiShell.contentBusy; onClicked: uiShell.reloadPublishedContent() }
            }

            RowLayout {
                Layout.fillWidth: true; Layout.fillHeight: true; spacing: ds.sp12

                // Course grid (2-column)
                ScrollView {
                    Layout.preferredWidth: parent.width * 0.58; Layout.fillHeight: true
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                    GridView {
                        id: courseGrid
                        objectName: "courseList"
                        anchors.fill: parent
                        cellWidth: Math.floor(width / 2) - 1
                        cellHeight: 118
                        model: uiShell.lessonMeta
                        clip: true

                        NumberAnimation on contentY {
                            running: root.benchmarkScrolling
                            from: 0
                            to: Math.max(1, courseGrid.contentHeight - courseGrid.height)
                            duration: 3000; loops: Animation.Infinite
                        }

                        delegate: Item {
                            required property var modelData
                            required property int index
                            width: courseGrid.cellWidth; height: courseGrid.cellHeight
                            Rectangle {
                                anchors { fill: parent; margins: 4 }
                                radius: 8
                                color: selHov.containsMouse ? ds.panelRaised : ds.panel
                                border.color: selHov.containsMouse ? ds.accent : ds.border
                                border.width: 1
                                ColumnLayout {
                                    anchors { fill: parent; margins: ds.sp12 }
                                    spacing: ds.sp4
                                    RowLayout {
                                        spacing: ds.sp8
                                        Label {
                                            text: modelData.label || ""
                                            color: ds.accent
                                            font.family: ds.mono; font.pixelSize: 11
                                        }
                                        Label {
                                            text: modelData.languageLabel || ""
                                            color: ds.muted; font.pixelSize: 11
                                            background: Rectangle {
                                                color: ds.panelRaised
                                                radius: 3
                                                implicitWidth: parent.contentWidth + 10
                                                implicitHeight: parent.contentHeight + 4
                                            }
                                        }
                                        Label {
                                            text: modelData.level || ""
                                            color: ds.muted; font.pixelSize: 11
                                        }
                                    }
                                    Label {
                                        Layout.fillWidth: true
                                        text: modelData.title || ""
                                        color: ds.text; font.pixelSize: 13; font.weight: Font.Medium
                                        elide: Text.ElideRight
                                    }
                                    Label {
                                        Layout.fillWidth: true
                                        text: modelData.description || ""
                                        color: ds.muted; font.pixelSize: 12
                                        elide: Text.ElideRight; wrapMode: Text.NoWrap
                                    }
                                    Item { Layout.fillHeight: true }
                                    RowLayout {
                                        spacing: ds.sp8
                                        Label {
                                            text: (modelData.flow ? modelData.flow.length : 0) + " 步"
                                            color: ds.faint; font.pixelSize: 11; font.family: ds.mono
                                        }
                                        Label {
                                            text: modelData.duration || ""
                                            color: ds.faint; font.pixelSize: 11
                                        }
                                    }
                                }
                                HoverHandler { id: selHov }
                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        const idx = uiShell.publishedIds.indexOf(parent.parent.parent.modelData.id)
                                        if (idx >= 0) uiShell.openPublishedContent(idx)
                                    }
                                }
                            }
                        }
                    }
                }

                // Selected content detail panel
                Rectangle {
                    Layout.fillWidth: true; Layout.fillHeight: true
                    color: ds.panel; radius: 8; border.color: ds.border; border.width: 1
                    ColumnLayout {
                        anchors { fill: parent; margins: ds.sp16 }
                        spacing: ds.sp12
                        Label {
                            text: uiShell.hasSelectedContent ? uiShell.documentId : "选择左侧课程查看详情"
                            color: uiShell.hasSelectedContent ? ds.accent : ds.faint
                            font.weight: Font.Bold; font.pixelSize: 14
                        }
                        Rectangle { Layout.fillWidth: true; height: 1; color: ds.border }
                        ScrollView {
                            Layout.fillWidth: true; Layout.fillHeight: true
                            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                            TextArea {
                                text: uiShell.selectedContentBody
                                readOnly: true; wrapMode: TextArea.Wrap
                                color: ds.text; font.family: ds.sans; font.pixelSize: 13
                                background: null
                                placeholderText: "正文将显示在这里"
                                Accessible.name: "课程正文"
                            }
                        }
                        RowLayout {
                            Layout.fillWidth: true; spacing: ds.sp8
                            CwButton { label: "读取起始代码"
                                       enabled: uiShell.hasSelectedContent && !uiShell.contentBusy
                                       onClicked: uiShell.loadStarterCode() }
                            CwButton { label: "读取提示"
                                       enabled: uiShell.hasSelectedContent && !uiShell.contentBusy && !uiShell.operationBusy
                                       onClicked: uiShell.loadHints() }
                            CwButton { label: "记录实践证据"
                                       enabled: uiShell.hasActiveAccount && uiShell.hasSelectedContent && !uiShell.operationBusy
                                       onClicked: evidenceDialog.open() }
                        }
                        TextArea {
                            Layout.fillWidth: true; Layout.preferredHeight: 80
                            text: uiShell.hints; readOnly: true; wrapMode: TextArea.Wrap
                            color: ds.muted; font.pixelSize: 12
                            background: Rectangle { color: ds.panelRaised; radius: 4 }
                            placeholderText: "提示将显示在这里"
                            Accessible.name: "课程提示"
                        }
                    }
                }
            }
        }
    }

    component RunLogPage: Item {
        ColumnLayout {
            anchors { fill: parent; margins: ds.sp16 }
            spacing: ds.sp12
            RowLayout {
                Layout.fillWidth: true
                Text { text: "运行记录"; color: ds.text; font.pixelSize: 16; font.weight: Font.Medium; font.family: ds.sans }
                Item { Layout.fillWidth: true }
                Rectangle {
                    radius: 10; width: runPill.implicitWidth + ds.sp16; height: 24
                    color: uiShell.executionBusy ? "#1a2a1a" : (uiShell.executionPaused ? "#2a2a0a" : ds.panelRaised)
                    border.color: uiShell.executionBusy ? ds.green : (uiShell.executionPaused ? ds.yellow : ds.border)
                    Text {
                        id: runPill; anchors.centerIn: parent
                        text: uiShell.executionBusy ? "运行中" : (uiShell.executionPaused ? "已暂停" : "空闲")
                        color: uiShell.executionBusy ? ds.green : (uiShell.executionPaused ? ds.yellow : ds.muted)
                        font.pixelSize: 11; font.family: ds.sans
                    }
                }
            }
            Rectangle { Layout.fillWidth: true; height: 1; color: ds.border }
            ScrollView {
                Layout.fillWidth: true; Layout.fillHeight: true
                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                TextArea {
                    text: uiShell.executionOutput; readOnly: true; wrapMode: TextArea.Wrap
                    color: ds.text; font.family: ds.mono; font.pixelSize: 13
                    background: Rectangle { color: ds.panelRaised; radius: 4 }
                    Accessible.name: "运行输出"
                }
            }
            RowLayout {
                Layout.fillWidth: true; spacing: ds.sp8
                CwButton { label: "取消"; enabled: uiShell.executionBusy; onClicked: uiShell.cancelExecution() }
                CwButton { label: "暂停"; enabled: uiShell.executionBusy && !uiShell.executionPaused; onClicked: uiShell.pauseExecution() }
                CwButton { label: "继续"; enabled: uiShell.executionBusy && uiShell.executionPaused; onClicked: uiShell.resumeExecution() }
                CwButton { label: "单步"; enabled: uiShell.executionPaused; onClicked: uiShell.stepExecution() }
            }
        }
    }

    component AccountPage: Item {
        ScrollView {
            anchors { fill: parent; margins: ds.sp16 }
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            ColumnLayout {
                width: parent.width - ds.sp16; spacing: ds.sp16
                Text { text: "账户"; color: ds.text; font.pixelSize: 16; font.weight: Font.Medium; font.family: ds.sans }
                Rectangle { width: parent.width; height: 1; color: ds.border }
                GridLayout {
                    width: parent.width; columns: 2; columnSpacing: ds.sp16; rowSpacing: ds.sp8
                    Text { text: "账户 ID"; color: ds.muted; font.pixelSize: 12; font.family: ds.sans }
                    Text { text: uiShell.activeAccountId || "—"; color: ds.text; font.pixelSize: 12; font.family: ds.mono }
                    Text { text: "显示名称"; color: ds.muted; font.pixelSize: 12; font.family: ds.sans }
                    Text { text: uiShell.accountName || "—"; color: ds.text; font.pixelSize: 12; font.family: ds.sans }
                }
                Rectangle { width: parent.width; height: 1; color: ds.border }
                Text {
                    text: uiShell.hasActiveAccount ? "修改密码" : "登录 / 注册"
                    color: ds.text; font.pixelSize: 14; font.weight: Font.Medium; font.family: ds.sans
                }
                CwField { id: identField; width: parent.width; placeholderText: "账户 ID 或邮箱"; visible: !uiShell.hasActiveAccount }
                CwField { id: nameField; width: parent.width; placeholderText: "显示名称（注册时填写）"; visible: !uiShell.hasActiveAccount }
                CwField {
                    id: pwField; width: parent.width
                    placeholderText: uiShell.hasActiveAccount ? "当前密码" : "密码"
                    echoMode: TextInput.Password
                }
                CwField { id: newPwField; width: parent.width; placeholderText: "新密码"; echoMode: TextInput.Password; visible: uiShell.hasActiveAccount }
                Text {
                    text: uiShell.accountStatus; color: ds.muted; font.pixelSize: 12; font.family: ds.sans
                    visible: uiShell.accountStatus !== ""; wrapMode: Text.WordWrap; width: parent.width
                }
                RowLayout {
                    width: parent.width; spacing: ds.sp8
                    CwButton {
                        label: "登录"; visible: !uiShell.hasActiveAccount; enabled: !uiShell.accountBusy
                        onClicked: uiShell.login(identField.text, pwField.text)
                    }
                    CwButton {
                        label: "注册"; visible: !uiShell.hasActiveAccount; enabled: !uiShell.accountBusy
                        onClicked: uiShell.registerAccount(nameField.text, identField.text, pwField.text)
                    }
                    CwButton {
                        label: "修改密码"; visible: uiShell.hasActiveAccount; enabled: !uiShell.accountBusy
                        onClicked: uiShell.changePassword(pwField.text, newPwField.text)
                    }
                    CwButton {
                        label: "退出登录"; visible: uiShell.hasActiveAccount; enabled: !uiShell.accountBusy
                        onClicked: uiShell.logout()
                    }
                }
                Rectangle { width: parent.width; height: 1; color: ds.border }
                Text { text: "数据操作"; color: ds.text; font.pixelSize: 14; font.weight: Font.Medium; font.family: ds.sans }
                RowLayout {
                    width: parent.width; spacing: ds.sp8
                    CwButton {
                        label: "导出备份"
                        enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                        onClicked: uiShell.requestDataAction("export")
                    }
                    CwButton {
                        label: "导入备份"
                        enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                        onClicked: uiShell.requestDataAction("import")
                    }
                }
                Text {
                    text: uiShell.operationStatus; color: ds.muted; font.pixelSize: 12; font.family: ds.sans
                    visible: uiShell.operationStatus !== ""; wrapMode: Text.WordWrap; width: parent.width
                }
            }
        }
    }

    component ReviewPage: Item {
        ColumnLayout {
            anchors { fill: parent; margins: ds.sp16 }
            spacing: ds.sp12
            RowLayout {
                Layout.fillWidth: true
                Text { text: "复习与进度"; color: ds.text; font.pixelSize: 16; font.weight: Font.Medium; font.family: ds.sans }
                Item { Layout.fillWidth: true }
                CwButton { label: "刷新"; enabled: !uiShell.operationBusy; onClicked: uiShell.refreshReviewSummary() }
            }
            Rectangle { Layout.fillWidth: true; height: 1; color: ds.border }
            Text {
                Layout.fillWidth: true
                text: uiShell.progressSummary || "暂无进度数据"
                color: uiShell.progressSummary ? ds.text : ds.muted
                font.pixelSize: 13; font.family: ds.sans; wrapMode: Text.WordWrap
            }
            Rectangle { Layout.fillWidth: true; height: 1; color: ds.border }
            Text { text: "复习记录"; color: ds.muted; font.pixelSize: 12; font.family: ds.sans; font.weight: Font.Medium }
            ScrollView {
                Layout.fillWidth: true; Layout.fillHeight: true
                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                TextArea {
                    text: uiShell.reviewSummary || "暂无复习记录"
                    readOnly: true; wrapMode: TextArea.Wrap
                    color: uiShell.reviewSummary ? ds.text : ds.muted
                    font.pixelSize: 12; font.family: ds.sans
                    background: Rectangle { color: ds.panelRaised; radius: 4 }
                    Accessible.name: "复习记录"
                }
            }
        }
    }

    component CwButton: Rectangle {
        id: cwBtn
        property string label: ""
        property bool enabled: true
        signal clicked
        implicitWidth: btnLabel.implicitWidth + ds.sp16 * 2
        implicitHeight: 32
        radius: 4
        color: btnMa.containsPress ? Qt.darker(ds.accent, 1.4) :
               btnMa.containsMouse ? Qt.alpha(ds.accent, 0.18) : ds.panelRaised
        border.color: cwBtn.enabled ? (btnMa.containsMouse ? ds.accent : ds.border) : ds.border
        opacity: cwBtn.enabled ? 1.0 : 0.4
        Text {
            id: btnLabel; anchors.centerIn: parent
            text: cwBtn.label; color: ds.text
            font.pixelSize: 12; font.family: ds.sans
        }
        MouseArea {
            id: btnMa; anchors.fill: parent; hoverEnabled: true
            enabled: cwBtn.enabled
            cursorShape: Qt.PointingHandCursor
            onClicked: cwBtn.clicked()
        }
        Accessible.role: Accessible.Button
        Accessible.name: label
        Accessible.onPressAction: if (cwBtn.enabled) cwBtn.clicked()
    }
}
