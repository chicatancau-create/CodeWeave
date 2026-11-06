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
                onLoaded: visited = true
                sourceComponent: StudyPage {}
            }
            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "挑战" || visited
                onLoaded: visited = true
                sourceComponent: ChallengePage {}
            }
            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "草稿" || visited
                sourceComponent: DraftsPage {}
            }
            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "复习与进度" || visited
                onLoaded: visited = true
                sourceComponent: ReviewPage {}
            }
            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                property bool visited: false
                active: root.page === "分析" || visited
                onLoaded: visited = true
                sourceComponent: AnalyticsPage {}
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

    // ── 01 学习路径 ────────────────────────────────────────────────────────
    component StudyPage: Item {
        id: studyPage
        property int subjectFilter: -1
        readonly property var filteredLessons: {
            const result = [];
            const lessons = uiShell.lessonMeta;
            for (let i = 0; i < lessons.length; ++i) {
                const lesson = lessons[i];
                const label = lesson.languageLabel || lesson.language || "";
                if (subjectFilter >= 0 && subjectFilter !== subjectOptions.indexOf(label)) continue;
                if (root.lessonStatusFilter !== 0) continue;
                result.push(Object.assign({}, lesson, { originalIndex: i }));
            }
            return result;
        }
        readonly property var subjectOptions: {
            const seen = [];
            const lessons = uiShell.lessonMeta;
            for (let i = 0; i < lessons.length; ++i) {
                const label = lessons[i].languageLabel || lessons[i].language || "";
                if (label !== "" && seen.indexOf(label) < 0) seen.push(label);
            }
            return seen;
        }

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

                    // Smooth hover effect
                    Behavior on color {
                        ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                    }
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
                                text: uiShell.progressSummary === "" ? "—" : "暂无"
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
                                text: uiShell.analysisSnapshot.verifiedPasses === undefined
                                      ? "暂无进度数据"
                                      : "近 7 天通过 " + uiShell.analysisSnapshot.verifiedPasses + " 次"
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
                            return studyPage.subjectOptions;
                        }
                        delegate: SubjectPill {
                            required property var modelData
                            required property int index
                            symbol: modelData.slice(0, 2).toUpperCase()
                            label: modelData
                            count: {
                                return "" + studyPage.filteredLessons.filter(function(item) {
                                    return (item.languageLabel || item.language) === modelData;
                                }).length;
                            }
                            active: studyPage.subjectFilter === index
                            onClicked: {
                                const nextFilter = studyPage.subjectFilter === index ? -1 : index;
                                studyPage.subjectFilter = nextFilter;
                                if (nextFilter < 0) {
                                    root.selectedLessonIndex = 0;
                                } else {
                                    const lessons = uiShell.lessonMeta;
                                    for (let i = 0; i < lessons.length; ++i) {
                                        if ((lessons[i].languageLabel || lessons[i].language)
                                                === modelData) {
                                            root.selectedLessonIndex = i;
                                            break;
                                        }
                                    }
                                }
                            }
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
                                    text: root.selectedLesson
                                          ? (root.selectedLesson.languageLabel || root.selectedLesson.language || "")
                                          : "暂无课程"
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
                                text: root.selectedLesson ? (root.selectedLesson.title || "") : "当前筛选暂无课程"
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
                                text: root.selectedLesson
                                      ? (root.selectedLesson.description || "课程说明暂无数据")
                                      : "当前筛选没有课程，请调整科目筛选。"
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
                                    label: root.selectedLesson === null ? "选择课程"
                                           : (uiShell.publishedIds.indexOf(root.selectedLesson.id) >= 0
                                              ? "进入学习  →" : "课程尚未发布")
                                    enabled: root.selectedLesson !== null
                                             && uiShell.publishedIds.indexOf(root.selectedLesson.id) >= 0
                                    onClicked: {
                                        if (!root.selectedLesson) return;
                                        const idx = uiShell.publishedIds.indexOf(root.selectedLesson.id);
                                        if (idx >= 0) {
                                            uiShell.openPublishedContent(idx);
                                            uiShell.selectPage("编辑器");
                                        }
                                    }
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: uiShell.analysisSnapshot.completedUnits === undefined
                                          ? "暂无完成证据数据"
                                          : uiShell.analysisSnapshot.completedUnits + " 个单元在近 7 天有完成证据"
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
                                text: "" + studyPage.filteredLessons.length
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
                                    property bool available: index === 0
                                    opacity: available ? 1 : 0.45
                                    color: index === root.lessonStatusFilter ? ds.tabActive : "transparent"
                                    border.color: index === root.lessonStatusFilter ? ds.line : "transparent"
                                    border.width: 1
                                    Text {
                                        id: fLabel
                                        anchors.centerIn: parent
                                        text: modelData
                                        color: index === root.lessonStatusFilter ? ds.ink : ds.muted
                                        font.family: ds.ui
                                        font.pixelSize: 11
                                    }
                                    HoverHandler { id: statusFilterHover }
                                    ToolTip.visible: index > 0 && statusFilterHover.hovered
                                    ToolTip.text: "完成状态尚未提供逐课程数据"
                                    TapHandler {
                                        enabled: index === 0
                                        onTapped: root.lessonStatusFilter = index
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
                            model: studyPage.filteredLessons
                            clip: true

                            Text {
                                anchors.centerIn: parent
                                visible: courseGrid.count === 0
                                text: "当前筛选暂无课程"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                            }

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
                                    id: unitCard
                                    anchors {
                                        left: parent.left
                                        right: parent.right
                                        top: parent.top
                                        bottom: parent.bottom
                                        rightMargin: ds.s12
                                        bottomMargin: ds.s12
                                    }
                                    radius: ds.radius
                                    // 静止态: 遮光层底色 rgba(220, 233, 251, 0.028)
                                    // 悬停态: 遮光层二档 rgba(220, 233, 251, 0.055)
                                    color: unitHover.hovered ? Qt.rgba(220/255, 233/255, 251/255, 0.055)
                                                             : Qt.rgba(220/255, 233/255, 251/255, 0.028)
                                    border.color: modelData.originalIndex === root.selectedLessonIndex
                                                  ? ds.accentRing
                                                  : (unitHover.hovered ? ds.lineRaised : ds.line)
                                    border.width: 1

                                    // 220ms 缓动过渡
                                    Behavior on color {
                                        ColorAnimation { duration: ds.durBase; easing.type: ds.easingType }
                                    }
                                    Behavior on border.color {
                                        ColorAnimation { duration: ds.durBase; easing.type: ds.easingType }
                                    }

                                    // 内高光（悬停态）
                                    Rectangle {
                                        anchors { top: parent.top; left: parent.left; right: parent.right }
                                        height: 1
                                        color: Qt.rgba(180/255, 215/255, 255/255, 0.07)
                                        opacity: unitHover.hovered ? 1.0 : 0
                                        Behavior on opacity {
                                            NumberAnimation { duration: ds.durBase; easing.type: Easing.Linear }
                                        }
                                    }

                                    // 面板发光（悬停态）
                                    layer.enabled: unitHover.hovered && (ds.useLayerEffects !== false)
                                    layer.effect: MultiEffect {
                                        shadowEnabled: true
                                        shadowBlur: 1.0
                                        shadowHorizontalOffset: 0
                                        shadowVerticalOffset: 8
                                        shadowColor: Qt.rgba(0, 0, 0, 0.55)
                                        shadowOpacity: 1.0
                                    }

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
                                                    text: "暂无状态数据"
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
                                        onTapped: root.selectedLessonIndex = modelData.originalIndex
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
                                                  : (root.selectedLesson
                                                     ? "所选课程正文尚未加载"
                                                     : "选择课程后展示代码")
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
                                        text: root.selectedLesson
                                              ? (root.selectedLesson.title || "课程标题暂无数据")
                                              : "选择课程后查看今日计划"
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
    component ReviewPage: Item {
        id: reviewPage

        function itemsForGroup(groupKey) {
            return uiShell.reviewItems.filter(function(item) { return item.group === groupKey; });
        }

        function lessonTitle(contentId) {
            const lesson = uiShell.lessonMeta.find(function(item) { return item.id === contentId; });
            return lesson ? lesson.title : contentId;
        }

        ScrollView {
            anchors.fill: parent
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            clip: true

            Rectangle {
                // .cw-review — a bordered, rounded panel (unlike .projects-view)
                width: reviewPage.width
                implicitHeight: reviewCol.implicitHeight + ds.s32 * 2
                color: ds.page
                border.color: ds.line
                border.width: 1
                radius: ds.radius

                ColumnLayout {
                    id: reviewCol
                    anchors {
                        left: parent.left
                        right: parent.right
                        top: parent.top
                        margins: ds.s32
                        rightMargin: 29
                    }
                    spacing: 0

                    // .module-heading
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.bottomMargin: 0
                        spacing: ds.s14
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0
                            RowLayout {
                                spacing: ds.s8
                                Rectangle {   // .eyebrow-dot — 6px FILLED here
                                    implicitWidth: 6
                                    implicitHeight: 6
                                    radius: 3
                                    color: ds.accent
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Text {
                                    text: "复习中心"
                                    color: ds.muted
                                    font.family: ds.mono
                                    font.pixelSize: 13
                                    font.letterSpacing: 3.1
                                    font.capitalization: Font.AllUppercase
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                            Text {
                                Layout.topMargin: ds.s6
                                Layout.bottomMargin: ds.s8
                                text: "延迟复测"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 24
                                font.weight: Font.DemiBold
                                font.letterSpacing: -0.5
                                lineHeight: 1.4
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "按本机排期：学完后第 1、3、7、14、30 天各一次，共 5 个节点"
                                      + "——按这份节奏回顾已学内容；未通过的复测会降低掌握等级并重新安排。"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                lineHeight: 1.6
                                wrapMode: Text.WordWrap
                            }
                        }
                        // .challenge-stats — the one stat line, bottom-right
                        Text {
                            text: "待复测 " + (uiShell.analysisSnapshot.reviewDueCount === undefined
                                  ? "暂无数据" : uiShell.analysisSnapshot.reviewDueCount)
                                  + " 项 · 未来 7 天 "
                                  + (uiShell.analysisSnapshot.reviewNext7Days === undefined
                                      ? "暂无数据" : uiShell.analysisSnapshot.reviewNext7Days) + " 项"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            Layout.alignment: Qt.AlignBottom
                        }
                    }

                    // .rv-async.rv-empty.rv-async--failed — hairline strip
                    Rectangle {
                        visible: root.isErrorStatus(uiShell.contentStatus)
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        implicitHeight: asyncCol.implicitHeight + ds.s32
                        color: "transparent"
                        border.color: "transparent"
                        Rectangle {
                            anchors { left: parent.left; right: parent.right; top: parent.top }
                            height: 1
                            color: ds.line
                        }
                        Rectangle {
                            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                            height: 1
                            color: ds.lineStrong
                        }
                        ColumnLayout {
                            id: asyncCol
                            anchors {
                                left: parent.left
                                right: parent.right
                                top: parent.top
                                topMargin: ds.s16
                                rightMargin: ds.s16
                            }
                            spacing: ds.s10
                            Text {
                                Layout.fillWidth: true
                                text: uiShell.contentStatus
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                lineHeight: 1.6
                                wrapMode: Text.WordWrap
                            }
                            QuietButton {
                                implicitHeight: 44
                                label: "重试读取"
                                enabled: !uiShell.operationBusy
                                onClicked: uiShell.refreshReviewSummary()
                            }
                            QuietButton {
                                label: "知道了"
                                onClicked: uiShell.dismissContentStatus()
                            }
                        }
                    }

                    // .review-center-empty — no scheduled reviews
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        spacing: ds.s10
                        visible: uiShell.reviewSummary === ""
                        Rectangle {
                            implicitWidth: 24
                            implicitHeight: 24
                            radius: 0
                            color: "transparent"
                            Layout.alignment: Qt.AlignLeft
                            Text {
                                anchors.centerIn: parent
                                text: "◷"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 15
                            }
                        }
                        Text {
                            Layout.fillWidth: true
                            text: "当前没有任何计划的复测。完成课程单元后会自动按计划安排。"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 14
                            lineHeight: 1.6
                            wrapMode: Text.WordWrap
                        }
                    }

                    // Records, when the native ledger has any.
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        spacing: 0
                        visible: uiShell.reviewSummary !== ""

                        // .rv-block-heading
                        RowLayout {
                            Layout.fillWidth: true
                            Layout.bottomMargin: ds.s10
                            spacing: ds.s12
                            Text {
                                text: "01"
                                color: ds.accent
                                font.family: ds.ui
                                font.pixelSize: 32
                                font.weight: Font.DemiBold
                                font.letterSpacing: -0.96
                                Layout.alignment: Qt.AlignBaseline
                            }
                            Text {
                                text: "复测记录"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 20
                                font.letterSpacing: -0.4
                                lineHeight: 1.15
                                Layout.alignment: Qt.AlignBaseline
                            }
                            Item { Layout.fillWidth: true }
                            // .rv-mark--today — text only in a heading
                            Text {
                                text: "今日到期"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 13
                                Layout.alignment: Qt.AlignBaseline
                            }
                        }
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.bottomMargin: ds.s16
                            height: 1
                            color: ds.lineRaised
                        }
                    }

                    Repeater {
                        model: [
                            { key: "overdue", label: "逾期复测" },
                            { key: "today", label: "今日到期" },
                            { key: "upcoming", label: "未来 7 天" }
                        ]
                        delegate: ColumnLayout {
                            required property var modelData
                            Layout.fillWidth: true
                            Layout.topMargin: ds.s24
                            spacing: 0

                            RowLayout {
                                Layout.fillWidth: true
                                Layout.bottomMargin: ds.s10
                                Text {
                                    text: modelData.label
                                    color: ds.ink
                                    font.family: ds.ui
                                    font.pixelSize: 18
                                    font.weight: Font.DemiBold
                                }
                                Text {
                                    text: "(" + reviewPage.itemsForGroup(modelData.key).length + ")"
                                    color: ds.muted
                                    font.family: ds.mono
                                    font.pixelSize: 13
                                }
                                Item { Layout.fillWidth: true }
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                Layout.bottomMargin: ds.s6
                                spacing: ds.s10
                                Repeater {
                                    model: ["课程 / 练习", "到期日", "下一节点", "掌握度", "操作"]
                                    delegate: Text {
                                        required property string modelData
                                        Layout.fillWidth: true
                                        text: modelData
                                        color: ds.faint
                                        font.family: ds.ui
                                        font.pixelSize: 12
                                    }
                                }
                            }

                            Repeater {
                                model: reviewPage.itemsForGroup(modelData.key)
                                delegate: ColumnLayout {
                                    required property var modelData
                                    Layout.fillWidth: true
                                    spacing: ds.s6

                                    Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }
                                    RowLayout {
                                        Layout.fillWidth: true
                                        Layout.topMargin: ds.s8
                                        Layout.bottomMargin: ds.s8
                                        spacing: ds.s10
                                        Text {
                                            Layout.fillWidth: true
                                            Layout.preferredWidth: 260
                                            text: reviewPage.lessonTitle(modelData.contentId)
                                                  + " / " + modelData.exerciseId
                                            color: ds.ink
                                            font.family: ds.ui
                                            font.pixelSize: 13
                                            elide: Text.ElideRight
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            Layout.preferredWidth: 110
                                            text: modelData.dueKey || "—"
                                            color: ds.muted
                                            font.family: ds.mono
                                            font.pixelSize: 12
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            Layout.preferredWidth: 110
                                            text: "第 " + (modelData.nextNodeIndex + 1) + " 次"
                                            color: ds.muted
                                            font.family: ds.ui
                                            font.pixelSize: 12
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            Layout.preferredWidth: 90
                                            text: "等级 " + modelData.masteryLevel
                                            color: ds.muted
                                            font.family: ds.ui
                                            font.pixelSize: 12
                                        }
                                        RowLayout {
                                            Layout.fillWidth: true
                                            Layout.preferredWidth: 310
                                            spacing: ds.s4
                                            QuietButton {
                                                implicitHeight: 36
                                                label: "通过"
                                                enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                                                onClicked: uiShell.reviewItem(modelData.itemId, true, "")
                                            }
                                            QuietButton {
                                                implicitHeight: 36
                                                label: "稍后提醒"
                                                enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                                                onClicked: uiShell.snoozeReview(modelData.itemId)
                                            }
                                            QuietButton {
                                                implicitHeight: 36
                                                label: "查看课程"
                                                enabled: uiShell.publishedIds.indexOf(modelData.contentId) >= 0
                                                onClicked: uiShell.openPublishedContent(
                                                    uiShell.publishedIds.indexOf(modelData.contentId))
                                            }
                                        }
                                    }
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s8
                                visible: reviewPage.itemsForGroup(modelData.key).length === 0
                                text: "此分组暂无复测项目。"
                                color: ds.faint
                                font.family: ds.ui
                                font.pixelSize: 13
                            }
                        }
                    }

                    // Progress summary from the native ledger
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        spacing: 0
                        visible: uiShell.progressSummary !== ""
                        Rectangle {
                            Layout.fillWidth: true
                            height: 1
                            color: ds.line
                        }
                        Text {
                            Layout.fillWidth: true
                            Layout.topMargin: ds.s12
                            text: uiShell.progressSummary
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            lineHeight: 1.6
                            wrapMode: Text.WordWrap
                        }
                    }

                    // .rv-footnote
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        height: 1
                        color: ds.line
                    }
                    Text {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s12
                        Layout.preferredWidth: 616
                        text: uiShell.analysisSnapshot.reviewScheduledCount === undefined
                              ? "本页只列 reviewDueKey 已安排的记录；暂无排期数据。"
                              : "本页只列 reviewDueKey 已安排的记录：逾期 "
                                + uiShell.analysisSnapshot.reviewOverdueCount + " 项，今日 "
                                + uiShell.analysisSnapshot.reviewTodayCount + " 项，未来 7 天 "
                                + uiShell.analysisSnapshot.reviewFuture7Days + " 项，合计 "
                                + uiShell.analysisSnapshot.reviewScheduledCount
                                + " 项；没有到期安排的记录不计入任何分母。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 13
                        lineHeight: 1.6
                        wrapMode: Text.WordWrap
                    }
                }
            }
        }
    }

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
    component ChallengePage: Item {
        id: challengePage
        property string searchText: ""
        property string stageFilter: "全部"
        property string trackFilter: "全部"
        property string difficultyFilter: "全部"
        property string runnerFilter: "全部"
        property string sortFilter: "A—M 顺序"
        property bool moreFiltersOpen: false
        property int currentPage: 1
        readonly property int pageSize: 12
        readonly property var filteredChallenges: filterChallenges()
        readonly property int pageCount: Math.max(1, Math.ceil(filteredChallenges.length / pageSize))
        readonly property var pageChallenges: filteredChallenges.slice((currentPage - 1) * pageSize,
                                                                       currentPage * pageSize)
        readonly property string activeFilterSummary: {
            const labels = [];
            if (searchText.trim()) labels.push("搜索：" + searchText.trim());
            if (stageFilter !== "全部") labels.push("阶段：" + stageFilter);
            if (trackFilter !== "全部") labels.push("轨道：" + trackFilter);
            if (difficultyFilter !== "全部") labels.push("难度：" + difficultyFilter);
            if (runnerFilter !== "全部") labels.push("运行方式：" + runnerFilter);
            if (sortFilter !== "A—M 顺序") labels.push("排序：" + sortFilter);
            return labels.join("  ·  ");
        }

        function uniqueValues(field) {
            const values = [];
            uiShell.challengeMeta.forEach(function(item) {
                const value = item[field] || "";
                if (value && values.indexOf(value) < 0) values.push(value);
            });
            values.sort();
            values.unshift("全部");
            return values;
        }

        function filterChallenges() {
            const query = searchText.trim().toLocaleLowerCase();
            const result = uiShell.challengeMeta.filter(function(item) {
                const searchable = [item.title, item.description, item.stageId, item.track,
                                    (item.stack || []).join(" ")].join(" ").toLocaleLowerCase();
                return (!query || searchable.indexOf(query) >= 0)
                    && (stageFilter === "全部" || item.stageId === stageFilter)
                    && (trackFilter === "全部" || item.track === trackFilter)
                    && (difficultyFilter === "全部" || item.difficulty === difficultyFilter)
                    && (runnerFilter === "全部" || item.runner === runnerFilter);
            });
            if (sortFilter === "标题") result.sort(function(a, b) { return a.title.localeCompare(b.title); });
            return result;
        }

        function clearFilters() {
            challengeSearch.text = "";
            searchText = "";
            stageFilter = "全部";
            trackFilter = "全部";
            difficultyFilter = "全部";
            runnerFilter = "全部";
            sortFilter = "A—M 顺序";
            currentPage = 1;
        }

        ColumnLayout {
            anchors.fill: parent
            spacing: 0

            // .module-heading.challenge-overview
            RowLayout {
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s20
                spacing: ds.s32

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0
                    // .eyebrow — mono 13px, 0.24em tracking, uppercase, 7px ring
                    RowLayout {
                        spacing: ds.s10
                        Rectangle {
                            implicitWidth: 7
                            implicitHeight: 7
                            radius: 4
                            color: "transparent"
                            border.color: ds.accent
                            border.width: 1
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Text {
                            text: "实战挑战"
                            color: ds.muted
                            font.family: ds.mono
                            font.pixelSize: 13
                            font.letterSpacing: 3.1
                            font.capitalization: Font.AllUppercase
                            Layout.alignment: Qt.AlignVCenter
                        }
                    }
                    Text {
                        Layout.topMargin: ds.s6
                        Layout.bottomMargin: ds.s8
                        text: "挑战关卡"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 24
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.5
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "通过实际问题检验学习效果，每个关卡独立验收。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 14
                        elide: Text.ElideRight
                    }
                }

                // .challenge-overview-stats — right-aligned column, 2px bar
                ColumnLayout {
                    Layout.alignment: Qt.AlignTop
                    Layout.preferredWidth: 240
                    spacing: ds.s10
                    Text {
                        Layout.fillWidth: true
                        text: "共 " + uiShell.challengeMeta.length + " 关 · 筛选后 "
                              + challengePage.filteredChallenges.length + " 关"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 14
                        horizontalAlignment: Text.AlignRight
                    }
                }
            }

            // .challenge-filters
            Rectangle {
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s20
                implicitHeight: filterRow.implicitHeight + (challengePage.moreFiltersOpen ? 72 : 0) + ds.s32
                radius: ds.radius
                color: "#12161d"
                border.color: ds.line
                border.width: 1

                RowLayout {
                    id: filterRow
                    anchors { left: parent.left; right: parent.right; top: parent.top;
                              leftMargin: ds.s16; rightMargin: ds.s16; topMargin: ds.s16 }
                    spacing: ds.s14

                    // .challenge-filters-label
                    RowLayout {
                        spacing: ds.s8
                        Text {
                            text: "◫"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Text {
                            text: "筛选"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.letterSpacing: 2.6
                            font.capitalization: Font.AllUppercase
                            Layout.alignment: Qt.AlignVCenter
                        }
                    }

                    // .challenge-filter-search
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.preferredWidth: 220
                        spacing: ds.s4
                        Text {
                            text: "搜索"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.letterSpacing: 0.8
                        }
                        TextField {
                            id: challengeSearch
                            Layout.fillWidth: true
                            implicitHeight: 44
                            placeholderText: "标题 / 技术栈 / 说明"
                            placeholderTextColor: ds.faint
                            color: ds.ink
                            font.family: ds.mono
                            font.pixelSize: 14
                            leftPadding: ds.s10
                            rightPadding: ds.s10
                            background: Rectangle {
                                radius: ds.radiusSm
                                color: ds.inset
                                border.color: parent.activeFocus ? ds.accent : ds.lineStrong
                                border.width: 1
                            }
                            Accessible.name: "搜索关卡"
                            onTextChanged: {
                                challengePage.searchText = text;
                                challengePage.currentPage = 1;
                            }
                        }
                    }

                    ColumnLayout {
                        spacing: ds.s4
                        Text { text: "阶段"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13 }
                        ComboBox {
                            Layout.preferredWidth: 108
                            implicitHeight: 44
                            model: challengePage.uniqueValues("stageId")
                            currentIndex: Math.max(0, model.indexOf(challengePage.stageFilter))
                            onActivated: { challengePage.stageFilter = currentText; challengePage.currentPage = 1; }
                        }
                    }

                    ColumnLayout {
                        spacing: ds.s4
                        Text { text: "轨道"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13 }
                        ComboBox {
                            Layout.preferredWidth: 140
                            implicitHeight: 44
                            model: challengePage.uniqueValues("track")
                            currentIndex: Math.max(0, model.indexOf(challengePage.trackFilter))
                            onActivated: { challengePage.trackFilter = currentText; challengePage.currentPage = 1; }
                        }
                    }

                    Item { Layout.fillWidth: true }

                    QuietButton {
                        implicitHeight: 44
                        label: challengePage.moreFiltersOpen ? "收起筛选" : "更多筛选"
                        onClicked: challengePage.moreFiltersOpen = !challengePage.moreFiltersOpen
                    }
                }

                RowLayout {
                    anchors { left: parent.left; right: parent.right; bottom: parent.bottom;
                              leftMargin: ds.s16; rightMargin: ds.s16; bottomMargin: ds.s12 }
                    visible: challengePage.moreFiltersOpen
                    spacing: ds.s12
                    ColumnLayout {
                        spacing: ds.s4
                        Text { text: "难度"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13 }
                        ComboBox {
                            Layout.preferredWidth: 140
                            implicitHeight: 44
                            model: challengePage.uniqueValues("difficulty")
                            currentIndex: Math.max(0, model.indexOf(challengePage.difficultyFilter))
                            onActivated: { challengePage.difficultyFilter = currentText; challengePage.currentPage = 1; }
                        }
                    }
                    ColumnLayout {
                        spacing: ds.s4
                        Text { text: "运行方式"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13 }
                        ComboBox {
                            Layout.preferredWidth: 170
                            implicitHeight: 44
                            textRole: "label"
                            model: [
                                { value: "全部", label: "全部" },
                                { value: "teaching", label: "教学运行器" },
                                { value: "external", label: "外部环境实验" }
                            ]
                            currentIndex: Math.max(0, model.findIndex(function(item) {
                                return item.value === challengePage.runnerFilter;
                            }))
                            onActivated: {
                                challengePage.runnerFilter = model[currentIndex].value;
                                challengePage.currentPage = 1;
                            }
                        }
                    }
                    ColumnLayout {
                        spacing: ds.s4
                        Text { text: "排序"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13 }
                        ComboBox {
                            Layout.preferredWidth: 150
                            implicitHeight: 44
                            model: ["A—M 顺序", "标题"]
                            currentIndex: Math.max(0, model.indexOf(challengePage.sortFilter))
                            onActivated: { challengePage.sortFilter = currentText; challengePage.currentPage = 1; }
                        }
                    }
                    Item { Layout.fillWidth: true }
                    QuietButton {
                        implicitHeight: 44
                        label: "清除筛选"
                        enabled: challengePage.searchText !== "" || challengePage.stageFilter !== "全部"
                                 || challengePage.trackFilter !== "全部"
                                 || challengePage.difficultyFilter !== "全部"
                                 || challengePage.runnerFilter !== "全部"
                                 || challengePage.sortFilter !== "A—M 顺序"
                        onClicked: challengePage.clearFilters()
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s12
                visible: challengePage.activeFilterSummary !== ""
                spacing: ds.s10
                Text {
                    Layout.fillWidth: true
                    text: challengePage.activeFilterSummary
                    color: ds.muted
                    font.family: ds.ui
                    font.pixelSize: 12
                    elide: Text.ElideRight
                }
                QuietButton {
                    implicitHeight: 36
                    label: "清除筛选"
                    onClicked: challengePage.clearFilters()
                }
            }

            // ol.challenge-grid — the page's own scroll box
            Item {
                Layout.fillWidth: true
                Layout.fillHeight: true
                ScrollView {
                    anchors.fill: parent
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                    GridView {
                        id: challengeGrid
                        anchors.fill: parent
                        cellWidth: Math.max(1, Math.floor(width / 3) - 1)
                        cellHeight: 236
                        model: challengePage.pageChallenges
                        clip: true

                        delegate: Item {
                            required property var modelData
                            required property int index
                            width: challengeGrid.cellWidth
                            height: challengeGrid.cellHeight

                        // .stage-card — mono text, hairline ledger
                        Rectangle {
                            anchors {
                                left: parent.left
                                right: parent.right
                                top: parent.top
                                bottom: parent.bottom
                                rightMargin: ds.s20
                                bottomMargin: ds.s20
                            }
                            radius: ds.radius
                            color: chHover.hovered ? "#161c24" : "transparent"

                            // status left bar — 悬停时宽度从 1px 过渡到 3px（220ms）
                            Rectangle {
                                anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
                                width: chHover.hovered ? 3 : 1
                                color: {
                                    const k = chStatus(modelData);
                                    // 6 档状态色映射
                                    if (k === "not-started") return ds.faint;           // 未开始：faint 色
                                    if (k === "external-pending") return ds.warning;    // 外部待定：warn 色
                                    if (k === "unsupported") return ds.danger;          // 不支持：danger 色
                                    if (k === "ready-to-submit") return ds.info;        // 可提交：info 色
                                    if (k === "pending-verify") return ds.accent;       // 待确认：accent 色
                                    if (k === "passed") return ds.success;              // 已通过：success 色
                                    return ds.line;
                                }

                                Behavior on width {
                                    NumberAnimation { duration: ds.durBase; easing.type: ds.easingType }
                                }
                                Behavior on color {
                                    ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                                }
                            }

                            // Anchored rather than stacked: the meta row is pinned
                            // to the bottom and the text is clipped from the top,
                            // so a long title can never push the meta row into the
                            // next grid cell.
                            Item {
                                anchors.fill: parent
                                anchors.margins: ds.s14
                                clip: true

                                // .stage-card-top
                                RowLayout {
                                    id: cardTop
                                    anchors { left: parent.left; right: parent.right; top: parent.top }
                                    spacing: ds.s10
                                    Text {   // .stage-card-no
                                        text: (index + 1) < 10 ? "0" + (index + 1) : "" + (index + 1)
                                        color: ds.accent
                                        font.family: ds.mono
                                        font.pixelSize: 14
                                        font.letterSpacing: 2
                                        Layout.alignment: Qt.AlignVCenter
                                    }
                                    Rectangle {   // .stage-badge
                                        implicitWidth: 26
                                        implicitHeight: 26
                                        radius: 0
                                        color: "transparent"
                                        border.color: ds.lineStrong
                                        border.width: 1
                                        Layout.alignment: Qt.AlignVCenter
                                        Text {
                                            anchors.centerIn: parent
                                            text: modelData.stageId || ""
                                            color: ds.ink
                                            font.family: ds.mono
                                            font.pixelSize: 13
                                            font.weight: Font.DemiBold
                                        }
                                    }
                                    Item { Layout.fillWidth: true }
                                    // .stage-status
                                    Rectangle {
                                        implicitWidth: stRow.implicitWidth + ds.s20
                                        implicitHeight: 22
                                        radius: 0
                                        color: chStatus(modelData) === "external-pending"
                                               ? "#241f0d" : "transparent"
                                        border.color: chStatus(modelData) === "external-pending"
                                                      ? ds.warning : ds.lineRaised
                                        border.width: 1
                                        Layout.alignment: Qt.AlignVCenter
                                        RowLayout {
                                            id: stRow
                                            anchors.centerIn: parent
                                            spacing: ds.s6
                                            Rectangle {
                                                implicitWidth: 7
                                                implicitHeight: 7
                                                radius: 4
                                                color: chStatus(modelData) === "external-pending"
                                                       ? ds.warning : "transparent"
                                                border.color: chStatus(modelData) === "external-pending"
                                                              ? ds.warning : ds.lineRaised
                                                border.width: 1
                                                Layout.alignment: Qt.AlignVCenter
                                            }
                                            Text {
                                                text: chStatus(modelData) === "external-pending"
                                                      ? "待实验" : "未开始"
                                                color: chStatus(modelData) === "external-pending"
                                                       ? ds.warning : ds.faint
                                                font.family: ds.ui
                                                font.pixelSize: 13
                                                font.weight: Font.DemiBold
                                                font.letterSpacing: 0.8
                                                Layout.alignment: Qt.AlignVCenter
                                            }
                                        }
                                    }
                                }

                                // .stage-card-meta — pinned to the bottom
                                RowLayout {
                                    id: cardMeta
                                    anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                                    spacing: ds.s10
                                    Rectangle {   // .difficulty — neutral for all levels
                                        implicitWidth: difLabel.implicitWidth + ds.s16
                                        implicitHeight: 22
                                        radius: 0
                                        color: "transparent"
                                        border.color: ds.lineRaised
                                        border.width: 1
                                        Layout.alignment: Qt.AlignVCenter
                                        Text {
                                            id: difLabel
                                            anchors.centerIn: parent
                                            text: modelData.difficulty || ""
                                            color: ds.muted
                                            font.family: ds.mono
                                            font.pixelSize: 13
                                            font.letterSpacing: 1.8
                                        }
                                    }
                                    Text {   // .stage-runner
                                        text: modelData.runner === "external"
                                              ? "外部环境实验" : "教学运行器"
                                        color: "#7a828f"
                                        font.family: ds.mono
                                        font.pixelSize: 13
                                        Layout.alignment: Qt.AlignVCenter
                                    }
                                    Item { Layout.fillWidth: true }
                                    Text {   // .stage-card-action
                                        text: "开始挑战"
                                        color: ds.ink
                                        font.family: ds.mono
                                        font.pixelSize: 14
                                        font.weight: Font.DemiBold
                                        Layout.alignment: Qt.AlignVCenter
                                    }
                                }

                                // hairline above the meta row
                                Rectangle {
                                    anchors { left: parent.left; right: parent.right
                                               bottom: cardMeta.top; bottomMargin: ds.s6 }
                                    height: 1
                                    color: ds.line
                                }

                                ColumnLayout {
                                    anchors {
                                        left: parent.left
                                        right: parent.right
                                        top: cardTop.bottom
                                        bottom: cardMeta.top
                                        topMargin: ds.s8
                                        bottomMargin: ds.s14
                                    }
                                    spacing: ds.s6

                                    // .stage-title — shortTitle, mono
                                    Text {
                                        Layout.fillWidth: true
                                        text: (modelData.title || "").replace(/^[A-M] 关卡验收：/, "")
                                        color: ds.ink
                                        font.family: ds.mono
                                        font.pixelSize: 14
                                        font.weight: Font.DemiBold
                                        lineHeight: 1.45
                                        wrapMode: Text.WordWrap
                                        maximumLineCount: 2
                                        elide: Text.ElideRight
                                    }

                                    // .stage-card-summary — description + 本关聚焦
                                    Text {
                                        Layout.fillWidth: true
                                        text: (modelData.description || "")
                                              + ((modelData.stack || []).length > 0
                                                 ? " 本关聚焦：" + modelData.stack.join("、") + "。"
                                                 : "")
                                        color: ds.muted
                                        font.family: ds.mono
                                        font.pixelSize: 14
                                        lineHeight: 1.6
                                        wrapMode: Text.WordWrap
                                        maximumLineCount: 2
                                        elide: Text.ElideRight
                                    }

                                    Item { Layout.fillHeight: true }
                                }
                            }

                            HoverHandler { id: chHover; cursorShape: Qt.PointingHandCursor }
                            // No native challenge runner exists yet, so the card
                            // stays informational rather than navigating somewhere
                            // that would pretend to run it.
                        }
                        }
                    }
                    ColumnLayout {
                        anchors.centerIn: parent
                        width: Math.min(parent.width - ds.s32, 420)
                        visible: challengePage.filteredChallenges.length === 0
                        spacing: ds.s10
                        Text {
                            Layout.fillWidth: true
                            text: uiShell.challengeMeta.length === 0
                                  ? "暂无可用的挑战数据。" : "当前筛选条件下没有匹配的关卡。"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 14
                            horizontalAlignment: Text.AlignHCenter
                            wrapMode: Text.WordWrap
                        }
                        QuietButton {
                            Layout.alignment: Qt.AlignHCenter
                            implicitHeight: 44
                            label: "清除筛选"
                            visible: uiShell.challengeMeta.length > 0
                            enabled: challengePage.searchText !== "" || challengePage.stageFilter !== "全部"
                                     || challengePage.trackFilter !== "全部"
                                     || challengePage.difficultyFilter !== "全部"
                                     || challengePage.sortFilter !== "A—M 顺序"
                                     || challengePage.runnerFilter !== "全部"
                            onClicked: challengePage.clearFilters()
                        }
                    }
                }
            }

            // nav.challenge-pagination
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: 1
                color: ds.line
            }
            RowLayout {
                Layout.fillWidth: true
                Layout.topMargin: ds.s20
                spacing: ds.s12
                QuietButton {
                    implicitHeight: 44
                    label: "‹ 上一页"
                    enabled: challengePage.currentPage > 1
                    onClicked: challengePage.currentPage = Math.max(1, challengePage.currentPage - 1)
                }
                Item { Layout.fillWidth: true }
                Text {
                    text: challengePage.filteredChallenges.length === 0
                          ? "暂无匹配关卡" : "第 " + challengePage.currentPage + " / " + challengePage.pageCount + " 页"
                    color: ds.muted
                    font.family: ds.ui
                    font.pixelSize: 14
                    font.letterSpacing: 0.8
                    Layout.alignment: Qt.AlignVCenter
                }
                Item { Layout.fillWidth: true }
                QuietButton {
                    implicitHeight: 44
                    label: "下一页 ›"
                    enabled: challengePage.currentPage < challengePage.pageCount
                    onClicked: challengePage.currentPage = Math.min(challengePage.pageCount,
                                                                     challengePage.currentPage + 1)
                }
            }
        }
    }

    // Status classification shared by the challenge card.
    function chStatus(item) {
        return item.runner === "external" ? "external-pending" : "not-started";
    }

    // ── 03 代码草稿 ────────────────────────────────────────────────────────
    // ── 03 代码草稿 ────────────────────────────────────────────────────────
    component DraftsPage: Item {
        id: draftsPage

        ColumnLayout {
            anchors.fill: parent
            spacing: ds.s28   // root gap clamp(20px, 2.4vw, 28px)

            Rectangle {
                Layout.fillWidth: true
                visible: root.isErrorStatus(uiShell.contentStatus)
                implicitHeight: draftStatusRow.implicitHeight + ds.s16
                radius: ds.radiusSm
                color: ds.bannerBg
                border.color: ds.warning
                RowLayout {
                    id: draftStatusRow
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

            // .module-heading.project-overview
            RowLayout {
                Layout.fillWidth: true
                Layout.bottomMargin: 0
                spacing: ds.s32
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0
                    // .eyebrow — 7px HOLLOW ring here, 13px mono label
                    RowLayout {
                        spacing: ds.s10
                        Rectangle {
                            implicitWidth: 7
                            implicitHeight: 7
                            radius: 4
                            color: "transparent"
                            border.color: ds.accent
                            border.width: 1
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Text {
                            text: "我的练习项目"
                            color: ds.muted
                            font.family: ds.mono
                            font.pixelSize: 13
                            font.letterSpacing: 3.1
                            font.capitalization: Font.AllUppercase
                            Layout.alignment: Qt.AlignVCenter
                        }
                    }
                    Text {
                        Layout.topMargin: ds.s6
                        Layout.bottomMargin: ds.s8
                        text: "代码草稿"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 24
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.5
                        lineHeight: 1.4
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "保存你的练习代码，随时回来继续。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 14
                        lineHeight: 1.6
                        elide: Text.ElideRight
                    }
                }

                // .project-create
                RowLayout {
                    spacing: ds.s10
                    Layout.alignment: Qt.AlignBottom
                    ColumnLayout {
                        spacing: ds.s6
                        Text {
                            text: "新项目语言"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.letterSpacing: 0.8
                        }
                        Rectangle {   // .setting-select
                            implicitWidth: 148
                            implicitHeight: 44
                            radius: ds.radiusSm
                            color: ds.inset
                            border.color: ds.lineStrong
                            border.width: 1
                            RowLayout {
                                anchors { fill: parent; leftMargin: ds.s12; rightMargin: ds.s12 }
                                spacing: ds.s6
                                Text {
                                    Layout.fillWidth: true
                                    text: uiShell.starterLanguage !== ""
                                          ? uiShell.starterLanguage : "python"
                                    color: ds.ink
                                    font.family: ds.mono
                                    font.pixelSize: 14
                                    elide: Text.ElideRight
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Text {
                                    text: "▾"
                                    color: ds.faint
                                    font.family: ds.ui
                                    font.pixelSize: 11
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                            Accessible.role: Accessible.ComboBox
                            Accessible.name: "新项目语言"
                        }
                    }
                    // .project-create .primary-action — outlined pill (0,3,0 wins)
                    Rectangle {
                        id: newProjectBtn
                        implicitWidth: npLabel.implicitWidth + 40
                        implicitHeight: 44
                        radius: 100
                        color: npHover.hovered ? ds.accentFill : "transparent"
                        border.color: ds.accent
                        border.width: 1
                        Layout.alignment: Qt.AlignBottom
                        Text {
                            id: npLabel
                            anchors.centerIn: parent
                            text: "新建项目"
                            color: ds.ink
                            font.family: ds.mono
                            font.pixelSize: 14
                            font.weight: Font.DemiBold
                            font.letterSpacing: 0.26
                        }
                        HoverHandler { id: npHover; cursorShape: Qt.PointingHandCursor }
                        TapHandler { onTapped: uiShell.selectPage("编辑器") }
                        Accessible.role: Accessible.Button
                        Accessible.name: "新建项目"
                    }
                }
            }

            // heading hairline
            Rectangle {
                Layout.fillWidth: true
                Layout.topMargin: ds.s0
                height: 1
                color: ds.line
            }

            // .projects-layout — minmax(220px,300px) + 1fr
            RowLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: ds.s24

                // .project-list-column
                ColumnLayout {
                    Layout.minimumWidth: 220
                    Layout.maximumWidth: 300
                    Layout.preferredWidth: 300
                    Layout.fillHeight: true
                    spacing: ds.s10

                    // .projects-section-title — count on the right
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.bottomMargin: ds.s8
                        spacing: ds.s10
                        Text {
                            Layout.fillWidth: true
                            text: "项目清单"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.letterSpacing: 2.6
                            font.capitalization: Font.AllUppercase
                        }
                        Text {
                            text: uiShell.hasSelectedContent ? "01 个" : "00 个"
                            color: "#7a828f"
                            font.family: ds.ui
                            font.pixelSize: 13
                        }
                    }
                    Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }

                    // .project-card — real draft, when a course is open
                    Rectangle {
                        id: projectCard
                        Layout.fillWidth: true
                        implicitHeight: 72
                        visible: uiShell.hasSelectedContent
                        radius: ds.radius
                        // 静止态: 透明背景
                        // 悬停态: 遮光层底色 rgba(220, 233, 251, 0.028)
                        // 选中态: 遮光层二档 rgba(220, 233, 251, 0.055)
                        color: draftHover.hovered ? Qt.rgba(220/255, 233/255, 251/255, 0.055)
                                                  : "transparent"
                        border.color: ds.line
                        border.width: 1

                        // 平滑过渡（150ms）
                        Behavior on color {
                            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                        }

                        // 悬停/选中左条（与 dirty 状态解耦）
                        // 悬停态: 2px accent 左条
                        // 选中态: 3px accent 左条（这里暂时按悬停显示，选中需要额外状态）
                        Rectangle {
                            anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
                            width: draftHover.hovered ? 2 : 0
                            color: ds.accent
                            Behavior on width {
                                NumberAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                            }
                        }

                        // 近距发光（选中态 - 这里暂时不启用，因为没有明确的选中状态）
                        // layer.enabled: selected && (ds.useLayerEffects !== false)
                        // layer.effect: Glow { ... }

                        RowLayout {
                            anchors { fill: parent; leftMargin: ds.s12; rightMargin: ds.s12 }
                            spacing: ds.s10
                            Text {   // .project-card-no
                                text: "01"
                                color: ds.accent
                                font.family: ds.ui
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                                font.letterSpacing: 1.8
                                Layout.alignment: Qt.AlignTop
                                Layout.topMargin: ds.s6
                            }
                            Rectangle {   // .project-icon — 28px square, radius 0
                                implicitWidth: 28
                                implicitHeight: 28
                                radius: 0
                                color: "transparent"
                                border.color: ds.line
                                border.width: 1
                                Layout.alignment: Qt.AlignVCenter
                                Text {
                                    anchors.centerIn: parent
                                    text: "<>"
                                    color: "#7a828f"
                                    font.family: ds.mono
                                    font.pixelSize: 10
                                }
                            }
                            ColumnLayout {   // .project-card-body
                                Layout.fillWidth: true
                                spacing: ds.s4
                                Text {
                                    Layout.fillWidth: true
                                    text: uiShell.documentId || "未命名草稿"
                                    color: ds.ink
                                    font.family: ds.ui
                                    font.pixelSize: 14
                                    font.weight: Font.DemiBold
                                    lineHeight: 1.5
                                    elide: Text.ElideRight
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: (uiShell.starterLanguage || "—") + " · "
                                          + (uiShell.draftDirty ? "有未保存改动" : "已保存")
                                    color: ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                    font.letterSpacing: 0.5
                                    elide: Text.ElideRight
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: "revision " + uiShell.draftRevision
                                    color: "#7a828f"
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                    elide: Text.ElideRight
                                }
                            }
                        }
                        HoverHandler { id: draftHover; cursorShape: Qt.PointingHandCursor }
                        TapHandler { onTapped: uiShell.selectPage("编辑器") }
                    }

                    // .empty-state — dashed border, radius 8
                    Rectangle {
                        Layout.fillWidth: true
                        implicitHeight: emptyCol.implicitHeight + ds.s32
                        visible: !uiShell.hasSelectedContent
                        radius: ds.radius
                        color: "transparent"
                        border.color: ds.lineStrong
                        border.width: 1
                        ColumnLayout {
                            id: emptyCol
                            anchors { fill: parent; margins: ds.s16 }
                            spacing: ds.s8
                            Text {
                                text: "<>"
                                color: "#7a828f"
                                font.family: ds.mono
                                font.pixelSize: 22
                                Layout.alignment: Qt.AlignLeft
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "还没有保存的项目"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 14
                                font.weight: Font.DemiBold
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "创建第一个项目开始练习"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                lineHeight: 1.6
                                wrapMode: Text.WordWrap
                            }
                        }
                    }

                    Item { Layout.fillHeight: true }
                }

                // .project-detail — bordered panel, transparent fill
                Rectangle {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    radius: ds.radius
                    color: "transparent"
                    border.color: ds.line
                    border.width: 1

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: ds.s20
                        spacing: ds.s16

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s12
                            Text {
                                Layout.fillWidth: true
                                text: uiShell.hasSelectedContent
                                      ? (uiShell.documentId || "未命名草稿")
                                      : "未选择草稿"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 16
                                font.weight: Font.DemiBold
                                elide: Text.ElideRight
                            }
                            QuietButton {
                                implicitHeight: 32
                                label: "复制"
                                enabled: false
                            }
                            QuietButton {
                                implicitHeight: 32
                                label: "删除"
                                enabled: false
                            }
                        }

                        Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }

                        // .project-zone--draft
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s10
                            Text {
                                text: "01"
                                color: ds.accent
                                font.family: ds.ui
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                                font.letterSpacing: 1.8
                                Layout.alignment: Qt.AlignVCenter
                            }
                            Text {
                                text: "本机草稿"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 14
                                font.weight: Font.DemiBold
                                Layout.alignment: Qt.AlignVCenter
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "改动即时写入本机 · 未快照前回不到旧版本"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                                elide: Text.ElideRight
                                Layout.alignment: Qt.AlignVCenter
                            }
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            color: ds.editorBg
                            border.color: ds.line
                            border.width: 1
                            ScrollView {
                                anchors.fill: parent
                                anchors.margins: ds.s12
                                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                                TextArea {
                                    text: uiShell.draftCode
                                    readOnly: true
                                    wrapMode: TextArea.Wrap
                                    color: ds.muted
                                    font.family: ds.mono
                                    font.pixelSize: 12
                                    background: null
                                    placeholderText: "选择一门课程后可在此预览草稿"
                                    placeholderTextColor: ds.faint
                                    Accessible.name: "草稿预览"
                                }
                            }
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s10
                            Text {
                                Layout.fillWidth: true
                                text: "保存状态：" + (uiShell.draftSaving ? "保存中…"
                                      : (uiShell.draftDirty ? "未保存" : "已保存"))
                                      + " · revision " + uiShell.draftRevision
                                      + " / saved " + uiShell.savedRevision
                                color: uiShell.draftDirty ? ds.warning : ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                                elide: Text.ElideRight
                            }
                            QuietButton {
                                implicitHeight: 32
                                label: "保存检查点"
                                enabled: uiShell.hasSelectedContent
                                         && !uiShell.draftPersistenceBlocked
                                onClicked: uiShell.saveDraft()
                            }
                            QuietButton {
                                implicitHeight: 32
                                label: "打开工作台"
                                enabled: uiShell.hasSelectedContent
                                onClicked: uiShell.selectPage("编辑器")
                            }
                        }
                    }
                }
            }
        }
    }

    component AnalyticsPage: Item {
        id: analyticsPage

        // Computed once so every row agrees on the same window.
        readonly property string todayKey: Qt.formatDate(new Date(), "yyyy-MM-dd")
        readonly property string weekStartKey: {
            const d = new Date();
            d.setDate(d.getDate() - 6);
            return Qt.formatDate(d, "yyyy-MM-dd");
        }
        readonly property string period: weekStartKey + " 至 " + todayKey

        // Table geometry. The web uses table-layout:fixed with the header row
        // setting widths: 3.2em and 7em resolve against the 12.5px header font,
        // giving 40px and 87.5px; column 2 is 24%; columns 4 and 5 split the rest.
        readonly property real tblW: Math.max(0, width - ds.s32 * 2)
        // .an-specs caps at 78ch; ~7px per char at the 14px body size.
        readonly property real specWidth: Math.min(tblW, 546)
        readonly property real colNum: 40
        readonly property real colName: Math.floor(tblW * 0.24)
        readonly property real colValue: 87.5
        readonly property real colRest: Math.max(0, (tblW - colNum - colName - colValue) / 2)
        function metric(key, fallback) {
            const value = uiShell.analysisSnapshot[key]
            return value === undefined || value === null ? fallback : String(value)
        }
        readonly property string reviewRate: {
            const passed = uiShell.analysisSnapshot.reviewPassed;
            const failed = uiShell.analysisSnapshot.reviewFailed;
            if (passed === undefined || failed === undefined) return "暂无数据";
            const total = Number(passed) + Number(failed);
            return total === 0 ? "样本不足" : Math.round(Number(passed) / total * 100) + "%";
        }
        readonly property string reviewRateDetail: {
            const passed = uiShell.analysisSnapshot.reviewPassed;
            const failed = uiShell.analysisSnapshot.reviewFailed;
            if (passed === undefined || failed === undefined) return "暂无复测数据";
            return "近 7 天复测 " + (Number(passed) + Number(failed))
                + " 次（通过 " + passed + " · 未通过 " + failed + "）";
        }

        ScrollView {
            anchors.fill: parent
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            clip: true

            Rectangle {
                width: analyticsPage.width
                implicitHeight: pageCol.implicitHeight + ds.s32 * 2
                color: ds.page
                border.color: ds.line
                border.width: 1
                radius: ds.radius

                ColumnLayout {
                    id: pageCol
                    anchors {
                        left: parent.left
                        right: parent.right
                        top: parent.top
                        margins: ds.s32
                        rightMargin: 29
                    }
                    spacing: 0

                    // .module-heading — flush stack, no bottom margin
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.bottomMargin: 0
                        spacing: ds.s20
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0
                            // .eyebrow — the page's only mono text
                            RowLayout {
                                spacing: ds.s8
                                Rectangle {   // .eyebrow-dot
                                    implicitWidth: 6
                                    implicitHeight: 6
                                    radius: 3
                                    color: ds.accent
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Text {
                                    text: "学习分析"
                                    color: ds.muted
                                    font.family: ds.mono
                                    font.pixelSize: 13
                                    font.letterSpacing: 3.1
                                    font.capitalization: Font.AllUppercase
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                            Text {
                                text: "学习分析仪表盘"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 24
                                font.weight: Font.DemiBold
                                font.letterSpacing: -0.5
                                lineHeight: 1.4
                            }
                            Text {
                                Layout.topMargin: ds.s8
                                text: "统计周期：近 7 天（" + analyticsPage.period + "，按学习证据时间）。"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                elide: Text.ElideRight
                            }
                        }
                    }

                    // dl.an-specs
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        Layout.bottomMargin: ds.s24
                        spacing: 0
                        Rectangle {   // list top hairline
                            Layout.fillWidth: true
                            Layout.maximumWidth: analyticsPage.specWidth
                            height: 1
                            color: ds.line
                        }
                        Repeater {
                            model: [
                                { dt: "窗口",
                                  dd: analyticsPage.weekStartKey + " 至 "
                                      + analyticsPage.todayKey + "（含今天，共 7 个本地日期）" },
                                { dt: "归日口径",
                                  dd: "证据时间一律按本地日期归日，不把 UTC 日期当本地日期" },
                                { dt: "数据来源",
                                  dd: "仅本机学习证据：课程与复测记录、挑战验收记录、打卡记录" }
                            ]
                            delegate: ColumnLayout {
                                required property var modelData
                                Layout.fillWidth: true
                                Layout.maximumWidth: analyticsPage.specWidth
                                spacing: 0
                                RowLayout {
                                    Layout.fillWidth: true
                                    Layout.topMargin: ds.s12
                                    Layout.bottomMargin: ds.s12
                                    spacing: ds.s12
                                    Text {
                                        // 11ch at 12.5px, uppercase-tracked
                                        Layout.preferredWidth: 128
                                        text: modelData.dt
                                        color: ds.muted
                                        font.family: ds.ui
                                        font.pixelSize: 13
                                        font.letterSpacing: 2.5
                                        font.capitalization: Font.AllUppercase
                                    }
                                    Text {
                                        Layout.fillWidth: true
                                        text: modelData.dd
                                        color: ds.ink
                                        opacity: 0.82
                                        font.family: ds.ui
                                        font.pixelSize: 14
                                        lineHeight: 1.6
                                        wrapMode: Text.WordWrap
                                    }
                                }
                                Rectangle {
                                    Layout.fillWidth: true
                                    height: 1
                                    color: ds.line
                                }
                            }
                        }
                    }

                    // section.an-block ×3 — bare grids, no surface
                    Repeater {
                        model: [
                            { idx: "01", icon: "◈", title: "近 7 天学习活动",
                              rows: [
                                { n: "完成课程单元", v: analyticsPage.metric("completedUnits", "暂无数据"), b: "按 lessonId 去重，仅计通过证据",
                                  d: "窗口 " + analyticsPage.period + " 内的课程证据" },
                                { n: "课程练习次数", v: analyticsPage.metric("practiceCount", "暂无数据"), b: "同一单元重复练习分别计数，与上一行是两个口径",
                                  d: "窗口 " + analyticsPage.period + " 内的课程证据" },
                                { n: "挑战通过记录", v: analyticsPage.metric("verifiedPasses", "暂无数据"), b: "仅统计 Challenge 类型且通过的记录",
                                  d: "无分母，不折算百分比" },
                                { n: "挑战通过（旧版迁移口径）", v: "暂无数据",
                                  b: "记录缺失 status，按迁移语义单列为旧版，不混入上一行",
                                  d: "无分母，不折算百分比" },
                                { n: "复测通过", v: analyticsPage.metric("reviewPassed", "暂无数据"), b: "kind=review 且 passed 的证据",
                                  d: "当前数据源未提供复测分类" },
                                { n: "复测未通过", v: analyticsPage.metric("reviewFailed", "暂无数据"), b: "kind=review 且未通过的证据",
                                  d: "当前数据源未提供复测分类" }
                              ],
                              note: "" },
                            { idx: "02", icon: "▲", title: "近 7 天复测通过率",
                              rows: [
                                { n: "近 7 天复测通过率", v: analyticsPage.reviewRate,
                                  b: "通过 /（通过 + 未通过），四舍五入到整数百分比",
                                  d: analyticsPage.reviewRateDetail,
                                  a: analyticsPage.reviewRate === "样本不足"
                                      ? "下一步：到复习中心完成一次复测后，这里会显示比率。"
                                      : "该比率只反映近 7 天复测结果，不代表到期任务完成率。" },
                                { n: "到期任务完成率", v: "未统计",
                                  b: "需要计划任务分母；本机没有可复现的历史排期记录（STAT-01 第 4 条）",
                                  d: "无分母，不折算百分比",
                                  a: "下一步：等复习中心的排期按生效节奏累计出可复现的分母；本页不提供手填任务数的入口，也不拿活动次数顶替。" }
                              ],
                              note: "复测通过率只统计近 7 天的通过与未通过复测记录。" },
                            { idx: "03", icon: "◷", title: "连续打卡",
                              rows: [
                                { n: "连续打卡天数", v: analyticsPage.metric("streakDays", "暂无数据"),
                                  b: "从今天往回数连续有打卡记录的日期（countStreak）",
                                  d: "当前数据源未提供打卡记录" },
                                { n: "今日打卡状态", v: analyticsPage.metric("todayCheckin", "暂无数据"), b: "打卡记录按本地日期键判定",
                                  d: "今天 " + analyticsPage.todayKey },
                                { n: "学习时长（近 7 天）", v: "未统计",
                                  b: "没有时长数据源；不追溯编造（STAT-01 第 6 条）",
                                  d: "无分母，不折算百分比",
                                  a: "下一步：本页没有可开启的时长统计，也不拿活动次数折算时长；要跟踪投入时间请用下面「连续打卡」那一档，它是替代口径、不是时长。" }
                              ],
                              note: "学习时长按 STAT-01 第 6 条保持「未统计」：本机没有时长数据源，不用活动次数推算。" }
                        ]
                        delegate: ColumnLayout {
                            required property var modelData
                            required property int index
                            Layout.fillWidth: true
                            Layout.topMargin: index === 0 ? 0 : ds.s24
                            spacing: 0

                            // .an-block-heading — hairline underline, baseline row
                            RowLayout {
                                Layout.fillWidth: true
                                Layout.bottomMargin: ds.s10
                                spacing: ds.s12
                                Text {
                                    text: modelData.idx
                                    color: ds.accent
                                    font.family: ds.ui
                                    font.pixelSize: 32
                                    font.weight: Font.DemiBold
                                    font.letterSpacing: -0.96
                                    Layout.alignment: Qt.AlignBaseline
                                }
                                Text {
                                    text: modelData.icon
                                    color: ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 15
                                    Layout.alignment: Qt.AlignBaseline
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: modelData.title
                                    color: ds.ink
                                    font.family: ds.ui
                                    font.pixelSize: 20
                                    font.letterSpacing: -0.4
                                    lineHeight: 1.15
                                    Layout.alignment: Qt.AlignBaseline
                                }
                            }
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.bottomMargin: ds.s16
                                height: 1
                                color: ds.lineRaised
                            }

                            // table — fixed columns, hairline rows
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 0

                                // thead
                                Item {
                                    Layout.fillWidth: true
                                    implicitHeight: 34
                                    Rectangle {
                                        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                                        height: 1
                                        color: ds.lineRaised
                                    }
                                    RowLayout {
                                        anchors.fill: parent
                                        spacing: 0
                                        Repeater {
                                            model: [
                                                { t: "次", w: analyticsPage.colNum },
                                                { t: "指标", w: analyticsPage.colName },
                                                { t: "数值", w: analyticsPage.colValue },
                                                { t: "派生口径", w: analyticsPage.colRest },
                                                { t: "分母", w: analyticsPage.colRest }
                                            ]
                                            delegate: Text {
                                                required property var modelData
                                                Layout.preferredWidth: modelData.w
                                                Layout.alignment: Qt.AlignTop
                                                text: modelData.t
                                                color: ds.muted
                                                font.family: ds.ui
                                                font.pixelSize: 13
                                                font.letterSpacing: 2.5
                                                font.capitalization: Font.AllUppercase
                                                wrapMode: Text.WordWrap
                                            }
                                        }
                                    }
                                }

                                // tbody
                                Repeater {
                                    model: modelData.rows
                                    delegate: Item {
                                        required property var modelData
                                        required property int index
                                        Layout.fillWidth: true
                                        implicitHeight: rowCol.implicitHeight + ds.s32
                                        Rectangle {
                                            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                                            height: 1
                                            color: ds.line
                                        }
                                        RowLayout {
                                            id: rowCol
                                            anchors {
                                                left: parent.left
                                                right: parent.right
                                                top: parent.top
                                                topMargin: ds.s14
                                                rightMargin: 0
                                            }
                                            spacing: 0
                                            Text {   // .an-row-idx
                                                Layout.preferredWidth: analyticsPage.colNum
                                                Layout.alignment: Qt.AlignTop
                                                text: (index + 1) < 10 ? "0" + (index + 1) : "" + (index + 1)
                                                color: ds.muted
                                                font.family: ds.ui
                                                font.pixelSize: 13
                                            }
                                            Text {   // .an-cell-name
                                                Layout.preferredWidth: analyticsPage.colName
                                                Layout.alignment: Qt.AlignTop
                                                text: modelData.n
                                                color: ds.ink
                                                font.family: ds.ui
                                                font.pixelSize: 14
                                                lineHeight: 1.55
                                                wrapMode: Text.WordWrap
                                            }
                                            Text {   // .an-cell-value — not dimmed for 样本不足
                                                Layout.preferredWidth: analyticsPage.colValue
                                                Layout.alignment: Qt.AlignTop
                                                text: modelData.v
                                                color: ds.ink
                                                opacity: 0.82
                                                font.family: ds.ui
                                                font.pixelSize: 14
                                                lineHeight: 1.55
                                                wrapMode: Text.WordWrap
                                            }
                                            ColumnLayout {   // .an-cell-basis (+ action)
                                                Layout.preferredWidth: analyticsPage.colRest
                                                Layout.alignment: Qt.AlignTop
                                                spacing: ds.s6
                                                Text {
                                                    Layout.fillWidth: true
                                                    text: modelData.b
                                                    color: ds.muted
                                                    font.family: ds.ui
                                                    font.pixelSize: 13
                                                    lineHeight: 1.6
                                                    wrapMode: Text.WordWrap
                                                }
                                                Text {
                                                    Layout.fillWidth: true
                                                    visible: modelData.a !== undefined
                                                    text: modelData.a !== undefined ? modelData.a : ""
                                                    color: ds.muted
                                                    font.family: ds.ui
                                                    font.pixelSize: 13
                                                    lineHeight: 1.6
                                                    wrapMode: Text.WordWrap
                                                }
                                            }
                                            Text {   // .an-cell-den
                                                Layout.preferredWidth: analyticsPage.colRest
                                                Layout.alignment: Qt.AlignTop
                                                text: modelData.d
                                                color: modelData.d.indexOf("无分母") === 0 ? ds.ink : ds.muted
                                                font.family: ds.ui
                                                font.pixelSize: 13
                                                lineHeight: 1.6
                                                wrapMode: Text.WordWrap
                                            }
                                        }
                                    }
                                }
                            }

                            // .an-honest — flat hairline strip, not a card
                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: 0
                                Layout.preferredWidth: analyticsPage.tblW
                                visible: modelData.note !== ""
                                text: modelData.note
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                lineHeight: 1.6
                                wrapMode: Text.WordWrap
                                topPadding: ds.s12
                            }
                            Rectangle {
                                Layout.fillWidth: true
                                visible: modelData.note !== ""
                                Layout.topMargin: 0
                                height: 1
                                color: ds.line
                            }
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
