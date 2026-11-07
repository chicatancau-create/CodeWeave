import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Shapes
import QtQuick.Effects

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
    readonly property int safeSelectedLessonIndex: uiShell.lessonMeta.length > 0
        ? Math.max(0, Math.min(selectedLessonIndex, uiShell.lessonMeta.length - 1)) : -1
    readonly property var selectedLesson: safeSelectedLessonIndex >= 0
        ? uiShell.lessonMeta[safeSelectedLessonIndex] : null

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
        readonly property color hoverWash:  "#1b2531"
        readonly property bool useLayerEffects: true

        // Lines — web values are translucent; these are the resolved composites
        readonly property color line:       "#20242b"   // #ffffff12
        readonly property color lineRaised: "#2b313a"   // #ffffff20
        readonly property color lineStrong: "#576578"
        readonly property color accentSoft: "#0f1e29"   // #38bdf814 (web: rgba(34,211,238,0.12))
        readonly property color accentRing: "#19455c"   // #38bdf84d
        readonly property color accentFill: "#10212d"   // #38bdf818
        readonly property color heroEdge:   "#1f3d4d"   // #38bdf838
        readonly property color heroBadge:  "#12222c"   // #38bdf810
        readonly property color heroBadgeEd:"#1a3542"   // #38bdf82b
        readonly property color unitBadge:  "#12222c"   // #38bdf810
        readonly property color unitBadgeEd:"#19313e"   // #38bdf822
        readonly property color scrim:      "#161c24"   // rgba(120,165,220,0.045) — web --scrim
        readonly property color scrimRaised:"#1d242f"   // rgba(120,175,235,0.085) — web --scrim-raised
        readonly property color pressWash:  "#1b222c"
        readonly property color bannerBg:   "#111923"
        readonly property color trackBg:    "#263140"
        readonly property color lineAccent: Qt.rgba(34/255, 211/255, 238/255, 0.38)  // web --line-accent

        // Text
        readonly property color ink:        "#e2e7ef"
        readonly property color inkStrong:  "#e2e7ef"   // web --ink-strong (same as ink in this theme)
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
        readonly property color s0:         "#5b86ff"

        // Typography — mono is NOT overridden by the desktop theme
        readonly property string ui:   "Segoe UI, Microsoft YaHei, sans-serif"
        readonly property string mono: "Consolas, Cascadia Mono, Microsoft YaHei, monospace"

        // Spacing
        readonly property int s2: 2;   readonly property int s4: 4
        readonly property int s6: 6;   readonly property int s8: 8
        readonly property int s10: 10; readonly property int s12: 12
        readonly property int s14: 14; readonly property int s16: 16
        readonly property int s20: 20; readonly property int s22: 22
        readonly property int s24: 24; readonly property int s28: 28
        readonly property int s32: 32

        // Shell metrics
        readonly property int topbarH: 68
        readonly property int sidebarW: 240
        readonly property int railW: 286
        readonly property int radius: 8
        readonly property int radiusSm: 5

        // Responsive sizes (from web tokens.css L152-168)
        readonly property int sizeDisplay: Math.max(42, Math.min(root.width * 0.06, 96))  // clamp(2.6rem, 6vw, 6rem)
        readonly property int sizeTitle: Math.max(27, Math.min(root.width * 0.036, 54))   // clamp(1.7rem, 3.6vw, 3.4rem)
        readonly property int sizeBody: 16
        readonly property int sizeControl: 13

        // Animation system (from web tokens.css L238-256)
        readonly property int durQuick: 150
        readonly property int durBase: 220
        readonly property int durSlow: 300
        readonly property int durHover: 400
        readonly property int durState: 500
        // Easing curve: cubic-bezier(0.22, 1, 0.36, 1)
        // Qt equivalent: Easing.OutCubic or custom Easing.Bezier
        readonly property int easingType: Easing.OutCubic

        // Glow effects (from web tokens.css L111-114)
        // Note: Qt doesn't support CSS box-shadow syntax directly
        // These will be implemented using DropShadow or layer effects in components
        readonly property string glowNear: "0 0 0 1px rgba(34,211,238,0.28), 0 0 12px rgba(34,211,238,0.14)"
        readonly property string glowPanel: "0 0 0 1px rgba(120,175,235,0.14), 0 8px 32px rgba(0,0,0,0.55)"
        readonly property color glowNearColor: Qt.rgba(34/255, 211/255, 238/255, 0.14)
        readonly property color glowPanelColor: Qt.rgba(0, 0, 0, 0.55)
    }

    // ── Shared components ───────────────────────────────────────────────────

    // web .nav-item (styles.css:457-504) — min-height 44px, radius 6, font-weight 600
    component NavItem: Item {
        id: nav
        property string glyph: ""
        property string label: ""
        property string index: ""
        property string badge: ""
        property bool active: false
        signal activated

        implicitHeight: 44
        Rectangle {
            id: navRect
            anchors.fill: parent
            radius: 6

            // 静止态: 透明，文字 muted
            // 悬停态: --scrim 底色，文字 ink-strong
            // 选中态: linear-gradient(90deg, accent-soft, transparent 85%) + 1px line-accent 内描边
            color: {
                if (nav.active) return "transparent"  // 选中态用渐变，不用纯色
                if (navHover.hovered) return ds.scrim
                return "transparent"
            }
            border.color: nav.active ? ds.lineAccent : "transparent"
            border.width: nav.active ? 1 : 0

            // 选中态：横向渐变底色
            Rectangle {
                visible: nav.active
                anchors.fill: parent
                radius: parent.radius
                gradient: Gradient {
                    orientation: Gradient.Horizontal
                    GradientStop { position: 0.0; color: ds.accentSoft }
                    GradientStop { position: 0.85; color: "transparent" }
                }
                z: -1
            }

            // 选中态：2px 青色左条，上下各内缩 10px，自带 10px 泛光
            Rectangle {
                visible: nav.active
                anchors { left: parent.left; top: parent.top; topMargin: 10; bottom: parent.bottom; bottomMargin: 10 }
                width: 2
                color: ds.accent
                layer.enabled: true
                layer.effect: MultiEffect {
                    shadowEnabled: true
                    shadowBlur: 1.0
                    shadowColor: ds.accent
                    shadowOpacity: 0.8
                }
            }

            // 平滑过渡
            Behavior on color {
                ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
            }
            Behavior on border.color {
                ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
            }

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: ds.s12
                anchors.rightMargin: ds.s12
                spacing: ds.s12

                Text {
                    id: iconText
                    text: nav.glyph
                    // 选中态图标: accent 色 + drop-shadow
                    color: nav.active ? ds.accent : (navHover.hovered ? ds.inkStrong : ds.muted)
                    font.family: ds.ui
                    font.pixelSize: 20
                    Layout.alignment: Qt.AlignVCenter

                    layer.enabled: nav.active
                    layer.effect: MultiEffect {
                        shadowEnabled: true
                        shadowBlur: 0.6
                        shadowColor: Qt.rgba(34/255, 211/255, 238/255, 0.55)
                        shadowOpacity: 1.0
                    }

                    Behavior on color {
                        ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                    }
                }

                Text {
                    text: nav.label
                    color: nav.active ? ds.inkStrong : (navHover.hovered ? ds.inkStrong : ds.muted)
                    font.family: ds.ui
                    font.pixelSize: 16
                    font.weight: 600  // web: font-weight 600
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                    Layout.alignment: Qt.AlignVCenter

                    Behavior on color {
                        ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                    }
                }

                Rectangle {
                    visible: nav.badge !== ""
                    Layout.alignment: Qt.AlignVCenter
                    implicitWidth: badgeLabel.implicitWidth + ds.s12
                    implicitHeight: 22
                    radius: 11  // pill
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

                Text {
                    text: nav.index
                    // 静止态: accent，选中态: accent-hover (冰蓝)
                    color: nav.active ? ds.accentHi : ds.accent
                    font.family: ds.mono
                    font.pixelSize: 13
                    font.letterSpacing: 2  // 0.2em at 13px ≈ 2.6px
                    font.weight: Font.Normal
                    Layout.alignment: Qt.AlignVCenter

                    Behavior on color {
                        ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                    }
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
        property bool enabled: true
        signal clicked
        implicitWidth: 36
        implicitHeight: 36
        radius: 8
        color: !ibtn.enabled ? Qt.rgba(220/255, 233/255, 251/255, 0.014)
                             : (ibtn.active || ibHover.hovered ? ds.accentSoft : "transparent")
        opacity: ibtn.enabled ? 1.0 : 0.5

        // Smooth transition
        Behavior on color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }
        Behavior on opacity {
            NumberAnimation { duration: ds.durQuick; easing.type: Easing.Linear }
        }

        Text {
            anchors.centerIn: parent
            text: ibtn.glyph
            color: !ibtn.enabled ? Qt.rgba(141/255, 155/255, 172/255, 0.4)
                                 : (ibtn.active || ibHover.hovered ? ds.accentHi : ds.muted)
            font.family: ds.ui
            font.pixelSize: 15

            Behavior on color {
                ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
            }
        }
        HoverHandler {
            id: ibHover
            enabled: ibtn.enabled
            cursorShape: ibtn.enabled ? Qt.PointingHandCursor : Qt.ForbiddenCursor
        }
        TapHandler { enabled: ibtn.enabled; onTapped: ibtn.clicked() }
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
        // 禁用态: 遮光层一档 opacity 0.5，启用态正常
        color: !pbtn.enabled ? Qt.rgba(220/255, 233/255, 251/255, 0.014)
                             : (pbtnHover.hovered ? ds.accentHi : ds.accent)
        border.color: pbtn.enabled ? ds.accentEdge : Qt.rgba(32/255, 36/255, 43/255, 0.5)
        border.width: 1
        opacity: pbtn.enabled ? 1.0 : 0.5

        // Smooth transitions
        Behavior on color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }
        Behavior on border.color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }
        Behavior on opacity {
            NumberAnimation { duration: ds.durQuick; easing.type: Easing.Linear }
        }

        Text {
            id: pLabel
            anchors.centerIn: parent
            text: pbtn.label
            // 禁用态: faint 色 opacity 0.4
            color: pbtn.enabled ? ds.inkOnAccent : Qt.rgba(141/255, 155/255, 172/255, 0.4)
            font.family: ds.ui
            font.pixelSize: 13
            font.weight: Font.DemiBold
            font.letterSpacing: 0.26

            Behavior on color {
                ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
            }
        }
        HoverHandler {
            id: pbtnHover
            enabled: pbtn.enabled
            cursorShape: pbtn.enabled ? Qt.PointingHandCursor : Qt.ForbiddenCursor
        }
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
        // 禁用态: 遮光层一档 opacity 0.5
        color: !qbtn.enabled ? Qt.rgba(220/255, 233/255, 251/255, 0.014)
                             : (qbtnHover.hovered ? ds.accentSoft : "transparent")
        border.color: !qbtn.enabled ? Qt.rgba(32/255, 36/255, 43/255, 0.5)
                                    : (qbtnHover.hovered ? ds.accent : ds.lineStrong)
        border.width: 1
        opacity: qbtn.enabled ? 1.0 : 0.5

        // Smooth transitions
        Behavior on color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }
        Behavior on border.color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }
        Behavior on opacity {
            NumberAnimation { duration: ds.durQuick; easing.type: Easing.Linear }
        }

        Text {
            id: qLabel
            anchors.centerIn: parent
            text: qbtn.label
            // 禁用态: faint 色 opacity 0.4
            color: !qbtn.enabled ? Qt.rgba(141/255, 155/255, 172/255, 0.4)
                                 : (qbtnHover.hovered ? ds.accentHi : ds.ink)
            font.family: ds.ui
            font.pixelSize: 13

            Behavior on color {
                ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
            }
        }
        HoverHandler {
            id: qbtnHover
            enabled: qbtn.enabled
            cursorShape: qbtn.enabled ? Qt.PointingHandCursor : Qt.ForbiddenCursor
        }
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
            border.color: sf.activeFocus ? ds.accent
                          : (sfHover.hovered ? Qt.rgba(200/255, 224/255, 248/255, 0.5) : ds.lineStrong)
            border.width: 1

            // Inner highlight layer
            Rectangle {
                anchors { top: parent.top; left: parent.left; right: parent.right }
                height: 1
                color: "#ffffff"
                opacity: sf.activeFocus ? 0.15 : (sfHover.hovered ? 0.08 : 0.05)
                Behavior on opacity {
                    NumberAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                }
            }

            // Smooth focus transition
            Behavior on border.color {
                ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
            }
        }
        HoverHandler {
            id: sfHover
            enabled: sf.enabled
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
        color: pill.active ? ds.subjectOn : (pillHover.hovered ? ds.hoverWash : ds.subjectBg)
        border.color: pill.active ? ds.accentRing : ds.line
        border.width: 1

        // Smooth transitions
        Behavior on color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }
        Behavior on border.color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }

        HoverHandler { id: pillHover }
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
                    color: pill.active ? ds.accent : (pillHover.hovered ? ds.ink : ds.muted)
                    font.family: ds.ui
                    font.pixelSize: 12
                    Layout.alignment: Qt.AlignVCenter

                    Behavior on color {
                        ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                    }
                }
            Text {
                text: pill.count
                color: ds.faint
                font.family: ds.mono
                font.pixelSize: 10
                Layout.alignment: Qt.AlignVCenter
            }
        }
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

                BusyIndicator {
                    running: uiShell.operationBusy || uiShell.contentBusy
                             || uiShell.draftSaving || uiShell.executionBusy
                    visible: running
                    implicitWidth: 20
                    implicitHeight: 20
                    palette.highlight: ds.accent
                    Accessible.name: "正在处理"
                }

                IconButton { glyph: "⚡"; tip: "快捷动作（待接入）"; enabled: false }
                IconButton { glyph: "🔔"; tip: "通知中心（待接入）"; enabled: false }

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
                    glyph: "⚙"
                    tip: "账户与设置"
                    onClicked: uiShell.selectPage("账户")
                }

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
                    glyph: "◈"; label: "实战挑战"; index: "02"
                    badge: uiShell.challengeMeta.length > 0
                           ? "" + uiShell.challengeMeta.length : ""
                    active: root.page === "挑战"
                    onActivated: uiShell.selectPage("挑战")
                }
                NavItem {
                    Layout.fillWidth: true
                    glyph: "▥"; label: "代码草稿"; index: "03"
                    active: root.page === "草稿"
                    onActivated: uiShell.selectPage("草稿")
                }
                NavItem {
                    Layout.fillWidth: true
                    glyph: "◷"; label: "复习中心"; index: "04"
                    active: root.page === "复习与进度"
                    onActivated: uiShell.selectPage("复习与进度")
                }
                NavItem {
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
                                text: uiShell.analysisSnapshot.streakDays === "暂无数据"
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
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "学习" || visited
                onLoaded: {
                    visited = true;
                    item.hostRoot = root;
                    item.ds = root.designSystem;
                }
                source: "pages/StudyPage.qml"
            }
            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "挑战" || visited
                onLoaded: {
                    visited = true;
                    item.ds = root.designSystem;
                }
                source: "pages/ChallengePage.qml"
            }
            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "草稿" || visited
                onLoaded: {
                    visited = true;
                    item.hostRoot = root;
                    item.ds = root.designSystem;
                }
                source: "pages/DraftsPage.qml"
            }
            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "复习与进度" || visited
                onLoaded: {
                    visited = true;
                    item.hostRoot = root;
                    item.ds = root.designSystem;
                }
                source: "pages/ReviewPage.qml"
            }
            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "分析" || visited
                onLoaded: {
                    visited = true;
                    item.ds = root.designSystem;
                }
                source: "pages/AnalyticsPage.qml"
            }
            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "账户" || visited
                onLoaded: visited = true
                sourceComponent: AccountPage {}
            }
            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "编辑器" || visited
                onLoaded: visited = true
                sourceComponent: EditorPage {}
            }
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PAGES
    // ═════════════════════════════════════════════════════════════════════════

    // ── 02 代码草稿 ────────────────────────────────────────────────────────
    component EditorPage: Item {
        ColumnLayout {
            anchors.fill: parent
            spacing: ds.s12

            Rectangle {
                Layout.fillWidth: true
                visible: root.isErrorStatus(uiShell.contentStatus)
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
                        label: "重试保存"
                        enabled: uiShell.hasSelectedContent && !uiShell.draftSaving
                        onClicked: uiShell.saveDraft()
                    }
                    QuietButton { label: "知道了"; onClicked: uiShell.dismissContentStatus() }
                }
            }

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
                    label: "记录实践证据"
                    onClicked: evidenceDialog.open()
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
                                    model: root.selectedLesson ? (root.selectedLesson.flow || []) : []
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
                                    visible: !root.selectedLesson || (root.selectedLesson.flow || []).length === 0
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

    // ── 04 复习中心 ────────────────────────────────────────────────────────
    // ── 04 复习中心 ────────────────────────────────────────────────────────

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

    // ── 02 实战挑战 ────────────────────────────────────────────────────────
    // ── 02 实战挑战 ────────────────────────────────────────────────────────

    // ── 03 代码草稿 ────────────────────────────────────────────────────────
    // ── 03 代码草稿 ────────────────────────────────────────────────────────


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
