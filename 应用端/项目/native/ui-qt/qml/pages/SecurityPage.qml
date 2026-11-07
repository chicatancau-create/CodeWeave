import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"

Item {
    property QtObject ds
    id: securityPage
    objectName: "securityPageRoot"

    ScrollView {
        anchors.fill: parent
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
        ColumnLayout {
            width: parent.width - ds.s16
            spacing: ds.s16

            RowLayout {
                Layout.fillWidth: true
                Text {
                    text: "账户安全"
                    color: ds.ink
                    font.family: ds.ui
                    font.pixelSize: 24
                    font.weight: Font.DemiBold
                }
                Item { Layout.fillWidth: true }
                QuietButton {
                    ds: securityPage.ds
                    objectName: "securityProfileLink"
                    label: "个人中心"
                    onClicked: uiShell.selectPage("账户")
                }
                QuietButton {
                    ds: securityPage.ds
                    objectName: "securityPrivacyLink"
                    label: "数据与隐私"
                    onClicked: uiShell.selectPage("数据与隐私")
                }
                QuietButton {
                    ds: securityPage.ds
                    label: "退出当前设备"
                    enabled: uiShell.hasActiveAccount && !uiShell.accountBusy
                    onClicked: uiShell.logout()
                }
            }
            Text {
                Layout.fillWidth: true
                text: "管理登录凭证与设备会话。没有接入的能力会明确标记，不伪造成功状态。"
                color: ds.muted
                font.family: ds.ui
                font.pixelSize: 13
                wrapMode: Text.WordWrap
            }

            Rectangle {
                Layout.fillWidth: true
                implicitHeight: loginCol.implicitHeight + ds.s32
                radius: ds.radius
                color: ds.panel
                border.color: ds.line
                border.width: 1
                ColumnLayout {
                    id: loginCol
                    anchors.fill: parent
                    anchors.margins: ds.s16
                    spacing: ds.s10
                    Text { text: "当前登录方式"; color: ds.ink; font.family: ds.ui; font.pixelSize: 15; font.weight: Font.DemiBold }
                    Text {
                        Layout.fillWidth: true
                        text: uiShell.hasActiveAccount ? uiShell.activeAccountId : "当前为访客模式"
                        color: ds.muted
                        font.family: ds.mono
                        font.pixelSize: 13
                        wrapMode: Text.WordWrap
                    }
                    Text { text: "会话说明"; color: ds.ink; font.family: ds.ui; font.pixelSize: 15; font.weight: Font.DemiBold }
                    Text {
                        Layout.fillWidth: true
                        text: "本地账户会话保存在应用进程中；服务重启后需要重新登录。修改密码后，其他设备会话立即失效。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 13
                        wrapMode: Text.WordWrap
                    }
                }
            }

            Rectangle {
                Layout.fillWidth: true
                implicitHeight: passwordCol.implicitHeight + ds.s32
                radius: ds.radius
                color: ds.page
                border.color: ds.line
                border.width: 1
                ColumnLayout {
                    id: passwordCol
                    anchors.fill: parent
                    anchors.margins: ds.s16
                    spacing: ds.s10
                    Text { text: "修改密码"; color: ds.ink; font.family: ds.ui; font.pixelSize: 15; font.weight: Font.DemiBold }
                    ShellField { id: currentPassword; objectName: "securityCurrentPassword"; ds: securityPage.ds; Layout.fillWidth: true; placeholderText: "当前密码"; echoMode: TextInput.Password }
                    ShellField { id: newPassword; objectName: "securityNewPassword"; ds: securityPage.ds; Layout.fillWidth: true; placeholderText: "新密码（至少 8 个字符）"; echoMode: TextInput.Password }
                    ShellField { id: confirmPassword; objectName: "securityConfirmPassword"; ds: securityPage.ds; Layout.fillWidth: true; placeholderText: "确认新密码"; echoMode: TextInput.Password }
                    Text {
                        Layout.fillWidth: true
                        visible: !uiShell.hasActiveAccount || currentPassword.text === "" ||
                                 newPassword.text === "" || confirmPassword.text === "" ||
                                 newPassword.text !== confirmPassword.text
                        text: !uiShell.hasActiveAccount ? "请先登录后再修改密码。"
                              : (newPassword.text !== "" && confirmPassword.text !== "" &&
                                 newPassword.text !== confirmPassword.text
                                 ? "两次输入的新密码不一致。"
                                 : "填写当前密码、新密码和确认密码后才可提交。")
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        Text { Layout.fillWidth: true; text: uiShell.accountStatus; visible: uiShell.accountStatus !== ""; color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap }
                        PrimaryButton {
                            ds: securityPage.ds
                            objectName: "securityPasswordButton"
                            label: uiShell.accountBusy ? "提交中…" : "修改密码"
                            enabled: uiShell.hasActiveAccount && !uiShell.accountBusy && currentPassword.text !== "" &&
                                     newPassword.text.length >= 8 && newPassword.text.length <= 128 &&
                                     newPassword.text === confirmPassword.text
                            onClicked: uiShell.changePassword(currentPassword.text, newPassword.text)
                        }
                    }
                }
            }

            Rectangle {
                Layout.fillWidth: true
                implicitHeight: dangerCol.implicitHeight + ds.s32
                radius: ds.radius
                color: ds.page
                border.color: ds.danger
                border.width: 1
                ColumnLayout {
                    id: dangerCol
                    anchors.fill: parent
                    anchors.margins: ds.s16
                    spacing: ds.s8
                    Text { text: "删除账户"; color: ds.danger; font.family: ds.ui; font.pixelSize: 15; font.weight: Font.DemiBold }
                    Text { Layout.fillWidth: true; text: "删除账户会清除服务端账号与学习记录，属于不可逆操作。"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13; wrapMode: Text.WordWrap }
                    QuietButton { ds: securityPage.ds; objectName: "securityDeleteButton"; label: "删除账户（待接入）"; enabled: false; Accessible.name: "删除账户，当前版本待接入" }
                }
            }
        }
    }
}
