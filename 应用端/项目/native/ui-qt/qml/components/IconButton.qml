import QtQuick
import QtQuick.Controls.Basic

Rectangle {
    property QtObject ds
    id: ibtn
    property string glyph: ""
    property string iconName: ""
    property string tip: ""
    property bool active: false
    property bool enabled: true
    activeFocusOnTab: enabled
    Keys.onReturnPressed: if (enabled) clicked()
    Keys.onEnterPressed: if (enabled) clicked()
    Keys.onSpacePressed: if (enabled) clicked()
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
        visible: ibtn.iconName === ""
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
    LucideIcon {
        visible: ibtn.iconName !== ""
        anchors.centerIn: parent
        name: ibtn.iconName
        size: 17
        color: !ibtn.enabled ? ds.faint : (ibtn.active || ibHover.hovered ? ds.accentHi : ds.muted)
    }
    HoverHandler {
        id: ibHover
        enabled: ibtn.enabled
        cursorShape: ibtn.enabled ? Qt.PointingHandCursor : Qt.ForbiddenCursor
    }
    TapHandler { enabled: ibtn.enabled; onTapped: ibtn.clicked() }
    ToolTip.visible: ibHover.hovered && ibtn.tip !== ""
    ToolTip.text: ibtn.tip
    ToolTip.delay: 500
    Accessible.role: Accessible.Button
    Accessible.name: ibtn.tip !== "" ? ibtn.tip : ibtn.glyph
}
