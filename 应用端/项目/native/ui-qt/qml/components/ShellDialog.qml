import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Dialog {
    id: dialog
    required property QtObject ds
    property string closeLabel: "关闭"
    property bool referenceStyle: false
    property string eyebrow: ""
    property bool primaryClose: false
    modal: true
    focus: true
    padding: referenceStyle ? ds.modalPadding : ds.s16
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    font.family: ds.ui
    Overlay.modal: Rectangle { color: dialog.ds.modalScrim }
    background: Rectangle { color: dialog.referenceStyle ? dialog.ds.modalSurface : dialog.ds.overlay; border.color: dialog.ds.lineStrong; radius: dialog.referenceStyle ? 0 : dialog.ds.radius }
    header: Item {
        implicitHeight: dialog.referenceStyle ? 100 : 58
        ColumnLayout {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.leftMargin: dialog.referenceStyle ? dialog.ds.modalPadding : dialog.ds.s16
            anchors.rightMargin: dialog.referenceStyle ? 84 : dialog.ds.s16
            anchors.top: parent.top
            anchors.topMargin: dialog.referenceStyle ? dialog.ds.modalPadding : dialog.ds.s16
            spacing: dialog.ds.s6
            Text { visible: dialog.eyebrow.length > 0; text: dialog.eyebrow; color: dialog.ds.muted; font.family: dialog.ds.ui; font.pixelSize: 13 }
            Text { Layout.fillWidth: true; text: dialog.title; color: dialog.ds.ink; font.family: dialog.ds.ui; font.pixelSize: dialog.referenceStyle ? 26 : 18; font.weight: Font.DemiBold; wrapMode: Text.WrapAnywhere }
        }
        IconButton {
            id: headerClose
            objectName: "shellDialogHeaderClose"
            visible: dialog.referenceStyle
            ds: dialog.ds
            implicitWidth: 44; implicitHeight: 44
            radius: 0
            border.width: 1
            border.color: closeHover.hovered ? dialog.ds.lineStrong : dialog.ds.line
            HoverHandler { id: closeHover }
            anchors.right: parent.right; anchors.rightMargin: dialog.ds.modalPadding
            anchors.top: parent.top; anchors.topMargin: dialog.ds.modalPadding
            iconName: "X"; tip: "关闭" + dialog.title
            onClicked: dialog.close()
        }
        Rectangle {
            visible: dialog.referenceStyle
            anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
            anchors.leftMargin: dialog.ds.modalPadding; anchors.rightMargin: dialog.ds.modalPadding
            height: 1; color: dialog.ds.lineRaised
        }
    }
    footer: Item {
        visible: !dialog.referenceStyle || dialog.primaryClose
        implicitHeight: !visible ? 0 : dialog.referenceStyle ? 96 : closeButton.implicitHeight + dialog.ds.s24
        QuietButton {
            id: closeButton
            visible: !dialog.referenceStyle
            objectName: dialog.objectName + "Close"
            ds: dialog.ds
            anchors.right: parent.right
            anchors.rightMargin: dialog.ds.s16
            anchors.verticalCenter: parent.verticalCenter
            label: dialog.closeLabel
            onClicked: dialog.close()
        }
        PrimaryButton {
            id: primaryCloseButton
            objectName: dialog.objectName + "PrimaryClose"
            visible: dialog.referenceStyle && dialog.primaryClose
            ds: dialog.ds
            anchors.left: parent.left; anchors.right: parent.right
            anchors.leftMargin: dialog.ds.modalPadding; anchors.rightMargin: dialog.ds.modalPadding
            anchors.bottom: parent.bottom; anchors.bottomMargin: dialog.ds.modalPadding
            label: dialog.closeLabel
            onClicked: dialog.close()
        }
    }
    Connections {
        target: dialog
        function onOpened() {
            const target = dialog.referenceStyle ? (dialog.primaryClose ? primaryCloseButton : headerClose) : closeButton;
            target.forceActiveFocus(Qt.PopupFocusReason);
        }
    }
}
