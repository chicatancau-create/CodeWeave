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
    function openPasswordDialog() { passwordDialog.open(); }
    function openEvidenceDialog() { evidenceDialog.open(); }

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

    function closeTopbarPopups() {
        quickActionsOpen = false;
        notificationsOpen = false;
        accountMenuOpen = false;
        if (quickPopup.opened) quickPopup.close();
        if (notificationPopup.opened) notificationPopup.close();
        if (accountPopup.opened) accountPopup.close();
    }
    readonly property int safeSelectedLessonIndex: uiShell.lessonMeta.length > 0
        ? Math.max(0, Math.min(selectedLessonIndex, uiShell.lessonMeta.length - 1)) : -1
    readonly property var selectedLesson: safeSelectedLessonIndex >= 0
        ? uiShell.lessonMeta[safeSelectedLessonIndex] : null
    readonly property int stageCount: uiShell.challengeMeta.map(function(item) { return item.stageId; })
        .filter(function(id, index, all) { return id && all.indexOf(id) === index; }).length

    function isErrorStatus(status) {
        if (status === "" || status === "尚未加载课程内容" || status.indexOf("正在") === 0
                || status.indexOf("已读取") === 0 || status.indexOf("课程正文已读取") === 0
                || status.indexOf("起始代码已读取") === 0 || status.indexOf("草稿已保存") === 0
                || status.indexOf("已保存提交时的草稿") === 0
                || status.indexOf("草稿保存已取消") === 0
                || status.indexOf("课程读取已取消") === 0
                || status.indexOf("课程正文读取已取消") === 0
                || status.indexOf("起始代码读取已取消") === 0)
            return false;
        return true;
    }

    readonly property string page: uiShell.currentPage
    readonly property string breadcrumbText: "Code Canvas / " + page
        + (page === "编辑器" && selectedLesson ? " / "
           + String(safeSelectedLessonIndex + 1).padStart(2, "0") + " · " + selectedLesson.title : "")

    // ── Design tokens ───────────────────────────────────────────────────────
    DesignSystem {
        id: ds
        hostWidth: root.width
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
        height: ds.topbarH
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
                    font.letterSpacing: -0.8
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
                        text: "DESKTOP"
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
                        model: [{ t: "工作区", p: "学习" }, { t: "个人中心", p: "账户" }]
                        delegate: Rectangle {
                            required property var modelData
                            implicitWidth: atLabel.implicitWidth + ds.s24
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

                            Text {
                                id: atLabel
                                anchors.centerIn: parent
                                text: modelData.t
                                color: root.page === modelData.p ? ds.accent : (areaTabHover.hovered ? ds.ink : ds.muted)
                                font.family: ds.ui
                                font.pixelSize: 13

                                Behavior on color {
                                    ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
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
                Layout.fillWidth: true
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
                Layout.preferredWidth: Math.min(root.width * 0.25, 330)
                implicitHeight: 36
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
                        Layout.fillWidth: true
                        placeholderText: "搜索课程 / 挑战 / 项目"
                        placeholderTextColor: ds.muted
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 14
                        background: null
                        onTextChanged: {
                            if (text.trim()) searchPopup.open();
                            else searchPopup.close();
                        }
                        onActiveFocusChanged: if (!activeFocus && text.trim() === "") searchPopup.close()
                        Keys.onDownPressed: {
                            if (searchResultsView.count) {
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

                BusyIndicator {
                    running: uiShell.operationBusy || uiShell.contentBusy
                             || uiShell.draftSaving || uiShell.executionBusy
                    visible: running
                    implicitWidth: 20
                    implicitHeight: 20
                    palette.highlight: ds.accent
                    Accessible.name: "正在处理"
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
                    glyph: "⚙"
                    tip: "账户与设置"
                    onClicked: settingsDialog.open()
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

        ShellPopup {
            id: searchPopup
            x: searchBox.mapToItem(root, 0, 0).x
            y: topbar.height + 4
            width: searchBox.width
            height: Math.min(360, searchResultsView.contentHeight + ds.s24)
            ds: root.designSystem
            returnFocusItem: searchField
            onOpened: searchField.forceActiveFocus()

            ListView {
                id: searchResultsView
                anchors.fill: parent
                clip: true
                focus: true
                model: root.searchResults(searchField.text)
                function activateCurrent() {
                    if (currentIndex < 0 || currentIndex >= count) return;
                    const result = model[currentIndex];
                    if (result.kind === "lesson") {
                        root.selectedLessonIndex = result.index;
                        uiShell.openPublishedContent(result.index);
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
                                root.selectedLessonIndex = modelData.index;
                                uiShell.openPublishedContent(modelData.index);
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
            Text {
                anchors.centerIn: parent
                visible: searchResultsView.count === 0
                text: "没有匹配的结果"
                color: ds.muted
                font.family: ds.ui
                font.pixelSize: 13
            }
        }

        ShellPopup {
            id: quickPopup
            objectName: "quickPopup"
            menuItems: [continueAction, reviewAction, helpAction]
            x: Math.max(ds.s12, quickButton.mapToItem(root, 0, 0).x + quickButton.width - width)
            y: topbar.height + 4
            width: 260
            height: quickActionsColumn.implicitHeight + ds.s24
            ds: root.designSystem
            returnFocusItem: quickButton
            onClosed: root.quickActionsOpen = false
            ColumnLayout {
                id: quickActionsColumn
                anchors.fill: parent
                spacing: ds.s8
                Text { text: "快捷动作"; color: ds.ink; font.family: ds.ui; font.pixelSize: 14; font.weight: Font.DemiBold }
                QuietButton {
                    id: continueAction
                    objectName: "continueAction"
                    ds: root.designSystem
                    Layout.fillWidth: true
                    label: "继续学习"
                    enabled: root.selectedLesson !== null
                    onClicked: { quickPopup.close(); uiShell.openPublishedContent(root.selectedLessonIndex); }
                }
                QuietButton {
                    id: reviewAction
                    objectName: "reviewAction"
                    ds: root.designSystem
                    Layout.fillWidth: true
                    label: "打开复习中心"
                    onClicked: { quickPopup.close(); uiShell.selectPage("复习与进度"); }
                }
                QuietButton {
                    id: helpAction
                    objectName: "helpAction"
                    ds: root.designSystem
                    Layout.fillWidth: true
                    label: "查看帮助"
                    onClicked: { quickPopup.close(); helpDialog.open(); }
                }
                Text { Layout.fillWidth: true; text: root.selectedLesson ? root.selectedLesson.title : "暂无可继续的课程"; color: ds.faint; font.family: ds.mono; font.pixelSize: 11; elide: Text.ElideRight }
            }
        }

        ShellPopup {
            id: notificationPopup
            x: Math.max(ds.s12, notificationButton.mapToItem(root, 0, 0).x + notificationButton.width - width)
            y: topbar.height + 4
            width: 260
            height: 128
            ds: root.designSystem
            returnFocusItem: notificationButton
            onClosed: root.notificationsOpen = false
            ColumnLayout {
                anchors.fill: parent
                spacing: ds.s8
                Text { text: "通知"; color: ds.ink; font.family: ds.ui; font.pixelSize: 14; font.weight: Font.DemiBold }
                Text { Layout.fillWidth: true; text: "暂无新通知。复测到期、挑战通过和打卡里程碑会出现在这里。"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap }
            }
        }

        ShellPopup {
            id: accountPopup
            objectName: "accountPopup"
            menuItems: [profileAction, securityAction, exportAction, logoutAction]
            x: topbar.width - width - ds.s24
            y: topbar.height + 4
            width: 260
            height: accountActionsColumn.implicitHeight + ds.s24
            ds: root.designSystem
            returnFocusItem: topbarAvatar
            onClosed: root.accountMenuOpen = false
            ColumnLayout {
                id: accountActionsColumn
                anchors.fill: parent
                spacing: ds.s8
                Text { text: uiShell.hasActiveAccount ? uiShell.accountName : "访客模式"; color: ds.ink; font.family: ds.ui; font.pixelSize: 14; font.weight: Font.DemiBold }
                Text { Layout.fillWidth: true; text: uiShell.hasActiveAccount ? (uiShell.activeAccountId || "—") : "登录后可保存草稿与进度"; color: ds.faint; font.family: ds.mono; font.pixelSize: 11; elide: Text.ElideRight }
                QuietButton { id: profileAction; objectName: "profileAction"; ds: root.designSystem; Layout.fillWidth: true; label: "个人中心"; onClicked: { accountPopup.close(); uiShell.selectPage("账户"); } }
                QuietButton { id: securityAction; objectName: "securityAction"; ds: root.designSystem; Layout.fillWidth: true; label: "账户安全"; onClicked: { accountPopup.close(); passwordDialog.open(); } }
                QuietButton { id: exportAction; ds: root.designSystem; Layout.fillWidth: true; label: "导出学习数据"; enabled: uiShell.hasActiveAccount && !uiShell.operationBusy; onClicked: { accountPopup.close(); uiShell.requestDataAction("backup"); } }
                QuietButton { id: logoutAction; ds: root.designSystem; Layout.fillWidth: true; label: "退出登录"; visible: uiShell.hasActiveAccount; onClicked: { accountPopup.close(); uiShell.logout(); } }
            }
        }

    // ── Sidebar ─────────────────────────────────────────────────────────────
    Rectangle {
        id: sidebar
        anchors { top: topbar.bottom; left: parent.left; bottom: parent.bottom }
        width: ds.sidebarW
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
                    Layout.fillWidth: true
                    Layout.bottomMargin: ds.s14
                    implicitHeight: 60
                    radius: 7
                    color: streakHover.hovered ? ds.cardHover : ds.panel
                    border.color: ds.line
                    border.width: 1

                    HoverHandler { id: streakHover }

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
                                text: uiShell.analysisSnapshot.streakDays === undefined
                                      || uiShell.analysisSnapshot.streakDays === "暂无数据"
                                      ? "连续打卡数据暂无"
                                      : "连续打卡 " + uiShell.analysisSnapshot.streakDays + " 天"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 13
                            }
                            Text {
                                Layout.fillWidth: true
                                text: uiShell.analysisSnapshot.todayCheckin || "打卡功能待接入"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 12
                                elide: Text.ElideRight
                            }
                        }
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
            anchors.leftMargin: ds.s24
            anchors.rightMargin: ds.s24
            anchors.topMargin: ds.s20
            anchors.bottomMargin: ds.s20
            currentIndex: {
                switch (root.page) {
                case "挑战": return 1;
                case "草稿": return 2;
                case "复习与进度": return 3;
                case "分析": return 4;
                case "账户": return 5;
                case "编辑器": return 6;
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
    Dialog {
        id: settingsDialog
        title: "设置"
        anchors.centerIn: parent
        modal: true
        standardButtons: Dialog.Close
        width: 420
        background: Rectangle {
            color: ds.overlay
            radius: ds.radius
            border.color: ds.lineStrong
            border.width: 1
        }
        contentItem: ColumnLayout {
            spacing: ds.s12
            Text { text: "工作台偏好"; color: ds.ink; font.family: ds.ui; font.pixelSize: 15; font.weight: Font.DemiBold }
            Text { Layout.fillWidth: true; text: "设置项会逐步与网页端保持一致；尚未接入本地持久化的选项保持禁用。"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap }
            CheckBox { text: "减少动效（待接入）"; enabled: false; Accessible.name: "减少动效（待接入）" }
            CheckBox { text: "紧凑工作区（待接入）"; enabled: false; Accessible.name: "紧凑工作区（待接入）" }
        }
    }

    Dialog {
        id: helpDialog
        title: "如何学习"
        anchors.centerIn: parent
        modal: true
        standardButtons: Dialog.Ok
        width: 460
        background: Rectangle {
            color: ds.overlay
            radius: ds.radius
            border.color: ds.lineStrong
            border.width: 1
        }
        contentItem: ColumnLayout {
            spacing: ds.s10
            Text { text: "可视化执行"; color: ds.accent; font.family: ds.ui; font.pixelSize: 13; font.weight: Font.DemiBold }
            Text { Layout.fillWidth: true; text: "点击运行按钮，观察程序的每一步执行过程；流程图和输出区会显示当前运行状态。"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap }
            Text { text: "十步学习法"; color: ds.accent; font.family: ds.ui; font.pixelSize: 13; font.weight: Font.DemiBold }
            Text { Layout.fillWidth: true; text: "每个单元包含讲解、跟做、独立题和变式题；外部环境实验需要在真实环境完成后提交证据。"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap }
        }
    }

    Dialog {
        id: passwordDialog
        title: "账户安全"
        anchors.centerIn: parent
        modal: true
        standardButtons: Dialog.Ok | Dialog.Cancel
        width: 380
        background: Rectangle {
            color: ds.overlay
            radius: ds.radius
            border.color: ds.lineStrong
            border.width: 1
        }
        contentItem: ColumnLayout {
            spacing: ds.s10
            Text {
                text: "修改本机账户密码"
                color: ds.ink
                font.family: ds.ui
                font.pixelSize: 13
            }
            ShellField {
                ds: root.designSystem
                id: dlgCurrent
                Layout.fillWidth: true
                placeholderText: "当前密码"
                echoMode: TextInput.Password
            }
            ShellField {
                ds: root.designSystem
                id: dlgNext
                Layout.fillWidth: true
                placeholderText: "新密码（至少 8 个字符）"
                echoMode: TextInput.Password
            }
        }
        onAccepted: uiShell.changePassword(dlgCurrent.text, dlgNext.text)
    }

    Dialog {
        id: evidenceDialog
        title: "记录实践证据"
        anchors.centerIn: parent
        modal: true
        standardButtons: Dialog.Ok | Dialog.Cancel
        width: 420
        background: Rectangle {
            color: ds.overlay
            radius: ds.radius
            border.color: ds.lineStrong
            border.width: 1
        }
        contentItem: ColumnLayout {
            spacing: ds.s10
            Text {
                text: "记录一次可复现的实践证据"
                color: ds.ink
                font.family: ds.ui
                font.pixelSize: 13
            }
            ShellField { ds: root.designSystem; id: evEnv; Layout.fillWidth: true; placeholderText: "环境" }
            ShellField { ds: root.designSystem; id: evCmd; Layout.fillWidth: true; placeholderText: "命令" }
            ShellField { ds: root.designSystem; id: evSum; Layout.fillWidth: true; placeholderText: "结论摘要" }
        }
        onAccepted: uiShell.saveExternalEvidence(evEnv.text, evCmd.text, evSum.text, "", "")
    }
}
