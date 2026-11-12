import QtQuick

QtObject {
    property real hostWidth: 1440
    property bool reducedMotion: false

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
    readonly property color modalSurface: chrome
    readonly property color modalScrim: Qt.rgba(0, 0, 0, 0.78)
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

    // Component-specific colors retained from the existing QML appearance.
    readonly property color topbarAreaBg: "#090d14"
    readonly property color stageMetaInk: "#a3d6df"
    readonly property color challengeFiltersBg: "#12161d"
    readonly property color challengePendingBg: "#241f0d"
    readonly property color runnerLabelInk: "#7a828f"
    readonly property color disabledControlFill: Qt.rgba(220/255, 233/255, 251/255, 0.014)
    readonly property color disabledControlInk: Qt.rgba(141/255, 155/255, 172/255, 0.4)
    readonly property color disabledControlBorder: Qt.rgba(32/255, 36/255, 43/255, 0.5)
    readonly property color fieldHoverBorder: Qt.rgba(200/255, 224/255, 248/255, 0.5)
    readonly property color fieldInnerHighlight: "#ffffff"
    readonly property color subjectSymbolBg: "#141b23"
    readonly property color heroGradientStart: "#17232f"
    readonly property color heroGradientEnd: "#102331"
    readonly property color heroCoreBg: "#16283a"
    readonly property color heroTagBg: "#0b1b27"
    readonly property color heroTagInk: "#8aa6ba"
    readonly property color lessonTileFill: Qt.rgba(220/255, 233/255, 251/255, 0.028)
    readonly property color lessonTileHoverFill: Qt.rgba(220/255, 233/255, 251/255, 0.055)
    readonly property color lessonTileHighlight: Qt.rgba(180/255, 215/255, 255/255, 0.07)
    readonly property color terminalDot: "#4c5b70"
    readonly property color navIconGlow: Qt.rgba(34/255, 211/255, 238/255, 0.55)

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

    // QFont takes one family name; CSS fallback lists are treated as an unknown family.
    readonly property string ui:   Qt.platform.os === "windows" ? "Microsoft YaHei UI" : "sans-serif"
    readonly property string shellUi: Qt.platform.os === "windows" ? "Segoe UI" : ui
    readonly property string mono: Qt.platform.os === "windows" ? "Consolas" : "monospace"

    // Spacing
    readonly property int s2: 2;   readonly property int s4: 4
    readonly property int s6: 6;   readonly property int s8: 8
    readonly property int s10: 10; readonly property int s12: 12
    readonly property int s14: 14; readonly property int s16: 16
    readonly property int s20: 20; readonly property int s22: 22
    readonly property int s24: 24; readonly property int s28: 28
    readonly property int s32: 32
    readonly property int modalPadding: 28
    readonly property int settingsToggleTrailingInset: 3

    // Shell metrics
    readonly property int topbarH: 68
    readonly property int sidebarW: 240
    readonly property int railW: 286
    readonly property int radius: 8
    readonly property int radiusSm: 5

    // Responsive sizes (from web tokens.css L152-168)
    readonly property int sizeDisplay: Math.max(42, Math.min(hostWidth * 0.06, 96))  // clamp(2.6rem, 6vw, 6rem)
    readonly property int sizeTitle: Math.max(27, Math.min(hostWidth * 0.036, 54))   // clamp(1.7rem, 3.6vw, 3.4rem)
    readonly property int sizeBody: 16
    readonly property int sizeControl: 13

    // Animation system (from web tokens.css L238-256)
    readonly property int durQuick: reducedMotion ? 0 : 150
    readonly property int durBase: reducedMotion ? 0 : 220
    readonly property int durSlow: reducedMotion ? 0 : 300
    readonly property int durHover: reducedMotion ? 0 : 400
    readonly property int durState: reducedMotion ? 0 : 500
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
