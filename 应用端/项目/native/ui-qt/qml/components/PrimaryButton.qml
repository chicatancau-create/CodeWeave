import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Rectangle {
    property QtObject ds
        id: pbtn
        property string label: ""
        property bool enabled: true
        activeFocusOnTab: enabled
        Keys.onReturnPressed: if (enabled) clicked()
        Keys.onEnterPressed: if (enabled) clicked()
        Keys.onSpacePressed: if (enabled) clicked()
        signal clicked
        implicitWidth: pLabel.implicitWidth + ds.s32
        implicitHeight: 36
        radius: ds.radiusSm
        // 禁用态: 遮光层一档 opacity 0.5，启用态正常
        color: !pbtn.enabled ? Qt.rgba(220/255, 233/255, 251/255, 0.014)
                             : (pbtnHover.hovered ? ds.accentHi : ds.accent)
        border.color: pbtn.enabled ? (pbtn.activeFocus ? ds.ink : ds.accentEdge) : Qt.rgba(32/255, 36/255, 43/255, 0.5)
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
