import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Shapes
import QtQuick.Effects
import "components"
import "pages"

// ── CodeCanvas desktop shell ────────────────────────────────────────────────
// Visual replica of the web frontend (网页端). The language stays Qt Quick/QML
// + C++; only the presentation layer is rebuilt.
//
// Every number here is the RESOLVED computed value from the live web app. The
// web loads tokens.css, then styles.css, then desktop-theme.css — and the last
// one wins every tie. So the accent is #8ed5ff (not tokens.css' #22d3ee), the
// page is #0f131b (not #05070d), the topbar is 68px (not 64px), and
// --radius-panel is 8px. Measured 2026-10-06 at 1440x900.

Rectangle {
    id: root
    width: 1440
    height: 900
    color: ds.page

    // Performance probe hooks — these exact names must survive.
    property bool benchmarkScrolling: false
    property int selectedLessonIndex: 0
    property int lessonStatusFilter: 0
    property alias designSystem: ds
    property bool quickActionsOpen: false
    property bool notificationsOpen: false
    property bool accountMenuOpen: false
    property bool settingsOpen: false
    property bool helpOpen: false
    property bool checkinCalendarOpen: false
    property string sidebarReviewDay: ""
    function refreshSidebarReview() {
        const today = uiShell.checkinSummary.todayKey;
        if (!uiShell.hasActiveAccount || uiShell.operationBusy || uiShell.executionBusy
                || uiShell.accountBusy || sidebarReviewDay === today) return;
        sidebarReviewDay = today;
        if (uiShell.analysisSnapshot.todayKey !== today) uiShell.refreshReviewSummary();
    }
    property Item dialogReturnFocusItem
    function returnDialogFocus() {
        const item = dialogReturnFocusItem;
        if (item) Qt.callLater(function() { item.forceActiveFocus(Qt.PopupFocusReason); });
    }
    function openEvidenceDialog() {
        evidenceDialog.open();
        if (uiShell.hasActiveAccount && !uiShell.operationBusy && !uiShell.executionBusy)
            uiShell.refreshReviewSummary();
    }
    function openLearningHelp(trigger) {
        dialogReturnFocusItem = trigger;
        helpDialog.open();
    }
    function openLesson(index) {
        if (index < 0 || index >= uiShell.lessonMeta.length || uiShell.contentBusy
                || uiShell.operationBusy || uiShell.accountBusy || uiShell.draftSaving) return false;
        const lesson = uiShell.lessonMeta[index];
        const publishedIndex = uiShell.publishedIds.indexOf(lesson.id);
        if (publishedIndex < 0) return false;
        if (uiShell.documentId !== lesson.id || !uiShell.hasSelectedContent) {
            uiShell.openPublishedContent(publishedIndex);
            if (uiShell.documentId !== lesson.id) return false;
        }
        selectedLessonIndex = index;
        uiShell.selectPage("编辑器");
        return true;
    }

    Connections {
        target: uiShell
        function onAccountChanged() {
            root.sidebarReviewDay = "";
            checkinDialog.close();
            Qt.callLater(root.refreshSidebarReview);
        }
        function onOperationBusyChanged() { if (!uiShell.operationBusy) Qt.callLater(root.refreshSidebarReview); }
        function onAccountBusyChanged() { if (!uiShell.accountBusy) Qt.callLater(root.refreshSidebarReview); }
        function onExecutionBusyChanged() { if (!uiShell.executionBusy) Qt.callLater(root.refreshSidebarReview); }
        function onSelectedContentChanged() {
            for (let index = 0; index < uiShell.lessonMeta.length; index++) {
                if (uiShell.lessonMeta[index].id === uiShell.documentId) {
                    root.selectedLessonIndex = index;
                    return;
                }
            }
        }
    }

    function searchResults(query) {
        const needle = query.trim().toLocaleLowerCase();
        if (!needle) return [];
        const rows = [];
        uiShell.lessonMeta.forEach(function(item, index) {
            const haystack = [item.title, item.description, item.language].join(" ").toLocaleLowerCase();
            if (haystack.indexOf(needle) >= 0)
                rows.push({ kind: "lesson", label: item.title, detail: item.language || "课程", index: index });
        });
        uiShell.challengeMeta.forEach(function(item) {
            const haystack = [item.title, item.description, item.track, (item.stack || []).join(" ")]
                    .join(" ").toLocaleLowerCase();
            if (haystack.indexOf(needle) >= 0)
                rows.push({ kind: "challenge", label: item.title, detail: item.track || "挑战", index: 0 });
        });
        return rows.slice(0, 8);
    }

    function closeTopbarPopups(includeSearch = true) {
        quickActionsOpen = false;
        notificationsOpen = false;
        accountMenuOpen = false;
        if (quickPopup.opened) quickPopup.closeForTransfer();
        if (notificationPopup.opened) notificationPopup.closeForTransfer();
        if (accountPopup.opened) accountPopup.closeForTransfer();
        if (includeSearch && searchPopup.opened) searchPopup.closeForTransfer();
    }
    readonly property int safeSelectedLessonIndex: uiShell.lessonMeta.length > 0
        ? (selectedLessonIndex >= 0 && selectedLessonIndex < uiShell.lessonMeta.length ? selectedLessonIndex : 0) : -1
    readonly property var selectedLesson: safeSelectedLessonIndex >= 0
        ? uiShell.lessonMeta[safeSelectedLessonIndex] : null
    readonly property int stageCount: uiShell.challengeMeta.map(function(item) { return item.stageId; })
        .filter(function(id, index, all) { return id && all.indexOf(id) === index; }).length

    function isErrorStatus(status) {
        if (status === "" || status === "尚未加载课程内容" || status.indexOf("正在") === 0
                || status.indexOf("已读取") === 0 || status.indexOf("课程正文已读取") === 0
                || status.indexOf("起始代码已读取") === 0 || status.indexOf("草稿已保存") === 0
                || status.indexOf("草稿已读取") === 0
                || status === "没有已保存草稿，使用起始代码"
                || status.indexOf("草稿读取已取消") === 0
                || status.indexOf("已保存提交时的草稿") === 0
                || status.indexOf("草稿保存已取消") === 0
                || status.indexOf("课程读取已取消") === 0
                || status.indexOf("课程正文读取已取消") === 0
                || status.indexOf("起始代码读取已取消") === 0)
            return false;
        return true;
    }

    readonly property string page: uiShell.currentPage
    readonly property bool workspaceCodeMode: page === "编辑器" && editorLoader.item !== null
                                             && editorLoader.item.codeMode
    readonly property string breadcrumbText: "Code Canvas / " + page
        + (page === "编辑器" && uiShell.hasSelectedContent ? " / "
           + (selectedLesson && selectedLesson.id === uiShell.documentId
              ? String(safeSelectedLessonIndex + 1).padStart(2, "0") + " · " + selectedLesson.title
              : uiShell.documentId) : "")

    // ── Design tokens ───────────────────────────────────────────────────────
    DesignSystem {
        id: ds
        objectName: "designSystem"
        hostWidth: root.width
        reducedMotion: uiShell.reducedMotion
    }

    // root grid backdrop (web .shell-decor)
    Canvas {
        anchors.fill: parent
        z: 0
        onPaint: {
            const ctx = getContext("2d");
            ctx.clearRect(0, 0, width, height);
            ctx.strokeStyle = "rgba(140,175,220,0.045)";
            ctx.lineWidth = 1;
            for (let x = 0; x <= width; x += 44) {
                ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); ctx.stroke();
            }
            for (let y = 0; y <= height; y += 44) {
                ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); ctx.stroke();
            }
        }
    }

    // ── Topbar ──────────────────────────────────────────────────────────────
    Rectangle {
        id: topbar
        anchors { top: parent.top; left: parent.left; right: parent.right }
        visible: !root.workspaceCodeMode
        height: visible ? ds.topbarH : 0
        color: ds.chrome
        z: 30

        Rectangle {
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
            height: 1
            color: ds.line
        }

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: ds.s24
            anchors.rightMargin: ds.s24
            spacing: ds.s20

            // .desktop-brand
            RowLayout {
                spacing: ds.s10
                Layout.alignment: Qt.AlignVCenter
                Rectangle {
                    implicitWidth: 32
                    implicitHeight: 32
                    radius: ds.radiusSm
                    color: ds.markBg
                    border.color: ds.accentRing
                    border.width: 1
                    Text {
                        anchors.centerIn: parent
                        text: "</>"
                        color: ds.accent
                        font.family: ds.mono
                        font.pixelSize: 12
                        font.weight: Font.Bold
                    }
                }
                Text {
                    text: "CodeCanvas"
                    color: ds.ink
                    font.family: ds.ui
                    font.pixelSize: 21
                    font.weight: Font.DemiBold
                    font.letterSpacing: 0
                }
                Rectangle {
                    implicitWidth: desktopTag.implicitWidth + ds.s12
                    implicitHeight: 20
                    radius: 3
                    color: ds.accentSoft
                    border.color: ds.accentRing
                    border.width: 1
                    Layout.alignment: Qt.AlignVCenter
                    Text {
                        id: desktopTag
                        anchors.centerIn: parent
                        text: "APP"
                        color: ds.accent
                        font.family: ds.mono
                        font.pixelSize: 10
                        font.letterSpacing: 1
                    }
                }
            }

            // .desktop-areas — 工作区 / 个人中心
            Rectangle {
                Layout.alignment: Qt.AlignVCenter
                implicitWidth: areaRow.implicitWidth + ds.s8
                implicitHeight: 44
                radius: ds.radius
                color: "#090d14"
                border.color: ds.line
                border.width: 1
                RowLayout {
                    id: areaRow
                    anchors.centerIn: parent
                    spacing: ds.s4
                    Repeater {
                        model: [{ t: "工作区", p: "学习", icon: "▦" }, { t: "个人中心", p: "账户", icon: "○" }]
                        delegate: Rectangle {
                            required property var modelData
                            implicitWidth: areaTabContent.implicitWidth + ds.s24
                            implicitHeight: 34
                            radius: ds.radiusSm
                            color: root.page === modelData.p ? ds.accentSoft : "transparent"
                            border.color: root.page === modelData.p ? ds.accentRing : "transparent"
                            border.width: 1

                            // 三态动画：静止 / 悬停 / 选中
                            Behavior on color {
                                ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                            }
                            Behavior on border.color {
                                ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                            }

                            // 底部青色下划线（仅选中态显示）
                            Rectangle {
                                anchors { bottom: parent.bottom; horizontalCenter: parent.horizontalCenter }
                                width: parent.width - ds.s12
                                height: 2
                                color: ds.accent
                                opacity: root.page === modelData.p ? 1.0 : 0.0
                                Behavior on opacity {
                                    NumberAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                                }
                            }

                            Row {
                                id: areaTabContent
                                anchors.centerIn: parent
                                spacing: ds.s6
                                Text {
                                    text: modelData.icon
                                    color: root.page === modelData.p ? ds.accent : (areaTabHover.hovered ? ds.ink : ds.muted)
                                    font.family: Qt.platform.os === "windows" ? "Segoe UI Symbol" : ds.ui
                                    font.pixelSize: 14
                                }
                                Text {
                                    id: atLabel
                                    text: modelData.t
                                    color: root.page === modelData.p ? ds.accent : (areaTabHover.hovered ? ds.ink : ds.muted)
                                    font.family: ds.ui
                                    font.pixelSize: 13

                                    Behavior on color {
                                        ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                                    }
                                }
                            }
                            HoverHandler { id: areaTabHover; cursorShape: Qt.PointingHandCursor }
                            TapHandler { onTapped: uiShell.selectPage(modelData.p) }
                        }
                    }
                }
            }

            Text {
                objectName: "breadcrumbs"
                visible: root.width <= 1200
                Layout.minimumWidth: 0
                text: root.breadcrumbText
                elide: Text.ElideRight
                color: ds.muted
                font.family: ds.ui
                font.pixelSize: 12
                Accessible.name: "当前位置：" + text
            }

            // .global-search
            Rectangle {
                id: searchBox
                Layout.alignment: Qt.AlignVCenter
                objectName: "globalSearchBox"
                Layout.fillWidth: true
                Layout.minimumWidth: 100
                Layout.leftMargin: ds.s2
                Layout.rightMargin: ds.s2
                implicitHeight: 41
                radius: ds.radius
                color: ds.inset
                border.color: searchField.activeFocus ? ds.accent : ds.lineStrong
                border.width: 1
                RowLayout {
                    anchors { fill: parent; leftMargin: ds.s12; rightMargin: ds.s12 }
                    spacing: ds.s8
                    Text {
                        text: "⌕"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 14
                        Layout.alignment: Qt.AlignVCenter
                    }
                    TextField {
                        id: searchField
                        objectName: "globalSearchField"
                        Layout.fillWidth: true
                        placeholderText: "搜索课程 / 挑战 / 项目"
                        placeholderTextColor: ds.muted
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 14
                        background: null
                        onTextChanged: {
                            if (text.trim()) {
                                root.closeTopbarPopups(false);
                                searchResultsView.currentIndex = 0;
                                searchPopup.open();
                            }
                            else searchPopup.close();
                        }
                        onActiveFocusChanged: if (!activeFocus) Qt.callLater(function() {
                            if (!searchField.activeFocus && !searchResultsView.activeFocus && !clearSearchButton.activeFocus)
                                searchPopup.closeForTransfer();
                        })
                        Keys.onEscapePressed: searchPopup.close()
                        Keys.onDownPressed: {
                            if (searchResultsView.count) {
                                searchPopup.open();
                                searchResultsView.currentIndex = 0;
                                searchResultsView.forceActiveFocus();
                            }
                        }
                        Accessible.name: "全局搜索课程、挑战与项目"
                    }
                }
            }

            // .topbar-actions
            RowLayout {
                spacing: ds.s8
                Layout.alignment: Qt.AlignVCenter

                MotionAwareBusyIndicator {
                    objectName: "topbarBusyIndicator"
                    ds: root.designSystem
                    busy: uiShell.operationBusy || uiShell.contentBusy
                          || uiShell.draftSaving || uiShell.executionBusy
                    implicitWidth: 20
                    implicitHeight: 20
                    accessibleName: "正在处理"
                }

                IconButton {
                    ds: root.designSystem
                    id: quickButton
                    objectName: "quickButton"
                    glyph: "⚡"
                    tip: "快捷动作"
                    active: root.quickActionsOpen
                    onClicked: {
                        const shouldOpen = !quickPopup.opened;
                        root.closeTopbarPopups();
                        root.quickActionsOpen = shouldOpen;
                        if (root.quickActionsOpen) quickPopup.open(); else quickPopup.close();
                    }
                }
                IconButton {
                    ds: root.designSystem
                    id: notificationButton
                    objectName: "notificationButton"
                    glyph: "🔔"
                    tip: "通知中心（无未读）"
                    active: root.notificationsOpen
                    onClicked: {
                        const shouldOpen = !notificationPopup.opened;
                        root.closeTopbarPopups();
                        root.notificationsOpen = shouldOpen;
                        if (root.notificationsOpen) notificationPopup.open(); else notificationPopup.close();
                    }
                }

                // .desktop-local — 本机工作空间
                Rectangle {
                    implicitWidth: localRow.implicitWidth + ds.s20
                    implicitHeight: 28
                    radius: ds.radiusSm
                    color: "transparent"
                    border.color: ds.cyanEdge
                    border.width: 1
                    RowLayout {
                        id: localRow
                        anchors.centerIn: parent
                        spacing: ds.s6
                        Rectangle {
                            implicitWidth: 6
                            implicitHeight: 6
                            radius: 3
                            color: ds.cyan
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Text {
                            text: "本机工作空间"
                            color: ds.cyanText
                            font.family: ds.ui
                            font.pixelSize: 11
                            Layout.alignment: Qt.AlignVCenter
                        }
                    }
                }

                IconButton {
                    ds: root.designSystem
                    id: settingsButton
                    objectName: "settingsButton"
                    glyph: "⚙"
                    tip: "账户与设置"
                    onClicked: {
                        root.dialogReturnFocusItem = settingsButton;
                        root.closeTopbarPopups();
                        settingsDialog.open();
                    }
                }

                // .topbar-avatar
                Rectangle {
                    id: topbarAvatar
                    objectName: "topbarAvatar"
                    activeFocusOnTab: true
                    function toggleMenu() {
                        const shouldOpen = !accountPopup.opened;
                        root.closeTopbarPopups();
                        root.accountMenuOpen = shouldOpen;
                        if (shouldOpen) accountPopup.open();
                    }
                    Keys.onReturnPressed: toggleMenu()
                    Keys.onSpacePressed: toggleMenu()
                    implicitWidth: 34
                    implicitHeight: 34
                    radius: ds.radius
                    color: ds.accent
                    border.color: ds.accentEdge
                    border.width: 1
                    Layout.alignment: Qt.AlignVCenter
                    Text {
                        anchors.centerIn: parent
                        text: uiShell.hasActiveAccount && uiShell.accountName.length > 0
                              ? uiShell.accountName.charAt(0) : "?"
                        color: ds.inkOnAccent
                        font.family: ds.ui
                        font.pixelSize: 13
                        font.weight: Font.Bold
                    }
                    TapHandler {
                        onTapped: {
                            topbarAvatar.toggleMenu();
                        }
                    }
                    Accessible.role: Accessible.Button
                    Accessible.name: "账户菜单"
                }
            }
        }
    }

    Timer {
        interval: 30000
        repeat: true
        running: true
        onTriggered: {
            uiShell.refreshLocalDay();
            root.refreshSidebarReview();
        }
    }

        ShellPopup {
            id: searchPopup
            objectName: "searchPopup"
            parent: root
            anchorItem: searchBox
            alignRight: false
            anchorGap: ds.s6
            width: searchBox.width
            height: Math.min(360, Math.max(93, searchResultsView.contentHeight + ds.s24))
            ds: root.designSystem
            returnFocusItem: searchField
            onOpened: searchField.forceActiveFocus()

            ListView {
                id: searchResultsView
                objectName: "searchResultsView"
                anchors.fill: parent
                clip: true
                focus: true
                model: root.searchResults(searchField.text)
                function activateCurrent() {
                    if (currentIndex < 0 || currentIndex >= count) return;
                    const result = model[currentIndex];
                    if (result.kind === "lesson") {
                        root.openLesson(result.index);
                    } else uiShell.selectPage("挑战");
                    searchField.text = "";
                    searchPopup.close();
                }
                delegate: Rectangle {
                    required property var modelData
                    width: searchResultsView.width
                    height: 46
                    radius: ds.radiusSm
                    color: searchRowHover.hovered || ListView.isCurrentItem && searchResultsView.activeFocus
                        ? ds.accentSoft : "transparent"
                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: ds.s8
                        anchors.rightMargin: ds.s8
                        spacing: ds.s8
                        Text { text: modelData.kind === "lesson" ? "课程" : "挑战"; color: ds.accent; font.family: ds.mono; font.pixelSize: 11 }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0
                            Text { Layout.fillWidth: true; text: modelData.label; color: ds.ink; font.family: ds.ui; font.pixelSize: 13; elide: Text.ElideRight }
                            Text { Layout.fillWidth: true; text: modelData.detail; color: ds.faint; font.family: ds.mono; font.pixelSize: 11; elide: Text.ElideRight }
                        }
                    }
                    HoverHandler { id: searchRowHover }
                    TapHandler {
                        onTapped: {
                            if (modelData.kind === "lesson") {
                                root.openLesson(modelData.index);
                            } else {
                                uiShell.selectPage("挑战");
                            }
                            searchField.text = "";
                            searchPopup.close();
                        }
                    }
                }
                Keys.onPressed: function(event) {
                    if (event.key === Qt.Key_Down) { currentIndex = Math.min(count - 1, currentIndex + 1); event.accepted = true; }
                    else if (event.key === Qt.Key_Up) { currentIndex = Math.max(0, currentIndex - 1); event.accepted = true; }
                    else if (event.key === Qt.Key_Home) { currentIndex = 0; event.accepted = true; }
                    else if (event.key === Qt.Key_End) { currentIndex = count - 1; event.accepted = true; }
                    else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) { activateCurrent(); event.accepted = true; }
                    else if (event.key === Qt.Key_Escape) { searchPopup.close(); event.accepted = true; }
                }
            }
            RowLayout {
                anchors.centerIn: parent
                visible: searchResultsView.count === 0
                Text {
                    text: searchField.text.trim() === "" ? "输入关键词搜索课程和挑战" : "没有匹配的结果"
                    color: ds.muted; font.family: ds.ui; font.pixelSize: 13
                }
                QuietButton {
                    id: clearSearchButton
                    objectName: "clearSearchButton"
                    ds: root.designSystem
                    label: "清除搜索"
                    visible: searchField.text.trim() !== ""
                    onClicked: searchField.clear()
                }
            }
        }

        ShellPopup {
            id: quickPopup
            objectName: "quickPopup"
            parent: root
            anchorItem: quickButton
            menuItems: [continueAction, reviewAction, helpAction]
            width: 268
            height: quickActionsColumn.implicitHeight + ds.s24
            ds: root.designSystem
            returnFocusItem: quickButton
            onClosed: root.quickActionsOpen = false
            ColumnLayout {
                id: quickActionsColumn
                anchors.fill: parent
                spacing: ds.s6
                Text { text: "快捷动作"; color: ds.ink; font.family: ds.ui; font.pixelSize: 16; font.weight: Font.DemiBold }
                Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }
                ShellMenuItem {
                    id: continueAction
                    objectName: "continueAction"
                    ds: root.designSystem
                    Layout.fillWidth: true
                    glyph: "▶"
                    label: "继续学习"
                    detail: root.selectedLesson ? root.selectedLesson.title : "暂无可继续的课程"
                    framed: true
                    enabled: root.selectedLesson !== null
                    onClicked: { quickPopup.close(); root.openLesson(root.safeSelectedLessonIndex); }
                }
                ShellMenuItem {
                    id: reviewAction
                    objectName: "reviewAction"
                    ds: root.designSystem
                    Layout.fillWidth: true
                    glyph: "↻"
                    label: uiShell.hasActiveAccount && uiShell.analysisSnapshot.reviewDueCount !== undefined
                        ? "今日复习 " + uiShell.analysisSnapshot.reviewDueCount + " 项" : "复习中心"
                    detail: uiShell.hasActiveAccount ? "查看到期复测" : "登录后查看到期复测"
                    framed: true
                    onClicked: { quickPopup.close(); uiShell.selectPage("复习与进度"); }
                }
                ShellMenuItem {
                    id: helpAction
                    objectName: "helpAction"
                    ds: root.designSystem
                    Layout.fillWidth: true
                    glyph: "▤"
                    label: "学习指南"
                    detail: "如何学习"
                    framed: true
                    onClicked: {
                        root.dialogReturnFocusItem = quickButton;
                        quickPopup.closeForTransfer();
                        helpDialog.open();
                    }
                }
            }
        }

        ShellPopup {
            id: notificationPopup
            objectName: "notificationPopup"
            parent: root
            anchorItem: notificationButton
            width: 300
            height: 104
            ds: root.designSystem
            returnFocusItem: notificationButton
            onClosed: root.notificationsOpen = false
            ColumnLayout {
                anchors.fill: parent
                spacing: ds.s8
                Text { text: "通知"; color: ds.ink; font.family: ds.ui; font.pixelSize: 16; font.weight: Font.DemiBold }
                Text { Layout.fillWidth: true; text: "暂无通知，通知来源尚未接入。"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13; wrapMode: Text.WordWrap; lineHeight: 1.6 }
            }
        }

        ShellPopup {
            id: accountPopup
            objectName: "accountPopup"
            parent: root
            anchorItem: topbarAvatar
            anchorGap: ds.s6
            menuItems: [profileAction, securityAction, privacyAction, exportAction, logoutAction]
            width: 196
            padding: ds.s14
            height: accountActionsColumn.implicitHeight + padding * 2
            ds: root.designSystem
            returnFocusItem: topbarAvatar
            onClosed: root.accountMenuOpen = false
            ColumnLayout {
                id: accountActionsColumn
                anchors.fill: parent
                spacing: ds.s6
                Text { text: uiShell.hasActiveAccount ? uiShell.accountName : "访客模式"; color: ds.ink; font.family: ds.ui; font.pixelSize: 13; font.weight: Font.DemiBold }
                Text { objectName: "accountContactLabel"; Layout.fillWidth: true; text: uiShell.hasActiveAccount ? (uiShell.accountContact || uiShell.activeAccountId || "—") : "登录后可保存草稿与进度"; color: ds.faint; font.family: ds.mono; font.pixelSize: 12; elide: Text.ElideRight }
                Rectangle { Layout.fillWidth: true; Layout.bottomMargin: ds.s4; height: 1; color: ds.line }
                ShellMenuItem { id: profileAction; objectName: "profileAction"; ds: root.designSystem; Layout.fillWidth: true; glyph: "○"; label: "个人中心"; onClicked: { accountPopup.close(); uiShell.selectPage("账户"); } }
                ShellMenuItem { id: securityAction; objectName: "securityAction"; ds: root.designSystem; Layout.fillWidth: true; glyph: "◆"; label: "账户安全"; onClicked: { accountPopup.close(); uiShell.selectPage("账户安全"); } }
                ShellMenuItem { id: privacyAction; objectName: "privacyAction"; ds: root.designSystem; Layout.fillWidth: true; glyph: "▤"; label: "数据与隐私"; onClicked: { accountPopup.close(); uiShell.selectPage("数据与隐私"); } }
                ShellMenuItem { id: exportAction; objectName: "exportAction"; ds: root.designSystem; Layout.fillWidth: true; glyph: "⇩"; label: "导出学习数据"; enabled: uiShell.hasActiveAccount && !uiShell.operationBusy; onClicked: { accountPopup.close(); uiShell.requestDataAction("backup"); } }
                ShellMenuItem { id: logoutAction; objectName: "logoutAction"; ds: root.designSystem; Layout.fillWidth: true; glyph: "↪"; label: "退出登录"; enabled: uiShell.hasActiveAccount; onClicked: { accountPopup.close(); uiShell.logout(); } }
            }
        }

    // ── Sidebar ─────────────────────────────────────────────────────────────
    Rectangle {
        id: sidebar
        anchors { top: topbar.bottom; left: parent.left; bottom: parent.bottom }
        visible: !root.workspaceCodeMode
        width: visible ? ds.sidebarW : 0
        color: ds.sidebarBg
        z: 15

        Rectangle {
            anchors { right: parent.right; top: parent.top; bottom: parent.bottom }
            width: 1
            color: ds.line
        }

        ColumnLayout {
            anchors.topMargin: ds.s20
            anchors.leftMargin: ds.s12
            anchors.rightMargin: ds.s12
            anchors.bottomMargin: ds.s14
            anchors.fill: parent
            spacing: 0

            // .workspace-switcher
            RowLayout {
                Layout.fillWidth: true
                Layout.leftMargin: ds.s8
                Layout.rightMargin: ds.s8
                Layout.bottomMargin: ds.s24
                spacing: ds.s10
                Rectangle {
                    implicitWidth: 27
                    implicitHeight: 27
                    radius: 6
                    color: ds.subjectOn
                    border.color: ds.accentRing
                    border.width: 1
                    Text {
                        anchors.centerIn: parent
                        text: uiShell.hasActiveAccount && uiShell.accountName.length > 0
                              ? uiShell.accountName.charAt(0) : "学"
                        color: ds.accent
                        font.family: ds.ui
                        font.pixelSize: 13
                        font.weight: Font.ExtraBold
                    }
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Text {
                        Layout.fillWidth: true
                        text: (uiShell.hasActiveAccount ? uiShell.accountName : "访客") + " 的学习区"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 13
                        elide: Text.ElideRight
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "全栈冲刺 · " + root.stageCount + " 阶段"
                        color: "#a3d6df"
                        font.family: ds.ui
                        font.pixelSize: 11
                        elide: Text.ElideRight
                    }
                }
            }

            // p.nav-label — 工作台
            Text {
                Layout.leftMargin: ds.s12
                Layout.bottomMargin: ds.s10
                text: "工作台"
                color: ds.muted
                font.family: ds.ui
                font.pixelSize: 11
                font.weight: Font.DemiBold
                font.letterSpacing: 1
                font.capitalization: Font.AllUppercase
            }

            // nav.main-nav
            ColumnLayout {
                Layout.fillWidth: true
                spacing: ds.s6
                NavItem {
                    ds: root.designSystem
                    Layout.fillWidth: true
                    glyph: "▤"; label: "学习路径"; index: "01"
                    active: root.page === "学习"
                    onActivated: uiShell.selectPage("学习")
                }
                NavItem {
                    ds: root.designSystem
                    Layout.fillWidth: true
                    glyph: "◈"; label: "实战挑战"; index: "02"
                    badge: uiShell.challengeMeta.length > 0
                           ? "" + uiShell.challengeMeta.length : ""
                    active: root.page === "挑战"
                    onActivated: uiShell.selectPage("挑战")
                }
                NavItem {
                    ds: root.designSystem
                    Layout.fillWidth: true
                    glyph: "▥"; label: "代码草稿"; index: "03"
                    active: root.page === "草稿"
                    onActivated: uiShell.selectPage("草稿")
                }
                NavItem {
                    ds: root.designSystem
                    Layout.fillWidth: true
                    glyph: "◷"; label: "复习中心"; index: "04"
                    objectName: "sidebarReviewNavigation"
                    badge: Number(uiShell.analysisSnapshot.reviewDueCount || 0) > 0
                           ? "" + uiShell.analysisSnapshot.reviewDueCount : ""
                    active: root.page === "复习与进度"
                    onActivated: uiShell.selectPage("复习与进度")
                }
                NavItem {
                    ds: root.designSystem
                    Layout.fillWidth: true
                    glyph: "◉"; label: "学习分析"; index: "05"
                    active: root.page === "分析"
                    onActivated: uiShell.selectPage("分析")
                }
            }

            Item { Layout.fillHeight: true }

            // .nav-label #2 — 课程进度
            Text {
                Layout.leftMargin: ds.s12
                Layout.topMargin: ds.s8
                Layout.bottomMargin: ds.s10
                text: "课程进度 · " + root.stageCount + " 阶段"
                color: ds.muted
                font.family: ds.ui
                font.pixelSize: 11
                font.weight: Font.DemiBold
                font.letterSpacing: 1
                font.capitalization: Font.AllUppercase
            }

            // .sidebar-bottom
            ColumnLayout {
                Layout.fillWidth: true
                Layout.topMargin: ds.s20
                spacing: 0

                // .streak-card
                Rectangle {
                    id: checkinCard
                    objectName: "sidebarCheckinCard"
                    readonly property bool canCheckIn: uiShell.hasActiveAccount && uiShell.checkinSummary.ready
                        && !uiShell.checkinSummary.busy && !uiShell.checkinSummary.checkedIn
                    activeFocusOnTab: canCheckIn
                    Keys.onReturnPressed: if (canCheckIn) uiShell.checkIn()
                    Keys.onEnterPressed: if (canCheckIn) uiShell.checkIn()
                    Keys.onSpacePressed: if (canCheckIn) uiShell.checkIn()
                    Layout.fillWidth: true
                    Layout.bottomMargin: ds.s8
                    implicitHeight: 60
                    radius: 7
                    color: streakHover.hovered ? ds.cardHover : ds.panel
                    border.color: ds.line
                    border.width: 1

                    HoverHandler { id: streakHover; cursorShape: checkinCard.canCheckIn ? Qt.PointingHandCursor : Qt.ArrowCursor }

                    // Smooth transition
                    Behavior on color {
                        ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                    }
                    RowLayout {
                        anchors { fill: parent; leftMargin: ds.s10; rightMargin: ds.s10 }
                        spacing: ds.s10
                        Rectangle {
                            implicitWidth: 27
                            implicitHeight: 27
                            radius: 14
                            color: "transparent"
                            border.color: ds.accentRing
                            border.width: 1
                            Text {
                                anchors.centerIn: parent
                                text: "▲"
                                color: ds.accentHi
                                font.family: ds.ui
                                font.pixelSize: 11
                            }
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 1
                            Text {
                                Layout.fillWidth: true
                                objectName: "sidebarCheckinTitle"
                                text: uiShell.checkinSummary.ready
                                      ? (uiShell.checkinSummary.checkedIn ? "已打卡 · 连续 " : "连续打卡 ")
                                        + uiShell.checkinSummary.streakDays + " 天"
                                      : "打卡数据暂无"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 13
                                elide: Text.ElideRight
                            }
                            Text {
                                Layout.fillWidth: true
                                text: uiShell.checkinSummary.busy ? "正在保存…"
                                      : uiShell.checkinSummary.status || (uiShell.checkinSummary.ready
                                        ? (uiShell.checkinSummary.checkedIn ? "明天继续保持" : "点击卡片完成今日打卡")
                                        : "请登录后使用打卡")
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 12
                                elide: Text.ElideRight
                            }
                        }
                    }
                    TapHandler {
                        enabled: checkinCard.canCheckIn
                        onTapped: uiShell.checkIn()
                    }
                    Accessible.role: Accessible.Button
                    Accessible.name: uiShell.checkinSummary.ready
                        ? (uiShell.checkinSummary.checkedIn ? "今日已打卡" : "连续打卡 " + uiShell.checkinSummary.streakDays + " 天，点击打卡")
                        : "打卡数据不可用"
                }
                Text {
                    objectName: "checkinErrorText"
                    Layout.fillWidth: true
                    visible: uiShell.hasActiveAccount && !uiShell.checkinSummary.ready && !!uiShell.checkinSummary.status
                    text: uiShell.checkinSummary.status || ""
                    color: ds.danger; font.family: ds.ui; font.pixelSize: 12
                    wrapMode: Text.Wrap
                }
                RowLayout {
                    Layout.fillWidth: true
                    Layout.bottomMargin: ds.s14
                    MotionAwareBusyIndicator {
                        ds: root.designSystem
                        Layout.preferredWidth: 20; Layout.preferredHeight: 20
                        busy: uiShell.checkinSummary.busy
                        accessibleName: "正在更新打卡状态"
                    }
                    QuietButton {
                        objectName: "checkinRetryButton"
                        ds: root.designSystem
                        label: "重试"
                        visible: uiShell.hasActiveAccount && !uiShell.checkinSummary.ready && !uiShell.checkinSummary.busy
                        onClicked: uiShell.refreshCheckin()
                    }
                    Item { Layout.fillWidth: true }
                    IconButton {
                        id: checkinCalendarButton
                        objectName: "checkinCalendarButton"
                        ds: root.designSystem
                        glyph: "⋯"
                        tip: "查看打卡日历"
                        enabled: uiShell.hasActiveAccount && uiShell.checkinSummary.ready
                        onClicked: checkinDialog.open()
                    }
                }

                // .profile
                Rectangle {
                    Layout.fillWidth: true
                    Layout.leftMargin: ds.s6
                    Layout.rightMargin: ds.s6
                    implicitHeight: 52
                    radius: 7
                    color: ds.raised
                    border.color: ds.line
                    border.width: 1
                    RowLayout {
                        anchors { fill: parent; leftMargin: ds.s8; rightMargin: ds.s8 }
                        spacing: ds.s10
                        Rectangle {
                            implicitWidth: 30
                            implicitHeight: 30
                            radius: 15
                            color: ds.inset
                            border.color: ds.accentRing
                            border.width: 1
                            Text {
                                anchors.centerIn: parent
                                text: uiShell.hasActiveAccount && uiShell.accountName.length > 0
                                      ? uiShell.accountName.charAt(0) : "访"
                                color: ds.accent
                                font.family: ds.ui
                                font.pixelSize: 13
                                font.weight: Font.Bold
                            }
                        }
                        Text {
                            Layout.fillWidth: true
                            text: uiShell.hasActiveAccount ? uiShell.accountName : "访客模式"
                            color: ds.ink
                            font.family: ds.ui
                            font.pixelSize: 13
                            elide: Text.ElideRight
                        }
                    }
                    TapHandler { onTapped: uiShell.selectPage("账户") }
                }
            }
        }
    }

    // ── Main content ────────────────────────────────────────────────────────
    Item {
        id: content
        anchors {
            top: topbar.bottom
            left: sidebar.right
            right: parent.right
            bottom: parent.bottom
        }

        StackLayout {
            anchors.fill: parent
            anchors.leftMargin: root.workspaceCodeMode ? ds.s8 : ds.s24
            anchors.rightMargin: root.workspaceCodeMode ? ds.s8 : ds.s24
            anchors.topMargin: root.workspaceCodeMode ? ds.s8 : ds.s20
            anchors.bottomMargin: root.workspaceCodeMode ? ds.s8 : ds.s20
            currentIndex: {
                switch (root.page) {
                case "挑战": return 1;
                case "草稿": return 2;
                case "复习与进度": return 3;
                case "分析": return 4;
                case "账户": return 5;
                case "账户安全": return 6;
                case "数据与隐私": return 7;
                case "编辑器": return 8;
                default: return 0;
                }
            }

            Loader {
                objectName: "pageLoader"
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "学习" || visited
                onLoaded: {
                    visited = true;
                }
                sourceComponent: StudyPage { hostRoot: root; ds: root.designSystem }
            }
            Loader {
                objectName: "pageLoader"
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "挑战" || visited
                onLoaded: {
                    visited = true;
                }
                sourceComponent: ChallengePage { ds: root.designSystem }
            }
            Loader {
                objectName: "pageLoader"
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "草稿" || visited
                onLoaded: {
                    visited = true;
                }
                sourceComponent: DraftsPage { hostRoot: root; ds: root.designSystem }
            }
            Loader {
                objectName: "pageLoader"
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "复习与进度" || visited
                onLoaded: {
                    visited = true;
                }
                sourceComponent: ReviewPage { hostRoot: root; ds: root.designSystem }
            }
            Loader {
                objectName: "pageLoader"
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "分析" || visited
                onLoaded: {
                    visited = true;
                }
                sourceComponent: AnalyticsPage { ds: root.designSystem }
            }
            Loader {
                objectName: "pageLoader"
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "账户" || visited
                onLoaded: {
                    visited = true;
                }
                sourceComponent: AccountPage { hostRoot: root; ds: root.designSystem }
            }
            Loader {
                objectName: "pageLoader"
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "账户安全" || visited
                onLoaded: { visited = true }
                sourceComponent: SecurityPage { ds: root.designSystem }
            }
            Loader {
                objectName: "pageLoader"
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "数据与隐私" || visited
                onLoaded: { visited = true }
                sourceComponent: PrivacyPage { ds: root.designSystem }
            }
            Loader {
                id: editorLoader
                objectName: "pageLoader"
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "编辑器" || visited
                onLoaded: {
                    visited = true;
                }
                sourceComponent: EditorPage { hostRoot: root; ds: root.designSystem }
            }
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PAGES
    // ═════════════════════════════════════════════════════════════════════════

    // ── 02 代码草稿 ────────────────────────────────────────────────────────
// ── 02 实战挑战 ────────────────────────────────────────────────────────
    // ── 02 实战挑战 ────────────────────────────────────────────────────────

    // ── 03 代码草稿 ────────────────────────────────────────────────────────
    // ── 03 代码草稿 ────────────────────────────────────────────────────────


    // ── Dialogs ─────────────────────────────────────────────────────────────
    ShellPopup {
        id: checkinDialog
        objectName: "checkinCalendarDialog"
        ds: root.designSystem
        modal: true
        returnFocusItem: checkinCalendarButton
        menuItems: [checkinCalendar.previousButton, checkinCalendar.nextButton]
        x: ds.s16
        y: Math.max(ds.s16, Math.min(root.height - height - ds.s16,
            checkinCalendarButton.mapToItem(root, 0, 0).y - height - ds.s8))
        width: Math.min(320, root.width - ds.s32)
        height: contentItem.implicitHeight + padding * 2
        onAboutToShow: {
            checkinCalendar.year = Number(uiShell.checkinSummary.todayKey.slice(0, 4));
            checkinCalendar.month = Number(uiShell.checkinSummary.todayKey.slice(5, 7)) - 1;
        }
        onOpened: root.checkinCalendarOpen = true
        onClosed: root.checkinCalendarOpen = false
        contentItem: CheckinCalendar {
            id: checkinCalendar
            ds: root.designSystem
            summary: uiShell.checkinSummary
        }
    }

    ShellDialog {
        id: settingsDialog
        objectName: "settingsDialog"
        ds: root.designSystem
        title: "设置"
        eyebrow: "工作台偏好"
        referenceStyle: true
        anchors.centerIn: parent
        width: Math.min(560, root.width - ds.s32)
        height: Math.min(root.height * 0.86, root.height - ds.s32)
        onOpened: root.settingsOpen = true
        onClosed: { root.settingsOpen = false; root.returnDialogFocus(); }
        contentItem: ScrollView {
            id: settingsScroll
            objectName: "settingsScroll"
            clip: true
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            SettingsContent {
                width: settingsScroll.availableWidth
                ds: root.designSystem
                onOpenPrivacy: { settingsDialog.close(); uiShell.selectPage("数据与隐私"); }
            }
        }
    }

    ShellDialog {
        id: helpDialog
        objectName: "helpDialog"
        ds: root.designSystem
        closeLabel: "知道了"
        title: "如何学习"
        eyebrow: "使用指南"
        referenceStyle: true
        primaryClose: true
        anchors.centerIn: parent
        width: Math.min(460, root.width - ds.s32)
        height: Math.min(504, root.height - ds.s32)
        onOpened: root.helpOpen = true
        onClosed: { root.helpOpen = false; root.returnDialogFocus(); }
        contentItem: ColumnLayout {
            spacing: ds.s16
            Repeater {
                model: [
                    { title: "可视化执行", body: "运行后可回看真实执行事件与变量快照。流程图高亮当前事件，变量面板显示相邻源码快照的变化。" },
                    { title: "按十步学习法推进", body: "按讲解、例子和练习推进。运行成功后，按课程验收点显式标记完成；系统安排复测，阅读和运行本身不代表掌握。" },
                    { title: "真实与模拟的边界", body: "本机执行需要对应语言工具。外部环境实验需在真实环境完成并提交证据；未采集的事件或变量不会用模拟数据填充。" }
                ]
                delegate: ColumnLayout {
                    required property var modelData
                    Layout.fillWidth: true
                    spacing: ds.s4
                    Text { Layout.fillWidth: true; text: modelData.title; color: ds.ink; font.family: ds.ui; font.pixelSize: 13; font.weight: Font.DemiBold }
                    Text { Layout.fillWidth: true; text: modelData.body; color: ds.muted; font.family: ds.ui; font.pixelSize: 13; wrapMode: Text.WrapAnywhere; lineHeight: 1.6 }
                }
            }
        }
    }

    ShellDialog {
        id: evidenceDialog
        objectName: "lessonEvidenceDialog"
        ds: root.designSystem
        title: "课程证据与完成验收"
        anchors.centerIn: parent
        width: Math.min(620, root.width - ds.s32)
        height: Math.min(720, root.height - ds.s32)
        onClosed: root.returnDialogFocus()
        contentItem: ScrollView {
            id: evidenceScroll
            objectName: "lessonEvidenceScroll"
            clip: true
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            LessonEvidencePanel {
                width: evidenceScroll.availableWidth
                ds: root.designSystem
            }
        }
    }
}
