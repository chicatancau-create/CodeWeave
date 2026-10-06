import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Shapes

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

    readonly property string page: uiShell.currentPage

    // ── Design tokens ───────────────────────────────────────────────────────
    QtObject {
        id: ds

        // Surfaces
        readonly property color page:       "#0f131b"   // --page
        readonly property color chrome:     "#0b1018"   // --chrome (topbar)
        readonly property color sidebarBg:  "#0c1118"
        readonly property color panel:      "#181d25"   // --panel
        readonly property color railPanel:  "#151b24"
        readonly property color inset:      "#0a0e15"   // --inset
        readonly property color overlay:    "#141b25"   // --overlay
        readonly property color raised:     "#131a24"
        readonly property color snippetBg:  "#0b111a"
        readonly property color editorBg:   "#0e0e0f"
        readonly property color stageBg:    "#0b1220"
        readonly property color markBg:     "#182632"
        readonly property color subjectBg:  "#141a23"
        readonly property color subjectOn:  "#153044"
        readonly property color tabActive:  "#161a21"   // #ffffff08 over panel
        readonly property color cardHover:  "#1b2531"

        // Lines — web values are translucent; these are the resolved composites
        readonly property color line:       "#20242b"   // #ffffff12
        readonly property color lineRaised: "#2b313a"   // #ffffff20
        readonly property color lineStrong: "#576578"
        readonly property color accentSoft: "#0f1e29"   // #38bdf814
        readonly property color accentRing: "#19455c"   // #38bdf84d
        readonly property color accentFill: "#10212d"   // #38bdf818
        readonly property color heroEdge:   "#1f3d4d"   // #38bdf838
        readonly property color heroBadge:  "#12222c"   // #38bdf810
        readonly property color heroBadgeEd:"#1a3542"   // #38bdf82b
        readonly property color unitBadge:  "#12222c"   // #38bdf810
        readonly property color unitBadgeEd:"#19313e"   // #38bdf822
        readonly property color hoverWash:  "#161c24"   // rgba(120,165,220,0.045)
        readonly property color pressWash:  "#1b222c"
        readonly property color bannerBg:   "#111923"
        readonly property color trackBg:    "#263140"

        // Text
        readonly property color ink:        "#e2e7ef"
        readonly property color muted:      "#a3afbe"
        readonly property color faint:      "#8d9bac"
        readonly property color inkOnAccent:   "#052536"
        readonly property color codeInk:    "#a6d9fc"

        // Accent family
        readonly property color accent:     "#8ed5ff"
        readonly property color accentHi:   "#b1e4ff"
        readonly property color accentEdge: "#a1ddff"
        readonly property color cyan:       "#00e2e9"
        readonly property color cyanText:   "#b9e8ee"
        readonly property color cyanEdge:   "#1a3a40"

        // Status
        readonly property color success:    "#3fd3a4"
        readonly property color warning:    "#ffc457"
        readonly property color danger:     "#ff8371"
        readonly property color info:       "#5b86ff"

        // Node tones
        readonly property color tonePurple: "#a78bfa"
        readonly property color toneBlue:   "#5b86ff"
        readonly property color toneYellow: "#ffc457"
        readonly property color toneCoral:  "#ff8371"
        readonly property color toneGreen:  "#3fd3a4"

        // Typography — mono is NOT overridden by the desktop theme
        readonly property string ui:   "Segoe UI, Microsoft YaHei, sans-serif"
        readonly property string mono: "Consolas, Cascadia Mono, Microsoft YaHei, monospace"

        // Spacing
        readonly property int s2: 2;   readonly property int s4: 4
        readonly property int s6: 6;   readonly property int s8: 8
        readonly property int s10: 10; readonly property int s12: 12
        readonly property int s14: 14; readonly property int s16: 16
        readonly property int s20: 20; readonly property int s22: 22
        readonly property int s24: 24; readonly property int s32: 32

        // Shell metrics
        readonly property int topbarH: 68
        readonly property int sidebarW: 240
        readonly property int railW: 286
        readonly property int radius: 8
        readonly property int radiusSm: 5
    }

    // ── Shared components ───────────────────────────────────────────────────

    // web .app-shell .nav-item — 43px, radius 6, icon · label · index, badge
    component NavItem: Item {
        id: nav
        property string glyph: ""
        property string label: ""
        property string index: ""
        property string badge: ""
        property bool active: false
        signal activated

        implicitHeight: 43
        Rectangle {
            anchors.fill: parent
            radius: 6
            color: nav.active ? ds.accentFill
                              : (navHover.hovered ? ds.hoverWash : "transparent")
            border.color: nav.active ? ds.accentRing : "transparent"
            border.width: 1
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: ds.s12
                anchors.rightMargin: ds.s12
                spacing: ds.s10
                Text {
                    text: nav.glyph
                    color: nav.active ? ds.accent : ds.faint
                    font.family: ds.ui
                    font.pixelSize: 15
                    Layout.alignment: Qt.AlignVCenter
                }
                Text {
                    text: nav.label
                    color: nav.active ? ds.ink : ds.muted
                    font.family: ds.ui
                    font.pixelSize: 13
                    font.weight: Font.Medium
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                    Layout.alignment: Qt.AlignVCenter
                }
                Rectangle {   // .nav-badge
                    visible: nav.badge !== ""
                    Layout.alignment: Qt.AlignVCenter
                    implicitWidth: badgeLabel.implicitWidth + ds.s12
                    implicitHeight: 18
                    radius: 3
                    color: ds.accentSoft
                    border.color: ds.accentRing
                    border.width: 1
                    Text {
                        id: badgeLabel
                        anchors.centerIn: parent
                        text: nav.badge
                        color: ds.accent
                        font.family: ds.mono
                        font.pixelSize: 11
                        font.weight: Font.Bold
                    }
                }
                Text {   // .nav-item__index — right-aligned, mono, 0.2em tracking
                    text: nav.index
                    color: nav.active ? ds.accentHi : ds.faint
                    font.family: ds.mono
                    font.pixelSize: 13
                    font.letterSpacing: 2
                    Layout.alignment: Qt.AlignVCenter
                }
            }
        }
        HoverHandler { id: navHover; cursorShape: Qt.PointingHandCursor }
        TapHandler { onTapped: nav.activated() }
        Accessible.role: Accessible.PageTab
        Accessible.name: nav.label
        Accessible.selected: nav.active
    }

    // web .icon-button — 36x36, radius 8
    component IconButton: Rectangle {
        id: ibtn
        property string glyph: ""
        property string tip: ""
        property bool active: false
        signal clicked
        implicitWidth: 36
        implicitHeight: 36
        radius: 8
        color: ibtn.active || ibHover.hovered ? ds.accentSoft : "transparent"
        Text {
            anchors.centerIn: parent
            text: ibtn.glyph
            color: ibtn.active || ibHover.hovered ? ds.accentHi : ds.muted
            font.family: ds.ui
            font.pixelSize: 15
        }
        HoverHandler { id: ibHover; cursorShape: Qt.PointingHandCursor }
        TapHandler { onTapped: ibtn.clicked() }
        Accessible.role: Accessible.Button
        Accessible.name: ibtn.tip !== "" ? ibtn.tip : ibtn.glyph
    }

    // web .app-shell .primary-action — 36px, radius 5, accent fill, dark ink
    component PrimaryButton: Rectangle {
        id: pbtn
        property string label: ""
        property bool enabled: true
        signal clicked
        implicitWidth: pLabel.implicitWidth + ds.s32
        implicitHeight: 36
        radius: ds.radiusSm
        color: !pbtn.enabled ? ds.inset : (pbtnHover.hovered ? ds.accentHi : ds.accent)
        border.color: pbtn.enabled ? ds.accentEdge : ds.line
        border.width: 1
        Text {
            id: pLabel
            anchors.centerIn: parent
            text: pbtn.label
            color: pbtn.enabled ? ds.inkOnAccent : ds.faint
            font.family: ds.ui
            font.pixelSize: 13
            font.weight: Font.DemiBold
            font.letterSpacing: 0.26
        }
        HoverHandler { id: pbtnHover; enabled: pbtn.enabled; cursorShape: Qt.PointingHandCursor }
        TapHandler { enabled: pbtn.enabled; onTapped: pbtn.clicked() }
        Accessible.role: Accessible.Button
        Accessible.name: pbtn.label
    }

    // web .subtle-button — quiet bordered action
    component QuietButton: Rectangle {
        id: qbtn
        property string label: ""
        property bool enabled: true
        signal clicked
        implicitWidth: qLabel.implicitWidth + ds.s24
        implicitHeight: 36
        radius: ds.radiusSm
        color: qbtnHover.hovered && qbtn.enabled ? ds.accentSoft : "transparent"
        border.color: qbtnHover.hovered && qbtn.enabled ? ds.accent : ds.lineStrong
        border.width: 1
        opacity: qbtn.enabled ? 1.0 : 0.45
        Text {
            id: qLabel
            anchors.centerIn: parent
            text: qbtn.label
            color: qbtnHover.hovered && qbtn.enabled ? ds.accentHi : ds.ink
            font.family: ds.ui
            font.pixelSize: 13
        }
        HoverHandler { id: qbtnHover; enabled: qbtn.enabled; cursorShape: Qt.PointingHandCursor }
        TapHandler { enabled: qbtn.enabled; onTapped: qbtn.clicked() }
        Accessible.role: Accessible.Button
        Accessible.name: qbtn.label
    }

    // web .global-search__input
    component ShellField: TextField {
        id: sf
        implicitHeight: 36
        color: ds.ink
        placeholderTextColor: ds.muted
        font.family: ds.ui
        font.pixelSize: 14
        leftPadding: ds.s12
        rightPadding: ds.s12
        background: Rectangle {
            radius: ds.radius
            color: ds.inset
            border.color: sf.activeFocus ? ds.accent : ds.lineStrong
            border.width: 1
        }
        Accessible.role: Accessible.EditableText
    }

    // web .desktop-subjects button — symbol box + label + count
    component SubjectPill: Rectangle {
        id: pill
        property string symbol: ""
        property string label: ""
        property string count: ""
        property bool active: false
        signal clicked
        implicitWidth: pillRow.implicitWidth + ds.s24
        implicitHeight: 37
        radius: 6
        color: pill.active ? ds.subjectOn : ds.subjectBg
        border.color: pill.active ? ds.accentRing : ds.line
        border.width: 1
        RowLayout {
            id: pillRow
            anchors.centerIn: parent
            spacing: ds.s8
            Rectangle {
                implicitWidth: 21
                implicitHeight: 21
                radius: 4
                color: "#141b23"
                Layout.alignment: Qt.AlignVCenter
                Text {
                    anchors.centerIn: parent
                    text: pill.symbol
                    color: ds.accent
                    font.family: ds.mono
                    font.pixelSize: 11
                }
            }
            Text {
                text: pill.label
                color: pill.active ? ds.accent : ds.muted
                font.family: ds.ui
                font.pixelSize: 12
                Layout.alignment: Qt.AlignVCenter
            }
            Text {
                text: pill.count
                color: ds.faint
                font.family: ds.mono
                font.pixelSize: 10
                Layout.alignment: Qt.AlignVCenter
            }
        }
        HoverHandler { cursorShape: Qt.PointingHandCursor }
        TapHandler { onTapped: pill.clicked() }
        Accessible.role: Accessible.Button
        Accessible.name: pill.label
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
                            Text {
                                id: atLabel
                                anchors.centerIn: parent
                                text: modelData.t
                                color: root.page === modelData.p ? ds.accent : ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                            }
                            HoverHandler { cursorShape: Qt.PointingHandCursor }
                            TapHandler { onTapped: uiShell.selectPage(modelData.p) }
                        }
                    }
                }
            }

            Item { Layout.fillWidth: true }

            // .global-search
            Rectangle {
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
                        Accessible.name: "全局搜索课程、挑战与项目"
                    }
                }
            }

            // .topbar-actions
            RowLayout {
                spacing: ds.s8
                Layout.alignment: Qt.AlignVCenter

                IconButton { glyph: "⚡"; tip: "快捷动作" }
                IconButton { glyph: "🔔"; tip: "通知中心" }

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

                IconButton { glyph: "⚙"; tip: "打开设置" }

                // .topbar-avatar
                Rectangle {
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
                    TapHandler { onTapped: uiShell.selectPage("账户") }
                    Accessible.role: Accessible.Button
                    Accessible.name: "账户菜单"
                }
            }
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
                        text: "全栈冲刺 · " + uiShell.lessonMeta.length + " 阶段"
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
                    Layout.fillWidth: true
                    glyph: "▤"; label: "学习路径"; index: "01"
                    active: root.page === "学习"
                    onActivated: uiShell.selectPage("学习")
                }
                NavItem {
                    Layout.fillWidth: true
                    glyph: "▥"; label: "代码草稿"; index: "02"
                    active: root.page === "编辑器"
                    onActivated: uiShell.selectPage("编辑器")
                }
                NavItem {
                    Layout.fillWidth: true
                    glyph: "▶"; label: "运行记录"; index: "03"
                    active: root.page === "运行记录"
                    onActivated: uiShell.selectPage("运行记录")
                }
                NavItem {
                    Layout.fillWidth: true
                    glyph: "◷"; label: "复习中心"; index: "04"
                    active: root.page === "复习与进度"
                    onActivated: uiShell.selectPage("复习与进度")
                }
                NavItem {
                    Layout.fillWidth: true
                    glyph: "◉"; label: "个人中心"; index: "05"
                    active: root.page === "账户"
                    onActivated: uiShell.selectPage("账户")
                }
            }

            Item { Layout.fillHeight: true }

            // .nav-label #2 — 课程进度
            Text {
                Layout.leftMargin: ds.s12
                Layout.topMargin: ds.s8
                Layout.bottomMargin: ds.s10
                text: "课程进度 · " + uiShell.lessonMeta.length + " 阶段"
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
                    color: ds.panel
                    border.color: ds.line
                    border.width: 1
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
                                text: "连续打卡 0 天"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 13
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "点击卡片完成今日打卡"
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
                case "编辑器": return 1;
                case "运行记录": return 2;
                case "复习与进度": return 3;
                case "账户": return 4;
                default: return 0;
                }
            }

            StudyPage {
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            EditorPage {
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            RunLogPage {
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            ReviewPage {
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            AccountPage {
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PAGES
    // ═════════════════════════════════════════════════════════════════════════

    // ── 01 学习路径 ────────────────────────────────────────────────────────
    component StudyPage: Item {
        id: studyPage
        property int subjectFilter: -1

        ColumnLayout {
            anchors.fill: parent
            spacing: 0

            // .content-source-banner — source-status strip (not dismissible)
            Rectangle {
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s8
                implicitHeight: 32
                radius: ds.radiusSm
                color: ds.bannerBg
                border.color: ds.line
                border.width: 1
                RowLayout {
                    anchors { fill: parent; leftMargin: ds.s12; rightMargin: ds.s12 }
                    spacing: ds.s8
                    Rectangle {   // ::before hollow diamond
                        implicitWidth: 7
                        implicitHeight: 7
                        color: "transparent"
                        border.color: ds.ink
                        border.width: 1
                        rotation: 45
                        Layout.alignment: Qt.AlignVCenter
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "当前显示的是内置课程快照（未迁移到资料库），阶段按旧口径展示。"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 12
                        elide: Text.ElideRight
                        Layout.alignment: Qt.AlignVCenter
                    }
                    QuietButton {
                        implicitHeight: 28
                        label: uiShell.contentBusy ? "同步中…" : "重试同步"
                        enabled: !uiShell.contentBusy
                        onClicked: uiShell.reloadPublishedContent()
                    }
                }
            }

            // .welcome-row
            RowLayout {
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s20
                spacing: ds.s16
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0
                    Text {
                        text: {
                            const h = new Date().getHours();
                            const who = uiShell.hasActiveAccount ? uiShell.accountName : "同学";
                            if (h < 6) return "夜深了，" + who;
                            if (h < 12) return "早上好，" + who;
                            if (h < 14) return "中午好，" + who;
                            if (h < 18) return "下午好，" + who;
                            return "晚上好，" + who;
                        }
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 25
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.6
                    }
                    Text {
                        Layout.fillWidth: true
                        text: Qt.formatDate(new Date(), "M月d日") + " · 学习计划共 "
                              + uiShell.lessonMeta.length + " 个阶段"
                              + (uiShell.hasActiveAccount ? "" : "（访客模式：登录后可保存草稿）")
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 12
                        elide: Text.ElideRight
                    }
                }

                // .weekly-progress
                Rectangle {
                    // Fixed width: binding this to ringCard.implicitWidth is
                    // circular (child centres in the parent it sizes).
                    implicitWidth: 210
                    implicitHeight: 64
                    radius: ds.radius
                    color: ds.panel
                    border.color: ds.line
                    border.width: 1
                    Layout.alignment: Qt.AlignVCenter
                    RowLayout {
                        id: ringCard
                        anchors.centerIn: parent
                        spacing: ds.s12
                        // .progress-ring — 44x44, track 1.5px #ffffff20,
                        // top+right recoloured accent = upper-right 180° arc
                        Item {
                            implicitWidth: 44
                            implicitHeight: 44
                            Layout.alignment: Qt.AlignVCenter
                            Shape {
                                anchors.fill: parent
                                antialiasing: true
                                ShapePath {
                                    fillColor: "transparent"
                                    strokeColor: ds.lineRaised
                                    strokeWidth: 1.5
                                    PathAngleArc {
                                        centerX: 22
                                        centerY: 22
                                        radiusX: 21.25
                                        radiusY: 21.25
                                        startAngle: 0
                                        sweepAngle: 360
                                    }
                                }
                                ShapePath {
                                    fillColor: "transparent"
                                    strokeColor: ds.accent
                                    strokeWidth: 1.5
                                    PathAngleArc {
                                        centerX: 22
                                        centerY: 22
                                        radiusX: 21.25
                                        radiusY: 21.25
                                        startAngle: 135
                                        sweepAngle: -180
                                    }
                                }
                            }
                            Text {
                                anchors.centerIn: parent
                                text: "0%"
                                color: ds.ink
                                font.family: ds.mono
                                font.pixelSize: 11
                                font.weight: Font.Bold
                            }
                        }
                        ColumnLayout {
                            spacing: ds.s4
                            Layout.alignment: Qt.AlignVCenter
                            Text {
                                text: "挑战验收"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 12
                                font.weight: Font.DemiBold
                            }
                            Text {
                                text: "已通过 0 / 13 关"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                            }
                        }
                    }
                }
            }

            // .desktop-subjects — category pills
            ScrollView {
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s24
                implicitHeight: 37
                ScrollBar.vertical.policy: ScrollBar.AlwaysOff
                ScrollBar.horizontal.policy: ScrollBar.AsNeeded
                RowLayout {
                    spacing: ds.s8
                    Repeater {
                        model: {
                            const seen = [];
                            const list = uiShell.lessonMeta;
                            for (let i = 0; i < list.length; ++i) {
                                const lbl = list[i].languageLabel || list[i].language || "";
                                if (lbl !== "" && seen.indexOf(lbl) < 0) seen.push(lbl);
                            }
                            return seen;
                        }
                        delegate: SubjectPill {
                            required property var modelData
                            required property int index
                            symbol: modelData.slice(0, 2).toUpperCase()
                            label: modelData
                            count: {
                                let n = 0;
                                const list = uiShell.lessonMeta;
                                for (let i = 0; i < list.length; ++i) {
                                    if ((list[i].languageLabel || list[i].language) === modelData) ++n;
                                }
                                return "" + n;
                            }
                            active: studyPage.subjectFilter === index
                            onClicked: studyPage.subjectFilter =
                                       (studyPage.subjectFilter === index ? -1 : index)
                        }
                    }
                }
            }

            // .desktop-learning-columns
            RowLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: ds.s24

                // .desktop-learning-primary
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.horizontalStretchFactor: 6
                    spacing: 0

                    // .desktop-section-heading
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.bottomMargin: ds.s16
                        spacing: ds.s12
                        ColumnLayout {
                            spacing: 0
                            RowLayout {
                                spacing: ds.s8
                                Rectangle {   // .desktop-eyebrow dot
                                    implicitWidth: 6
                                    implicitHeight: 6
                                    radius: 3
                                    color: ds.cyan
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Text {
                                    text: "LEARNING PATH"
                                    color: ds.faint
                                    font.family: ds.mono
                                    font.pixelSize: 10
                                    font.letterSpacing: 1
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                            Text {
                                Layout.topMargin: ds.s4
                                text: "你的学习路径"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 20
                                font.weight: Font.Bold
                                font.letterSpacing: -0.5
                            }
                        }
                        Item { Layout.fillWidth: true }
                        Text {
                            text: "阶段与来源明细  ›"
                            color: ds.accent
                            font.family: ds.ui
                            font.pixelSize: 12
                            Layout.alignment: Qt.AlignBottom
                        }
                    }

                    // .desktop-course-hero
                    Rectangle {
                        id: hero
                        Layout.fillWidth: true
                        Layout.preferredHeight: 226
                        radius: 9
                        color: "transparent"
                        border.color: ds.heroEdge
                        border.width: 1
                        clip: true

                        // linear-gradient(115deg, #17232f, #102331)
                        Shape {
                            anchors.fill: parent
                            preferredRendererType: Shape.CurveRenderer
                            ShapePath {
                                strokeColor: "transparent"
                                fillGradient: LinearGradient {
                                    x1: hero.width * 0.5 - hero.width * 0.453
                                    y1: hero.height * 0.5 - hero.height * 0.2115
                                    x2: hero.width * 0.5 + hero.width * 0.453
                                    y2: hero.height * 0.5 + hero.height * 0.2115
                                    GradientStop { position: 0.0; color: "#17232f" }
                                    GradientStop { position: 1.0; color: "#102331" }
                                }
                                startX: 0
                                startY: 0
                                PathLine { x: hero.width; y: 0 }
                                PathLine { x: hero.width; y: hero.height }
                                PathLine { x: 0; y: hero.height }
                                PathLine { x: 0; y: 0 }
                            }
                        }

                        // .desktop-course-art — fixed 190px, orbits + core + tags
                        Item {
                            id: heroArt
                            width: 190
                            height: parent.height
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            clip: true

                            Rectangle {
                                anchors.centerIn: parent
                                width: 180
                                height: 180
                                radius: 90
                                color: "transparent"
                                border.color: ds.heroBadgeEd
                                border.width: 1
                                transform: [
                                    Rotation { origin.x: 90; origin.y: 90; angle: -35 },
                                    Scale { origin.x: 90; origin.y: 90; yScale: 0.6 }
                                ]
                            }
                            Rectangle {
                                anchors.centerIn: parent
                                width: 212
                                height: 212
                                radius: 106
                                color: "transparent"
                                border.color: ds.heroBadgeEd
                                border.width: 1
                                transform: [
                                    Rotation { origin.x: 106; origin.y: 106; angle: 38 },
                                    Scale { origin.x: 106; origin.y: 106; yScale: 0.6 }
                                ]
                            }
                            Rectangle {   // .course-art-core
                                anchors.centerIn: parent
                                width: 87
                                height: 92
                                radius: 16
                                color: "#16283a"
                                border.color: ds.accentRing
                                border.width: 1
                                rotation: -8
                                Text {
                                    anchors.centerIn: parent
                                    text: "{ }"
                                    color: ds.accent
                                    font.family: ds.mono
                                    font.pixelSize: 34
                                }
                            }
                            Rectangle {   // .art-tag.tag-top
                                x: 116
                                y: 43
                                implicitWidth: tagTop.implicitWidth + ds.s16
                                implicitHeight: 22
                                radius: 4
                                color: "#0b1b27"
                                border.color: ds.heroBadgeEd
                                border.width: 1
                                Text {
                                    id: tagTop
                                    anchors.centerIn: parent
                                    text: "<learn />"
                                    color: ds.ink
                                    font.family: ds.mono
                                    font.pixelSize: 10
                                }
                            }
                            Rectangle {   // .art-tag.tag-bottom
                                x: 0
                                y: parent.height - 54
                                implicitWidth: tagBottom.implicitWidth + ds.s16
                                implicitHeight: 22
                                radius: 4
                                color: "#0b1b27"
                                border.color: ds.heroBadgeEd
                                border.width: 1
                                Text {
                                    id: tagBottom
                                    anchors.centerIn: parent
                                    text: "build. understand."
                                    color: "#8aa6ba"
                                    font.family: ds.mono
                                    font.pixelSize: 10
                                }
                            }
                        }

                        // .desktop-course-copy
                        ColumnLayout {
                            anchors {
                                left: parent.left
                                top: parent.top
                                bottom: parent.bottom
                                right: heroArt.left
                            }
                            anchors.margins: ds.s24
                            spacing: 0

                            RowLayout {
                                spacing: ds.s8
                                Rectangle {
                                    implicitWidth: heroTag1.implicitWidth + ds.s16
                                    implicitHeight: 22
                                    radius: 4
                                    color: ds.heroBadge
                                    border.color: ds.heroBadgeEd
                                    border.width: 1
                                    Text {
                                        id: heroTag1
                                        anchors.centerIn: parent
                                        text: uiShell.lessonMeta.length > 0
                                              ? (uiShell.lessonMeta[0].languageLabel || "Java") : "Java"
                                        color: ds.accent
                                        font.family: ds.ui
                                        font.pixelSize: 11
                                    }
                                }
                                Rectangle {
                                    implicitWidth: heroTag2.implicitWidth + ds.s16
                                    implicitHeight: 22
                                    radius: 4
                                    color: ds.heroBadge
                                    border.color: ds.heroBadgeEd
                                    border.width: 1
                                    Text {
                                        id: heroTag2
                                        anchors.centerIn: parent
                                        text: "交互式课程"
                                        color: ds.accent
                                        font.family: ds.ui
                                        font.pixelSize: 11
                                    }
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s14
                                text: uiShell.lessonMeta.length > 0
                                      ? (uiShell.lessonMeta[0].title || "") : "当前科目暂无课程"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 24
                                font.weight: Font.DemiBold
                                font.letterSpacing: -0.5
                                elide: Text.ElideRight
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s8
                                text: uiShell.lessonMeta.length > 0
                                      ? (uiShell.lessonMeta[0].description || "从理解概念开始。")
                                      : "切换科目，或从顶部资料库状态条同步内容。"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                                wrapMode: Text.WordWrap
                                maximumLineCount: 2
                                elide: Text.ElideRight
                            }

                            Item { Layout.fillHeight: true }

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: ds.s16
                                PrimaryButton {
                                    label: "进入学习  →"
                                    enabled: uiShell.lessonMeta.length > 0
                                    onClicked: {
                                        if (uiShell.publishedIds.length > 0)
                                            uiShell.openPublishedContent(0);
                                        uiShell.selectPage("编辑器");
                                    }
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: "0 / " + (uiShell.lessonMeta.length > 0
                                           ? (uiShell.lessonMeta[0].flow
                                              ? uiShell.lessonMeta[0].flow.length : 0) : 0)
                                          + " 个单元已有完成证据"
                                    color: ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 11
                                    elide: Text.ElideRight
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                        }
                    }

                    // .desktop-course-toolbar
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        Layout.bottomMargin: ds.s12
                        spacing: ds.s12
                        RowLayout {
                            spacing: ds.s8
                            Text {
                                text: "课程单元"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 14
                                font.weight: Font.DemiBold
                                Layout.alignment: Qt.AlignVCenter
                            }
                            Text {
                                text: "" + uiShell.lessonMeta.length
                                color: ds.faint
                                font.family: ds.mono
                                font.pixelSize: 11
                                Layout.alignment: Qt.AlignVCenter
                            }
                        }
                        Item { Layout.fillWidth: true }
                        RowLayout {
                            spacing: ds.s4
                            Repeater {
                                model: ["全部", "待学习", "已完成"]
                                delegate: Rectangle {
                                    required property var modelData
                                    required property int index
                                    implicitWidth: fLabel.implicitWidth + ds.s20
                                    implicitHeight: 21
                                    radius: 4
                                    color: index === 0 ? ds.tabActive : "transparent"
                                    border.color: index === 0 ? ds.line : "transparent"
                                    border.width: 1
                                    Text {
                                        id: fLabel
                                        anchors.centerIn: parent
                                        text: modelData
                                        color: index === 0 ? ds.ink : ds.muted
                                        font.family: ds.ui
                                        font.pixelSize: 11
                                    }
                                }
                            }
                        }
                    }

                    // .desktop-course-grid — the internal scroll box
                    ScrollView {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                        GridView {
                            id: courseGrid
                            objectName: "courseList"
                            anchors.fill: parent
                            cellWidth: Math.floor(width / 2) - 1
                            cellHeight: 150
                            model: uiShell.lessonMeta
                            clip: true

                            NumberAnimation on contentY {
                                running: root.benchmarkScrolling
                                from: 0
                                to: Math.max(1, courseGrid.contentHeight - courseGrid.height)
                                duration: 3000
                                loops: Animation.Infinite
                            }

                            delegate: Item {
                                required property var modelData
                                required property int index
                                width: courseGrid.cellWidth
                                height: courseGrid.cellHeight

                                // .desktop-unit-card
                                Rectangle {
                                    anchors {
                                        left: parent.left
                                        right: parent.right
                                        top: parent.top
                                        bottom: parent.bottom
                                        rightMargin: ds.s12
                                        bottomMargin: ds.s12
                                    }
                                    radius: 7
                                    color: unitHover.hovered ? ds.cardHover : ds.panel
                                    border.color: unitHover.hovered ? ds.accentRing : ds.line
                                    border.width: 1

                                    ColumnLayout {
                                        anchors.fill: parent
                                        anchors.margins: ds.s16
                                        spacing: 0

                                        RowLayout {
                                            Layout.fillWidth: true
                                            Layout.bottomMargin: ds.s12
                                            spacing: ds.s8
                                            Rectangle {   // .desktop-unit-number
                                                implicitWidth: 28
                                                implicitHeight: 27
                                                radius: 4
                                                color: ds.unitBadge
                                                border.color: ds.unitBadgeEd
                                                border.width: 1
                                                Text {
                                                    anchors.centerIn: parent
                                                    text: (index + 1) < 10
                                                          ? "0" + (index + 1) : "" + (index + 1)
                                                    color: ds.accent
                                                    font.family: ds.mono
                                                    font.pixelSize: 12
                                                }
                                            }
                                            Item { Layout.fillWidth: true }
                                            RowLayout {   // .unit-state
                                                spacing: ds.s4
                                                Rectangle {   // .unit-dot
                                                    implicitWidth: 6
                                                    implicitHeight: 6
                                                    radius: 3
                                                    color: "transparent"
                                                    border.color: ds.faint
                                                    border.width: 1
                                                    Layout.alignment: Qt.AlignVCenter
                                                }
                                                Text {
                                                    text: "待学习"
                                                    color: ds.faint
                                                    font.family: ds.ui
                                                    font.pixelSize: 13
                                                    Layout.alignment: Qt.AlignVCenter
                                                }
                                            }
                                        }

                                        Text {
                                            Layout.fillWidth: true
                                            text: modelData.title || ""
                                            color: ds.ink
                                            font.family: ds.ui
                                            font.pixelSize: 14
                                            font.weight: Font.DemiBold
                                            elide: Text.ElideRight
                                        }

                                        Text {
                                            Layout.fillWidth: true
                                            Layout.topMargin: ds.s8
                                            Layout.preferredHeight: 40
                                            text: modelData.description || "打开课程查看内容、练习与来源。"
                                            color: ds.muted
                                            font.family: ds.ui
                                            font.pixelSize: 12
                                            wrapMode: Text.WordWrap
                                            maximumLineCount: 2
                                            elide: Text.ElideRight
                                            verticalAlignment: Text.AlignTop
                                        }

                                        Item { Layout.fillHeight: true }

                                        Rectangle {
                                            Layout.fillWidth: true
                                            Layout.topMargin: ds.s14
                                            height: 1
                                            color: ds.line
                                        }
                                        RowLayout {
                                            Layout.fillWidth: true
                                            Layout.topMargin: ds.s12
                                            spacing: ds.s8
                                            Text {
                                                Layout.fillWidth: true
                                                text: (modelData.level || "") + " · "
                                                      + (modelData.languageLabel || "")
                                                color: ds.faint
                                                font.family: ds.ui
                                                font.pixelSize: 11
                                                elide: Text.ElideRight
                                                Layout.alignment: Qt.AlignVCenter
                                            }
                                            Text {
                                                text: "→"
                                                color: ds.accent
                                                font.family: ds.ui
                                                font.pixelSize: 15
                                                Layout.alignment: Qt.AlignVCenter
                                            }
                                        }
                                    }

                                    HoverHandler { id: unitHover; cursorShape: Qt.PointingHandCursor }
                                    TapHandler {
                                        onTapped: {
                                            const idx = uiShell.publishedIds.indexOf(modelData.id);
                                            if (idx >= 0) {
                                                uiShell.openPublishedContent(idx);
                                                uiShell.selectPage("编辑器");
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // aside.desktop-learning-rail
                ColumnLayout {
                    // Pin the rail: children's implicit width (the 0/61 evidence
                    // row) otherwise overrode the preferred 286 and squeezed the
                    // primary column, eliding the hero title.
                    Layout.fillWidth: false
                    Layout.minimumWidth: ds.railW
                    Layout.maximumWidth: ds.railW
                    Layout.preferredWidth: ds.railW
                    Layout.fillHeight: true
                    spacing: ds.s16

                    // 代码速览
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        radius: ds.radius
                        color: ds.railPanel
                        border.color: ds.line
                        border.width: 1
                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: ds.s16
                            spacing: 0

                            RowLayout {
                                Layout.fillWidth: true
                                Layout.bottomMargin: ds.s16
                                spacing: ds.s8
                                Text {
                                    text: "代码速览"
                                    color: ds.ink
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                    font.weight: Font.DemiBold
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Item { Layout.fillWidth: true }
                                Text {
                                    text: uiShell.starterLanguage !== ""
                                          ? uiShell.starterLanguage.toUpperCase() : "CODE"
                                    color: ds.faint
                                    font.family: ds.mono
                                    font.pixelSize: 9
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }

                            // .desktop-snippet
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                radius: 6
                                color: ds.snippetBg
                                border.color: ds.line
                                border.width: 1
                                clip: true

                                ColumnLayout {
                                    anchors.fill: parent
                                    spacing: 0
                                    Rectangle {
                                        Layout.fillWidth: true
                                        implicitHeight: 28
                                        color: "transparent"
                                        RowLayout {
                                            anchors {
                                                fill: parent
                                                leftMargin: ds.s10
                                                rightMargin: ds.s10
                                            }
                                            spacing: ds.s4
                                            Repeater {
                                                model: 3
                                                delegate: Rectangle {
                                                    implicitWidth: 5
                                                    implicitHeight: 5
                                                    radius: 3
                                                    color: "#4c5b70"
                                                    Layout.alignment: Qt.AlignVCenter
                                                }
                                            }
                                            Text {
                                                Layout.leftMargin: ds.s6
                                                Layout.fillWidth: true
                                                text: uiShell.hasSelectedContent
                                                      ? (uiShell.documentId || "选择课程")
                                                      : "选择课程"
                                                color: ds.faint
                                                font.family: ds.ui
                                                font.pixelSize: 9
                                                elide: Text.ElideRight
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
                                    ScrollView {
                                        id: snippetScroll
                                        Layout.fillWidth: true
                                        Layout.fillHeight: true
                                        Layout.minimumHeight: 120
                                        ScrollBar.horizontal.policy: ScrollBar.AsNeeded
                                        Text {
                                            // Needs an explicit width: inside a
                                            // ScrollView a NoWrap Text otherwise
                                            // collapses and the panel renders empty.
                                            width: snippetScroll.availableWidth
                                            text: uiShell.selectedContentBody !== ""
                                                  ? uiShell.selectedContentBody
                                                  : "public class Main {\n    public static void main(String[] args) {\n        int total = 0;\n        for (int i = 1; i <= 5; i++) {\n            total += i;\n        }\n        System.out.println(total);\n    }\n}"
                                            color: ds.codeInk
                                            font.family: ds.mono
                                            font.pixelSize: 11
                                            lineHeight: 1.9
                                            wrapMode: Text.NoWrap
                                            padding: ds.s14
                                        }
                                    }
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s12
                                text: "代码执行、单步追踪与变量观察在课程工作台中进行。"
                                color: ds.faint
                                font.family: ds.ui
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                            }
                        }
                    }

                    // 今日计划
                    Rectangle {
                        Layout.fillWidth: true
                        implicitHeight: planCol.implicitHeight + ds.s32
                        radius: ds.radius
                        color: ds.railPanel
                        border.color: ds.line
                        border.width: 1
                        ColumnLayout {
                            id: planCol
                            anchors.fill: parent
                            anchors.margins: ds.s16
                            spacing: 0

                            Text {
                                Layout.bottomMargin: ds.s16
                                text: "今日计划"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                            }

                            // informational row
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: ds.s10
                                Rectangle {
                                    implicitWidth: 30
                                    implicitHeight: 30
                                    radius: ds.radiusSm
                                    color: ds.accentSoft
                                    border.color: ds.line
                                    border.width: 1
                                    Text {
                                        anchors.centerIn: parent
                                        text: "▤"
                                        color: ds.accent
                                        font.family: ds.ui
                                        font.pixelSize: 13
                                    }
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: ds.s4
                                    Text {
                                        text: "继续一个学习单元"
                                        color: ds.ink
                                        font.family: ds.ui
                                        font.pixelSize: 12
                                        font.weight: Font.Medium
                                    }
                                    Text {
                                        Layout.fillWidth: true
                                        text: uiShell.lessonMeta.length > 0
                                              ? (uiShell.lessonMeta[0].title || "从科目列表开始")
                                              : "从科目列表开始"
                                        color: ds.faint
                                        font.family: ds.ui
                                        font.pixelSize: 13
                                        elide: Text.ElideRight
                                    }
                                }
                            }

                            Rectangle {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s12
                                height: 1
                                color: ds.line
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s12
                                spacing: ds.s10
                                Rectangle {
                                    implicitWidth: 30
                                    implicitHeight: 30
                                    radius: ds.radiusSm
                                    color: ds.accentSoft
                                    border.color: ds.line
                                    border.width: 1
                                    Text {
                                        anchors.centerIn: parent
                                        text: "⟲"
                                        color: ds.accent
                                        font.family: ds.ui
                                        font.pixelSize: 13
                                    }
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: ds.s4
                                    Text {
                                        text: "复习已学知识"
                                        color: ds.ink
                                        font.family: ds.ui
                                        font.pixelSize: 12
                                        font.weight: Font.Medium
                                    }
                                    Text {
                                        Layout.fillWidth: true
                                        text: "暂无到期复习，保持学习节奏"
                                        color: ds.faint
                                        font.family: ds.ui
                                        font.pixelSize: 13
                                        elide: Text.ElideRight
                                    }
                                }
                                Text {
                                    text: "›"
                                    color: ds.faint
                                    font.family: ds.ui
                                    font.pixelSize: 14
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }

                            // .desktop-plan-progress
                            RowLayout {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s16
                                spacing: ds.s10
                                Text {
                                    Layout.fillWidth: true
                                    text: "当前科目完成证据"
                                    color: ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                }
                                Text {
                                    text: "0/" + uiShell.lessonMeta.length
                                    color: ds.ink
                                    font.family: ds.mono
                                    font.pixelSize: 13
                                }
                            }
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s6
                                Layout.preferredHeight: 4
                                radius: 4
                                color: ds.trackBg
                                Rectangle {
                                    width: 0
                                    height: parent.height
                                    radius: 4
                                    color: ds.accent
                                }
                            }
                        }
                    }

                    // .desktop-note
                    Rectangle {
                        Layout.fillWidth: true
                        implicitHeight: noteCol.implicitHeight + ds.s32
                        color: "transparent"
                        Rectangle {
                            anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
                            width: 2
                            color: ds.accentRing
                        }
                        ColumnLayout {
                            id: noteCol
                            anchors.fill: parent
                            anchors.leftMargin: ds.s16 + ds.s2
                            anchors.rightMargin: ds.s16
                            anchors.topMargin: ds.s16
                            anchors.bottomMargin: ds.s16
                            spacing: 0
                            Text {
                                text: "LEARN BY DOING"
                                color: ds.accent
                                font.family: ds.mono
                                font.pixelSize: 9
                                font.letterSpacing: 1.5
                            }
                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s10
                                Layout.bottomMargin: ds.s10
                                text: "让抽象的代码，\n变成看得见的思考。"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 18
                                font.weight: Font.Medium
                                wrapMode: Text.WordWrap
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "阅读、练习和掌握分别记录。"
                                color: ds.faint
                                font.family: ds.ui
                                font.pixelSize: 11
                            }
                        }
                    }
                }
            }
        }
    }

    // ── 02 代码草稿 ────────────────────────────────────────────────────────
    component EditorPage: Item {
        ColumnLayout {
            anchors.fill: parent
            spacing: ds.s12

            // Workspace header
            RowLayout {
                Layout.fillWidth: true
                spacing: ds.s12
                QuietButton { label: "←"; onClicked: uiShell.selectPage("学习") }
                ColumnLayout {
                    spacing: 2
                    Text {
                        text: uiShell.hasSelectedContent
                              ? (uiShell.documentId || "未选择课程") : "未选择课程"
                        color: ds.ink
                        font.family: ds.mono
                        font.pixelSize: 22
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.4
                    }
                    Text {
                        text: (uiShell.starterLanguage !== "" ? uiShell.starterLanguage : "—")
                              + " · 教学运行器 · Ctrl + S 保存草稿"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 12
                    }
                }
                Item { Layout.fillWidth: true }
                QuietButton {
                    label: uiShell.draftDirty ? "保存草稿 *" : "保存草稿"
                    enabled: uiShell.hasSelectedContent && !uiShell.draftPersistenceBlocked
                    onClicked: uiShell.saveDraft()
                }
                QuietButton {
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
                    model: ["01 代码", "02 变量", "03 控制台"]
                    delegate: Text {
                        required property var modelData
                        required property int index
                        text: modelData
                        color: index === 0 ? ds.accent : ds.muted
                        font.family: ds.mono
                        font.pixelSize: 12
                        Layout.alignment: Qt.AlignVCenter
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
                                    text: "行 1，列 1"
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
                                        text: uiShell.executionBusy ? "01 / 07" : "00 / 00"
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
                                    model: uiShell.lessonMeta.length > 0
                                           ? (uiShell.lessonMeta[0].flow || []) : []
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
                                    visible: uiShell.lessonMeta.length === 0
                                             || (uiShell.lessonMeta[0].flow || []).length === 0
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
                                PrimaryButton {
                                    label: uiShell.executionBusy ? "取消" : "运行"
                                    enabled: uiShell.hasActiveAccount
                                             && uiShell.starterLanguage.length > 0
                                             && !uiShell.contentBusy
                                    onClicked: uiShell.executionBusy
                                               ? uiShell.cancelExecution()
                                               : uiShell.runCode()
                                }
                                QuietButton {
                                    label: "暂停"
                                    enabled: uiShell.executionBusy && !uiShell.executionPaused
                                    onClicked: uiShell.pauseExecution()
                                }
                                QuietButton {
                                    label: "继续"
                                    enabled: uiShell.executionBusy && uiShell.executionPaused
                                    onClicked: uiShell.resumeExecution()
                                }
                                QuietButton {
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

    // ── 03 运行记录 ────────────────────────────────────────────────────────
    component RunLogPage: Item {
        ColumnLayout {
            anchors.fill: parent
            spacing: ds.s12

            RowLayout {
                Layout.fillWidth: true
                spacing: ds.s8
                Text {
                    text: "运行记录"
                    color: ds.ink
                    font.family: ds.ui
                    font.pixelSize: 22
                    font.weight: Font.DemiBold
                }
                Item { Layout.fillWidth: true }
                Rectangle {
                    implicitWidth: runPill.implicitWidth + ds.s16
                    implicitHeight: 24
                    radius: 12
                    color: uiShell.executionBusy ? "#12251c"
                           : (uiShell.executionPaused ? "#241f0d" : ds.panel)
                    border.color: uiShell.executionBusy ? ds.success
                                  : (uiShell.executionPaused ? ds.warning : ds.line)
                    border.width: 1
                    Text {
                        id: runPill
                        anchors.centerIn: parent
                        text: uiShell.executionBusy ? "运行中"
                              : (uiShell.executionPaused ? "已暂停" : "空闲")
                        color: uiShell.executionBusy ? ds.success
                               : (uiShell.executionPaused ? ds.warning : ds.muted)
                        font.family: ds.ui
                        font.pixelSize: 11
                    }
                }
            }

            Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }

            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                radius: ds.radius
                color: ds.editorBg
                border.color: ds.line
                border.width: 1
                ScrollView {
                    anchors.fill: parent
                    anchors.margins: ds.s14
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                    TextArea {
                        text: uiShell.executionOutput
                        readOnly: true
                        wrapMode: TextArea.Wrap
                        color: ds.ink
                        font.family: ds.mono
                        font.pixelSize: 13
                        background: null
                        placeholderText: "运行输出将显示在这里"
                        placeholderTextColor: ds.faint
                        Accessible.name: "运行输出"
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: ds.s8
                QuietButton {
                    label: "取消"
                    enabled: uiShell.executionBusy
                    onClicked: uiShell.cancelExecution()
                }
                QuietButton {
                    label: "暂停"
                    enabled: uiShell.executionBusy && !uiShell.executionPaused
                    onClicked: uiShell.pauseExecution()
                }
                QuietButton {
                    label: "继续"
                    enabled: uiShell.executionBusy && uiShell.executionPaused
                    onClicked: uiShell.resumeExecution()
                }
                QuietButton {
                    label: "单步"
                    enabled: uiShell.executionPaused
                    onClicked: uiShell.stepExecution()
                }
                Item { Layout.fillWidth: true }
            }
        }
    }

    // ── 04 复习中心 ────────────────────────────────────────────────────────
    component ReviewPage: Item {
        ColumnLayout {
            anchors.fill: parent
            spacing: ds.s16

            RowLayout {
                Layout.fillWidth: true
                spacing: ds.s12
                ColumnLayout {
                    spacing: 2
                    RowLayout {
                        spacing: ds.s8
                        Rectangle {
                            implicitWidth: 6
                            implicitHeight: 6
                            radius: 3
                            color: ds.cyan
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Text {
                            text: "REVIEW CENTER"
                            color: ds.faint
                            font.family: ds.mono
                            font.pixelSize: 10
                            font.letterSpacing: 1
                            Layout.alignment: Qt.AlignVCenter
                        }
                    }
                    Text {
                        Layout.topMargin: ds.s4
                        text: "复习中心"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 20
                        font.weight: Font.Bold
                        font.letterSpacing: -0.5
                    }
                }
                Item { Layout.fillWidth: true }
                QuietButton {
                    label: "重试读取发布规则"
                    enabled: !uiShell.operationBusy
                    onClicked: uiShell.refreshReviewSummary()
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: ds.s12
                Repeater {
                    model: [
                        { k: "到期复习", v: "0" },
                        { k: "已完成单元", v: "0" },
                        { k: "连续打卡", v: "0 天" }
                    ]
                    delegate: Rectangle {
                        required property var modelData
                        Layout.fillWidth: true
                        implicitHeight: 78
                        radius: ds.radius
                        color: ds.panel
                        border.color: ds.line
                        border.width: 1
                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: ds.s14
                            spacing: ds.s4
                            Text {
                                text: modelData.k
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 12
                            }
                            Text {
                                text: modelData.v
                                color: ds.ink
                                font.family: ds.mono
                                font.pixelSize: 24
                                font.weight: Font.Bold
                            }
                        }
                    }
                }
            }

            Rectangle {
                Layout.fillWidth: true
                implicitHeight: progressText.implicitHeight + ds.s28
                radius: ds.radius
                color: ds.panel
                border.color: ds.line
                border.width: 1
                Text {
                    id: progressText
                    anchors.fill: parent
                    anchors.margins: ds.s14
                    text: uiShell.progressSummary !== ""
                          ? uiShell.progressSummary : "暂无进度数据"
                    color: uiShell.progressSummary !== "" ? ds.ink : ds.faint
                    font.family: ds.ui
                    font.pixelSize: 13
                    wrapMode: Text.WordWrap
                }
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                radius: ds.radius
                color: ds.page
                border.color: ds.line
                border.width: 1
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: ds.s14
                    spacing: ds.s8
                    Text {
                        text: "复习记录"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 13
                        font.weight: Font.DemiBold
                    }
                    Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }
                    ScrollView {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                        TextArea {
                            text: uiShell.reviewSummary
                            readOnly: true
                            wrapMode: TextArea.Wrap
                            color: uiShell.reviewSummary !== "" ? ds.ink : ds.faint
                            font.family: ds.ui
                            font.pixelSize: 12
                            background: null
                            placeholderText: "暂无复习记录"
                            placeholderTextColor: ds.faint
                            Accessible.name: "复习记录"
                        }
                    }
                }
            }
        }
    }

    // ── 05 个人中心 ────────────────────────────────────────────────────────
    component AccountPage: Item {
        ScrollView {
            anchors.fill: parent
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            ColumnLayout {
                width: parent.width - ds.s16
                spacing: ds.s16

                RowLayout {
                    Layout.fillWidth: true
                    spacing: ds.s12
                    ColumnLayout {
                        spacing: 2
                        RowLayout {
                            spacing: ds.s8
                            Rectangle {
                                implicitWidth: 6
                                implicitHeight: 6
                                radius: 3
                                color: ds.cyan
                                Layout.alignment: Qt.AlignVCenter
                            }
                            Text {
                                text: "ACCOUNT"
                                color: ds.faint
                                font.family: ds.mono
                                font.pixelSize: 10
                                font.letterSpacing: 1
                                Layout.alignment: Qt.AlignVCenter
                            }
                        }
                        Text {
                            Layout.topMargin: ds.s4
                            text: "个人中心"
                            color: ds.ink
                            font.family: ds.ui
                            font.pixelSize: 20
                            font.weight: Font.Bold
                            font.letterSpacing: -0.5
                        }
                    }
                    Item { Layout.fillWidth: true }
                }

                // Identity card
                Rectangle {
                    Layout.fillWidth: true
                    implicitHeight: 104
                    radius: ds.radius
                    color: ds.panel
                    border.color: ds.line
                    border.width: 1
                    RowLayout {
                        anchors.fill: parent
                        anchors.margins: ds.s16
                        spacing: ds.s16
                        Rectangle {
                            implicitWidth: 56
                            implicitHeight: 56
                            radius: 28
                            color: ds.accent
                            Layout.alignment: Qt.AlignVCenter
                            Text {
                                anchors.centerIn: parent
                                text: uiShell.hasActiveAccount
                                      && uiShell.accountName.length > 0
                                      ? uiShell.accountName.charAt(0) : "访"
                                color: ds.inkOnAccent
                                font.family: ds.ui
                                font.pixelSize: 22
                                font.weight: Font.Bold
                            }
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: ds.s4
                            Text {
                                text: uiShell.hasActiveAccount ? uiShell.accountName : "访客模式"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 16
                                font.weight: Font.DemiBold
                            }
                            Text {
                                Layout.fillWidth: true
                                text: uiShell.hasActiveAccount
                                      ? (uiShell.activeAccountId || "—")
                                      : "登录后可保存草稿与进度"
                                color: ds.muted
                                font.family: ds.mono
                                font.pixelSize: 12
                                elide: Text.ElideRight
                            }
                            Text {
                                Layout.fillWidth: true
                                visible: uiShell.accountStatus !== ""
                                text: uiShell.accountStatus
                                color: ds.faint
                                font.family: ds.ui
                                font.pixelSize: 12
                                wrapMode: Text.WordWrap
                            }
                        }
                    }
                }

                // Auth form
                Rectangle {
                    Layout.fillWidth: true
                    implicitHeight: authCol.implicitHeight + ds.s32
                    radius: ds.radius
                    color: ds.page
                    border.color: ds.line
                    border.width: 1
                    ColumnLayout {
                        id: authCol
                        anchors.fill: parent
                        anchors.margins: ds.s16
                        spacing: ds.s10
                        Text {
                            text: uiShell.hasActiveAccount ? "修改密码" : "登录你的工作区"
                            color: ds.ink
                            font.family: ds.ui
                            font.pixelSize: 15
                            font.weight: Font.DemiBold
                        }
                        ShellField {
                            id: identField
                            Layout.fillWidth: true
                            visible: !uiShell.hasActiveAccount
                            placeholderText: "邮箱或手机号"
                        }
                        ShellField {
                            id: nameField
                            Layout.fillWidth: true
                            visible: !uiShell.hasActiveAccount
                            placeholderText: "你的昵称（注册时填写）"
                        }
                        ShellField {
                            id: pwField
                            Layout.fillWidth: true
                            placeholderText: uiShell.hasActiveAccount
                                             ? "当前密码" : "至少 8 个字符"
                            echoMode: TextInput.Password
                        }
                        ShellField {
                            id: newPwField
                            Layout.fillWidth: true
                            visible: uiShell.hasActiveAccount
                            placeholderText: "新密码"
                            echoMode: TextInput.Password
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s8
                            PrimaryButton {
                                label: "登录"
                                visible: !uiShell.hasActiveAccount
                                enabled: !uiShell.accountBusy
                                onClicked: uiShell.login(identField.text, pwField.text)
                            }
                            QuietButton {
                                label: "注册新账户"
                                visible: !uiShell.hasActiveAccount
                                enabled: !uiShell.accountBusy
                                onClicked: uiShell.registerAccount(nameField.text,
                                                                   identField.text,
                                                                   pwField.text)
                            }
                            PrimaryButton {
                                label: "修改密码"
                                visible: uiShell.hasActiveAccount
                                enabled: !uiShell.accountBusy
                                onClicked: uiShell.changePassword(pwField.text, newPwField.text)
                            }
                            QuietButton {
                                label: "退出登录"
                                visible: uiShell.hasActiveAccount
                                enabled: !uiShell.accountBusy
                                onClicked: uiShell.logout()
                            }
                        }
                    }
                }

                // Data actions
                Rectangle {
                    Layout.fillWidth: true
                    implicitHeight: dataCol.implicitHeight + ds.s32
                    radius: ds.radius
                    color: ds.page
                    border.color: ds.line
                    border.width: 1
                    ColumnLayout {
                        id: dataCol
                        anchors.fill: parent
                        anchors.margins: ds.s16
                        spacing: ds.s10
                        Text {
                            text: "数据与隐私"
                            color: ds.ink
                            font.family: ds.ui
                            font.pixelSize: 15
                            font.weight: Font.DemiBold
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s8
                            QuietButton {
                                label: "导出学习数据"
                                enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                                onClicked: uiShell.requestDataAction("backup")
                            }
                            QuietButton {
                                label: "导入备份"
                                enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                                onClicked: uiShell.requestDataAction("restore")
                            }
                            QuietButton {
                                label: "账户安全"
                                enabled: !uiShell.operationBusy
                                onClicked: passwordDialog.open()
                            }
                        }
                        Text {
                            Layout.fillWidth: true
                            visible: uiShell.operationStatus !== ""
                            text: uiShell.operationStatus
                            color: ds.faint
                            font.family: ds.ui
                            font.pixelSize: 12
                            wrapMode: Text.WordWrap
                        }
                    }
                }
            }
        }
    }

    // ── Dialogs ─────────────────────────────────────────────────────────────
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
                id: dlgCurrent
                Layout.fillWidth: true
                placeholderText: "当前密码"
                echoMode: TextInput.Password
            }
            ShellField {
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
            ShellField { id: evEnv; Layout.fillWidth: true; placeholderText: "环境" }
            ShellField { id: evCmd; Layout.fillWidth: true; placeholderText: "命令" }
            ShellField { id: evSum; Layout.fillWidth: true; placeholderText: "结论摘要" }
        }
        onAccepted: uiShell.saveExternalEvidence(evEnv.text, evCmd.text, evSum.text, "", "")
    }
}
