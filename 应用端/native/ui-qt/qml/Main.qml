import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: root
    width: 1280
    height: 820
    color: theme.canvas

    QtObject {
        id: themeObject
        readonly property color canvas: "#080d13"
        readonly property color sidebar: "#0d151f"
        readonly property color panel: "#111c28"
        readonly property color panelRaised: "#192a3b"
        readonly property color border: "#263c50"
        readonly property color accent: "#36d7ff"
        readonly property color accentDim: "#1b7f9a"
        readonly property color text: "#e7f6ff"
        readonly property color muted: "#8ca5b3"
        readonly property color success: "#70e1a1"
        readonly property color warning: "#ffd166"
    }
    property QtObject theme: themeObject

    RowLayout {
        anchors.fill: parent
        spacing: 0

        Rectangle {
            Layout.preferredWidth: 238
            Layout.fillHeight: true
            color: theme.sidebar
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 18
                spacing: 12
                Label { text: uiShell.appTitle; color: theme.text; font.pixelSize: 25; font.bold: true }
                Label { text: "原生应用端"; color: theme.accent; font.pixelSize: 12 }
                Rectangle { Layout.fillWidth: true; height: 1; color: theme.border }
                Repeater {
                    model: ["学习", "编辑器", "运行记录", "账户"]
                    delegate: Button {
                        required property string modelData
                        Layout.fillWidth: true
                        text: modelData
                        highlighted: uiShell.currentPage === modelData
                        onClicked: uiShell.selectPage(modelData)
                    }
                }
                Item { Layout.fillHeight: true }
                Label {
                    Layout.fillWidth: true
                    text: uiShell.hasActiveAccount ? "● " + uiShell.accountName : "○ 访客模式"
                    color: uiShell.hasActiveAccount ? theme.success : theme.muted
                    elide: Text.ElideRight
                }
                Label { text: "无服务器 · 无端口"; color: theme.muted; font.pixelSize: 11 }
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: theme.canvas
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 24
                spacing: 14

                RowLayout {
                    Layout.fillWidth: true
                    Label { text: uiShell.currentPage; color: theme.text; font.pixelSize: 28; font.bold: true }
                    Item { Layout.fillWidth: true }
                    Label { text: uiShell.contentBusy ? "同步中…" : uiShell.contentStatus; color: theme.muted; elide: Text.ElideRight }
                }
                Rectangle { Layout.fillWidth: true; height: 1; color: theme.border }
                Label {
                    Layout.fillWidth: true
                    text: uiShell.operationStatus.length > 0 ? uiShell.operationStatus : uiShell.accountStatus
                    color: theme.accent
                    wrapMode: Text.WordWrap
                }

                StackLayout {
                    id: pages
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    currentIndex: Math.max(0, ["学习", "编辑器", "运行记录", "账户"].indexOf(uiShell.currentPage))

                    Item {
                        ColumnLayout {
                            anchors.fill: parent
                            spacing: 12
                            RowLayout {
                                Layout.fillWidth: true
                                Label { text: "课程目录"; color: theme.text; font.pixelSize: 18; font.bold: true }
                                Item { Layout.fillWidth: true }
                                Button { text: uiShell.contentBusy ? "读取中…" : "重新读取"; enabled: !uiShell.contentBusy; onClicked: uiShell.reloadPublishedContent() }
                            }
                            RowLayout {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                Rectangle {
                                    Layout.preferredWidth: 300; Layout.fillHeight: true; color: theme.panel; border.color: theme.border
                                    ScrollView {
                                        anchors.fill: parent; anchors.margins: 10
                                        ListView {
                                            model: uiShell.publishedTitles
                                            spacing: 6
                                            delegate: Button {
                                                required property string modelData
                                                required property int index
                                                width: ListView.view.width
                                                text: modelData
                                                onClicked: uiShell.openPublishedContent(index)
                                            }
                                        }
                                    }
                                }
                                Rectangle {
                                    Layout.fillWidth: true; Layout.fillHeight: true; color: theme.panel; border.color: theme.border
                                    ColumnLayout {
                                        anchors.fill: parent; anchors.margins: 16; spacing: 10
                                        Label { text: uiShell.hasSelectedContent ? uiShell.documentId : "选择课程"; color: theme.accent; font.bold: true }
                                        ScrollView {
                                            Layout.fillWidth: true; Layout.fillHeight: true
                                            TextArea { text: uiShell.selectedContentBody; readOnly: true; wrapMode: TextArea.Wrap; color: theme.text; Accessible.name: "课程正文"; background: Rectangle { color: theme.panelRaised } placeholderText: "选择课程查看正文" }
                                        }
                                        RowLayout {
                                            Layout.fillWidth: true
                                            Button { text: "读取起始代码"; enabled: uiShell.hasSelectedContent && !uiShell.contentBusy; onClicked: uiShell.loadStarterCode() }
                                            Button { text: "读取提示"; enabled: uiShell.hasSelectedContent && !uiShell.contentBusy && !uiShell.operationBusy; onClicked: uiShell.loadHints() }
                                            Item { Layout.fillWidth: true }
                                        }
                                        TextArea { Layout.fillWidth: true; Layout.preferredHeight: 90; text: uiShell.hints; readOnly: true; color: theme.muted; wrapMode: TextArea.Wrap; Accessible.name: "课程提示"; background: Rectangle { color: theme.canvas } placeholderText: "提示会显示在这里" }
                                    }
                                }
                            }
                        }
                    }

                    Item {
                        ColumnLayout {
                            anchors.fill: parent; spacing: 10
                            RowLayout {
                                Layout.fillWidth: true
                                Label { text: uiShell.documentId.length > 0 ? uiShell.documentId : "尚未选择课程"; color: theme.text; font.pixelSize: 18; font.bold: true }
                                Label { text: uiShell.starterLanguage.length > 0 ? uiShell.starterLanguage + " · " + uiShell.executionPolicy : ""; color: theme.accent }
                                Item { Layout.fillWidth: true }
                                Label { text: uiShell.draftDirty ? "未保存" : "已保存"; color: uiShell.draftDirty ? theme.warning : theme.success }
                            }
                            Rectangle {
                                Layout.fillWidth: true; Layout.fillHeight: true; color: "#091018"; border.color: theme.border
                                TextArea {
                                    id: editorArea
                                    anchors.fill: parent; anchors.margins: 12
                                    text: uiShell.draftCode
                                    readOnly: uiShell.starterLanguage.length === 0 || uiShell.contentBusy || uiShell.draftPersistenceBlocked
                                    wrapMode: TextArea.NoWrap
                                    color: theme.text; selectionColor: theme.accentDim
                                    font.family: "Cascadia Mono"; font.pixelSize: 14
                                    Accessible.name: "代码编辑器"
                                    background: null
                                    placeholderText: "读取起始代码后开始编辑"
                                    onTextChanged: if (activeFocus) uiShell.updateDraftCode(text)
                                }
                            }
                            RowLayout {
                                Layout.fillWidth: true
                                Button { text: uiShell.draftSaving ? "保存中…" : "保存草稿"; enabled: uiShell.hasActiveAccount && uiShell.draftDirty && !uiShell.contentBusy && !uiShell.draftSaving && !uiShell.draftPersistenceBlocked; onClicked: uiShell.saveDraft() }
                                Button { text: "撤销未保存"; enabled: uiShell.draftDirty && !uiShell.draftSaving; onClicked: uiShell.discardDraftChanges() }
                                Button { text: "恢复起始代码"; enabled: uiShell.starterLanguage.length > 0 && !uiShell.draftSaving; onClicked: uiShell.resetDraftCode() }
                                Item { Layout.fillWidth: true }
                                Button { text: uiShell.executionBusy ? "取消" : "运行"; enabled: uiShell.hasActiveAccount && uiShell.starterLanguage.length > 0 && !uiShell.contentBusy && !uiShell.operationBusy; onClicked: uiShell.executionBusy ? uiShell.cancelExecution() : uiShell.runCode() }
                                Button { text: "暂停"; enabled: uiShell.executionBusy && !uiShell.executionPaused; onClicked: uiShell.pauseExecution() }
                                Button { text: "继续"; enabled: uiShell.executionBusy && uiShell.executionPaused; onClicked: uiShell.resumeExecution() }
                                Button { text: "单步"; enabled: uiShell.executionBusy && uiShell.executionPaused; onClicked: uiShell.stepExecution() }
                            }
                        }
                    }

                    Item {
                        ColumnLayout {
                            anchors.fill: parent; spacing: 12
                            Label { text: "运行记录"; color: theme.text; font.pixelSize: 18; font.bold: true }
                            Rectangle {
                                Layout.fillWidth: true; Layout.fillHeight: true; color: theme.panel; border.color: theme.border
                                ScrollView { anchors.fill: parent; anchors.margins: 14; TextArea { text: uiShell.executionOutput.length > 0 ? uiShell.executionOutput : "暂无运行输出"; readOnly: true; color: theme.text; wrapMode: TextArea.Wrap; Accessible.name: "程序运行输出"; background: null } }
                            }
                            Label { Layout.fillWidth: true; text: uiShell.executionBusy ? (uiShell.executionPaused ? "状态：已暂停" : "状态：运行中") : "状态：已结束"; color: uiShell.executionPaused ? theme.warning : theme.muted }
                        }
                    }

                    Item {
                        ColumnLayout {
                            anchors.fill: parent; spacing: 12
                            Label { text: "账户与本地数据"; color: theme.text; font.pixelSize: 18; font.bold: true }
                            Rectangle {
                                Layout.fillWidth: true; Layout.preferredHeight: 260; color: theme.panel; border.color: theme.border
                                GridLayout {
                                    anchors.fill: parent; anchors.margins: 18; columns: 2; rowSpacing: 12; columnSpacing: 12
                                    Label { text: "状态"; color: theme.muted }
                                    Label { text: uiShell.hasActiveAccount ? "已登录：" + uiShell.accountName : "访客模式"; color: theme.text }
                                    Label { text: "标识"; color: theme.muted }
                                    Label { text: uiShell.activeAccountId.length > 0 ? uiShell.activeAccountId : "未登录"; color: theme.text; elide: Text.ElideRight }
                                    Label { text: "数据策略"; color: theme.muted }
                                    Label { text: "本机账户目录 · 不使用端口"; color: theme.text }
                                    Item { Layout.columnSpan: 2; Layout.fillHeight: true }
                                }
                            }
                            RowLayout {
                                Layout.fillWidth: true
                                TextField { id: nameField; Layout.preferredWidth: 150; visible: !uiShell.hasActiveAccount; placeholderText: "名称"; Accessible.name: "账户名称" }
                                TextField { id: idField; Layout.preferredWidth: 220; visible: !uiShell.hasActiveAccount; placeholderText: "邮箱或手机号"; Accessible.name: "邮箱或手机号" }
                                TextField { id: passwordField; Layout.preferredWidth: 180; visible: !uiShell.hasActiveAccount; placeholderText: "密码"; echoMode: TextInput.Password; Accessible.name: "账户密码" }
                                Button { text: "登录"; visible: !uiShell.hasActiveAccount; enabled: !uiShell.accountBusy; onClicked: uiShell.login(idField.text, passwordField.text) }
                                Button { text: "注册并登录"; visible: !uiShell.hasActiveAccount; enabled: !uiShell.accountBusy; onClicked: uiShell.registerAccount(nameField.text, idField.text, passwordField.text) }
                                Button { text: "退出登录"; visible: uiShell.hasActiveAccount; enabled: !uiShell.accountBusy && !uiShell.draftSaving; onClicked: uiShell.logout() }
                            }
                            Label { Layout.fillWidth: true; text: uiShell.accountStatus; color: theme.muted; wrapMode: Text.WordWrap }
                        }
                    }
                }
            }
        }
    }
}
