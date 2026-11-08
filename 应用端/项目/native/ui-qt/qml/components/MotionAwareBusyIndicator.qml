import QtQuick
import QtQuick.Controls.Basic

Item {
    id: indicator
    objectName: "motionAwareBusyIndicator"
    required property QtObject ds
    property bool busy: false
    property string accessibleName: "正在处理"
    implicitWidth: 20
    implicitHeight: 20
    visible: busy
    Accessible.name: busy ? accessibleName : ""

    BusyIndicator {
        objectName: "motionSpinner"
        anchors.fill: parent
        visible: indicator.busy && !indicator.ds.reducedMotion
        running: visible
        palette.highlight: indicator.ds.accent
        Accessible.name: ""
    }

    Rectangle {
        objectName: "motionStaticRing"
        anchors.fill: parent
        visible: indicator.busy && indicator.ds.reducedMotion
        radius: width / 2
        color: "transparent"
        border.width: 2
        border.color: indicator.ds.lineStrong
    }

    Rectangle {
        objectName: "motionStaticDot"
        width: Math.max(4, Math.round(Math.min(parent.width, parent.height) / 5))
        height: width
        anchors.horizontalCenter: parent.horizontalCenter
        y: Math.max(0, Math.round((parent.height - height) / 2 - parent.height * 0.34))
        visible: indicator.busy && indicator.ds.reducedMotion
        radius: width / 2
        color: indicator.ds.accent
    }
}
