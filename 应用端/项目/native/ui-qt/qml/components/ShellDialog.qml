import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Dialog {
    id: dialog
    required property QtObject ds
    property string closeLabel: "关闭"
    modal: true
    focus: true
    padding: ds.s16
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    font.family: ds.ui
    background: Rectangle { color: dialog.ds.overlay; border.color: dialog.ds.lineStrong; radius: dialog.ds.radius }
    header: Label {
        text: dialog.title
        color: dialog.ds.ink
        font.family: dialog.ds.ui
        font.pixelSize: 18
        font.weight: Font.DemiBold
        padding: dialog.ds.s16
        background: Rectangle { color: dialog.ds.overlay }
    }
    footer: Item {
        implicitHeight: closeButton.implicitHeight + dialog.ds.s24
        QuietButton {
            id: closeButton
            objectName: dialog.objectName + "Close"
            ds: dialog.ds
            anchors.right: parent.right
            anchors.rightMargin: dialog.ds.s16
            anchors.verticalCenter: parent.verticalCenter
            label: dialog.closeLabel
            onClicked: dialog.close()
        }
    }
    Connections {
        target: dialog
        function onOpened() { closeButton.forceActiveFocus(Qt.PopupFocusReason); }
    }
}
