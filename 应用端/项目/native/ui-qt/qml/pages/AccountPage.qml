import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"

Item {
    property var hostRoot
    property QtObject ds
    id: accountPage
    objectName: "profilePageRoot"

    Component.onCompleted: {
        if (uiShell.hasActiveAccount) uiShell.refreshReviewSummary();
    }

    Connections {
        target: uiShell
        function onAccountChanged() {
            pwField.text = "";
            identField.text = "";
            nameField.text = "";
        }
    }

    ScrollView {
        objectName: "accountScrollView"
        anchors.fill: parent
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
        ColumnLayout {
            // Use the page width because ScrollView reparents this column.
            width: accountPage.width - ds.s16
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

            Rectangle {
                objectName: "accountLoginIntro"
                visible: !uiShell.hasActiveAccount
                Layout.fillWidth: true
                implicitHeight: introCol.implicitHeight + ds.s32
                radius: ds.radius
                color: ds.panel
                border.color: ds.accentRing
                border.width: 1
                ColumnLayout {
                    id: introCol
                    anchors.fill: parent
                    anchors.margins: ds.s16
                    spacing: ds.s8
                    Text { text: "开始你的学习空间"; color: ds.ink; font.family: ds.ui; font.pixelSize: 16; font.weight: Font.DemiBold }
                    Text {
                        Layout.fillWidth: true
                        text: "登录或注册后，你可以在本机保存代码草稿、记录执行证据，并继续复习已学课程。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 13
                        wrapMode: Text.WordWrap
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: ds.s12
                        Text { text: "01"; color: ds.accent; font.family: ds.mono; font.pixelSize: 12 }
                        Text { Layout.fillWidth: true; text: "从课程原文与起始代码开始练习。"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap }
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: ds.s12
                        Text { text: "02"; color: ds.accent; font.family: ds.mono; font.pixelSize: 12 }
                        Text { Layout.fillWidth: true; text: "保存每次尝试，回到复习中心继续巩固。"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap }
                    }
                }
            }

            // Auth form
            Rectangle {
                visible: !uiShell.hasActiveAccount
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
                        text: "登录你的工作区"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 15
                        font.weight: Font.DemiBold
                    }
                    ShellField {
                        id: identField
                        ds: accountPage.ds
                        Layout.fillWidth: true
                        visible: !uiShell.hasActiveAccount
                        placeholderText: "邮箱或手机号"
                    }
                    ShellField {
                        id: nameField
                        ds: accountPage.ds
                        Layout.fillWidth: true
                        visible: !uiShell.hasActiveAccount
                        placeholderText: "你的昵称（注册时填写）"
                    }
                    ShellField {
                        id: pwField
                        ds: accountPage.ds
                        Layout.fillWidth: true
                        placeholderText: "至少 8 个字符"
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
                    }
                }
            }

            ColumnLayout {
                visible: uiShell.hasActiveAccount
                Layout.fillWidth: true
                spacing: ds.s16
                Text {
                    text: "学习概览"
                    color: ds.ink
                    font.family: ds.ui
                    font.pixelSize: 15
                    font.weight: Font.DemiBold
                }
                RowLayout {
                    Layout.fillWidth: true
                    spacing: ds.s24
                    Repeater {
                        model: [
                            { label: "已完成单元", key: "completedUnits" },
                            { label: "挑战通过", key: "verifiedPasses" },
                            { label: "待复测", key: "reviewDueCount" }
                        ]
                        delegate: ColumnLayout {
                            required property var modelData
                            Layout.fillWidth: true
                            spacing: ds.s6
                            Text {
                                text: uiShell.analysisSnapshot[modelData.key] === undefined
                                      ? "暂无数据" : String(uiShell.analysisSnapshot[modelData.key])
                                color: ds.ink
                                font.family: ds.mono
                                font.pixelSize: 20
                            }
                            Text { text: modelData.label; color: ds.muted; font.family: ds.ui; font.pixelSize: 12 }
                        }
                    }
                    QuietButton {
                        ds: accountPage.ds
                        label: "去复习中心"
                        onClicked: { uiShell.selectPage("复习与进度"); uiShell.refreshReviewSummary(); }
                    }
                }
                Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: ds.line }
                VaultWritebackPanel {
                    Layout.fillWidth: true
                    ds: accountPage.ds
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: ds.s10
                    Text {
                        text: "个人资料"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 15
                        font.weight: Font.DemiBold
                    }
                    ShellField {
                        ds: accountPage.ds
                        Layout.fillWidth: true
                        text: uiShell.accountName
                        readOnly: true
                        Accessible.name: "当前昵称"
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "当前版本暂不支持修改昵称与个人简介。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                    }
                    QuietButton { ds: accountPage.ds; label: "保存资料（待接入）"; enabled: false }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: ds.s8
                        QuietButton {
                            ds: accountPage.ds
                            objectName: "profileSecurityLink"
                            label: "账户安全"
                            onClicked: uiShell.selectPage("账户安全")
                        }
                        QuietButton {
                            ds: accountPage.ds
                            objectName: "profilePrivacyLink"
                            label: "数据与隐私"
                            onClicked: uiShell.selectPage("数据与隐私")
                        }
                        QuietButton {
                            ds: accountPage.ds
                            label: "退出登录"
                            enabled: !uiShell.accountBusy
                            onClicked: uiShell.logout()
                        }
                    }
                }
            }
        }
    }
}
