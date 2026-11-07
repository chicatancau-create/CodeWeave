import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Effects

Item {
    property QtObject ds
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
