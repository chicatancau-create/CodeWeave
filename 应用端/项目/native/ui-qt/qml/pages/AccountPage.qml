import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"

Item {
    property var hostRoot
    property QtObject ds
    id: accountPage

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
                            ds: accountPage.ds
                            label: "登录"
                            visible: !uiShell.hasActiveAccount
                            enabled: !uiShell.accountBusy
                            onClicked: uiShell.login(identField.text, pwField.text)
                        }
                        QuietButton {
                            ds: accountPage.ds
                            label: "注册新账户"
                            visible: !uiShell.hasActiveAccount
                            enabled: !uiShell.accountBusy
                            onClicked: uiShell.registerAccount(nameField.text,
                                                               identField.text,
                                                               pwField.text)
                        }
                        PrimaryButton {
                            ds: accountPage.ds
                            label: "修改密码"
                            visible: uiShell.hasActiveAccount
                            enabled: !uiShell.accountBusy
                            onClicked: uiShell.changePassword(pwField.text, newPwField.text)
                        }
                        QuietButton {
                            ds: accountPage.ds
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
                            ds: accountPage.ds
                            label: "导出学习数据"
                            enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                            onClicked: uiShell.requestDataAction("backup")
                        }
                        QuietButton {
                            ds: accountPage.ds
                            label: "导入备份"
                            enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                            onClicked: uiShell.requestDataAction("restore")
                        }
                        QuietButton {
                            ds: accountPage.ds
                            label: "账户安全"
                            enabled: !uiShell.operationBusy
                            onClicked: hostRoot.openPasswordDialog()
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
