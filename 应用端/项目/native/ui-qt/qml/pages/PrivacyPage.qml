import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"

Item {
    property QtObject ds
    id: privacyPage
    objectName: "privacyPageRoot"

    ScrollView {
        anchors.fill: parent
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
        ColumnLayout {
            width: parent.width - ds.s16
            spacing: ds.s16
            RowLayout {
                Layout.fillWidth: true
                Text { text: "数据与隐私"; color: ds.ink; font.family: ds.ui; font.pixelSize: 24; font.weight: Font.DemiBold }
                Item { Layout.fillWidth: true }
                QuietButton {
                    ds: privacyPage.ds
                    objectName: "privacyProfileLink"
                    label: "个人中心"
                    onClicked: uiShell.selectPage("账户")
                }
                QuietButton {
                    ds: privacyPage.ds
                    objectName: "privacySecurityLink"
                    label: "账户安全"
                    onClicked: uiShell.selectPage("账户安全")
                }
            }
            Text {
                Layout.fillWidth: true
                text: "查看本地学习数据的保存位置，并通过显式操作导出或导入备份。账户资料和真实用户数据不会被页面自动清理。"
                color: ds.muted
                font.family: ds.ui
                font.pixelSize: 13
                wrapMode: Text.WordWrap
            }
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: actionCol.implicitHeight + ds.s32
                radius: ds.radius
                color: ds.panel
                border.color: ds.line
                border.width: 1
                ColumnLayout {
                    id: actionCol
                    anchors.fill: parent
                    anchors.margins: ds.s16
                    spacing: ds.s10
                    Text { text: "账户数据操作"; color: ds.ink; font.family: ds.ui; font.pixelSize: 15; font.weight: Font.DemiBold }
                    Text {
                        Layout.fillWidth: true
                        text: uiShell.hasActiveAccount ? "导出会生成新的备份目录；导入会在选择后执行校验，不会自动覆盖当前账户。" : "登录后才能导出或导入账户数据。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 13
                        wrapMode: Text.WordWrap
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: ds.s8
                        PrimaryButton {
                            ds: privacyPage.ds
                            objectName: "privacyExportButton"
                            label: "导出学习数据"
                            enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                            onClicked: uiShell.requestDataAction("backup")
                        }
                        QuietButton {
                            ds: privacyPage.ds
                            objectName: "privacyImportButton"
                            label: "导入备份"
                            enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                            onClicked: uiShell.requestDataAction("restore")
                        }
                    }
                    Text {
                        Layout.fillWidth: true
                        visible: uiShell.operationStatus !== ""
                        text: uiShell.operationStatus
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                    }
                }
            }
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: notesCol.implicitHeight + ds.s32
                radius: ds.radius
                color: ds.page
                border.color: ds.line
                border.width: 1
                ColumnLayout {
                    id: notesCol
                    anchors.fill: parent
                    anchors.margins: ds.s16
                    spacing: ds.s8
                    Text { text: "数据范围"; color: ds.ink; font.family: ds.ui; font.pixelSize: 15; font.weight: Font.DemiBold }
                    Text { Layout.fillWidth: true; text: "学习进度、复习记录、挑战证据和代码草稿保存在当前账户的数据目录。应用不会上传本机 SDK、凭据或工作区中的其他文件。"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13; wrapMode: Text.WordWrap }
                    Text { Layout.fillWidth: true; text: "账户删除功能尚未开放；当前不会提供误导性的删除成功按钮。"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13; wrapMode: Text.WordWrap }
                }
            }
        }
    }
}
