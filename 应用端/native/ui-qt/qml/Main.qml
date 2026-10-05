import QtQuick
import QtQuick.Controls

Rectangle {
    id: root
    width: 1180
    height: 720
    color: theme.canvas

    QtObject {
        id: themeObject
        readonly property color canvas: "#0b0f14"
        readonly property color panel: "#111923"
        readonly property color panelRaised: "#182332"
        readonly property color accent: "#36d7ff"
        readonly property color text: "#e7f6ff"
        readonly property color muted: "#8ca5b3"
    }

    property QtObject theme: themeObject

    Row {
        anchors.fill: parent
        spacing: 0

        Rectangle {
            width: 220
            height: parent.height
            color: theme.panel

            Column {
                anchors.fill: parent
                anchors.margins: 20
                spacing: 12

                Label {
                    text: uiShell.appTitle
                    color: theme.text
                    font.pixelSize: 24
                    font.bold: true
                }

                Label {
                    text: "应用端基础壳"
                    color: theme.muted
                    font.pixelSize: 13
                }

                Repeater {
                    model: ["学习", "编辑器", "运行记录", "账户"]
                    delegate: Button {
                        required property string modelData
                        width: 180
                        text: modelData
                        highlighted: uiShell.currentPage === modelData
                        onClicked: uiShell.selectPage(modelData)
                    }
                }
            }
        }

        Rectangle {
            width: parent.width - 220
            height: parent.height
            color: theme.canvas

            Column {
                anchors.fill: parent
                anchors.margins: 32
                spacing: 8

                Label {
                    text: uiShell.currentPage
                    color: theme.text
                    font.pixelSize: 30
                    font.bold: true
                }

                Rectangle {
                    width: parent.width
                    height: 1
                    color: theme.panelRaised
                }

                Label {
                    text: uiShell.hasActiveAccount ? "已登录" : "访客模式 · 草稿暂存内存，登录后可保存"
                    color: theme.muted
                }

                Label {
                    text: uiShell.contentStatus
                    color: theme.muted
                    wrapMode: Text.WordWrap
                    width: parent.width
                }

                Button {
                    text: uiShell.contentBusy ? "读取中…" : "重新读取课程"
                    enabled: !uiShell.contentBusy
                    onClicked: uiShell.reloadPublishedContent()
                }

                Button {
                    text: "读取起始代码"
                    enabled: uiShell.hasSelectedContent && !uiShell.contentBusy
                    onClicked: uiShell.loadStarterCode()
                }

                ScrollView {
                    width: parent.width
                    height: 120
                    Column {
                        Repeater {
                            model: uiShell.publishedTitles
                            delegate: Label {
                                required property string modelData
                                required property int index
                                text: "• " + modelData
                                color: theme.text
                                MouseArea {
                                    anchors.fill: parent
                                    onClicked: uiShell.openPublishedContent(index)
                                }
                            }
                        }

                    }
                }

                ScrollView {
                    width: parent.width
                    height: 120
                    TextArea {
                        text: uiShell.selectedContentBody
                        readOnly: true
                        wrapMode: TextArea.Wrap
                        color: theme.text
                        background: Rectangle { color: theme.panel }
                        placeholderText: "选择一门课程查看正文"
                    }
                }

                Label {
                    text: uiShell.starterLanguage.length > 0
                    ? "编辑器草稿（" + uiShell.starterLanguage + " / " + uiShell.executionPolicy
                    + (uiShell.draftDirty ? "，未保存" : "") + "）"
                    : "尚未读取起始代码"
                    color: theme.muted
                }

                ScrollView {
                    width: parent.width
                    height: 140
                    TextArea {
                        text: uiShell.draftCode
                        readOnly: uiShell.starterLanguage.length === 0 || uiShell.contentBusy || uiShell.draftPersistenceBlocked
                        wrapMode: TextArea.NoWrap
                        color: theme.text
                        background: Rectangle { color: theme.panel }
                        placeholderText: "选择课程后读取起始代码"
                        onTextChanged: if (activeFocus) uiShell.updateDraftCode(text)
                    }
                }

                Row {
                    spacing: 12
                    Button {
                        text: uiShell.draftSaving ? "保存中…" : "保存草稿"
                        enabled: uiShell.hasActiveAccount && uiShell.draftDirty && !uiShell.contentBusy && !uiShell.draftSaving && !uiShell.draftPersistenceBlocked
                        onClicked: uiShell.saveDraft()
                    }
                    Button {
                        text: "放弃未保存修改"
                        enabled: uiShell.draftDirty && !uiShell.contentBusy && !uiShell.draftSaving
                        onClicked: uiShell.discardDraftChanges()
                    }
                    Button {
                        text: "恢复起始代码"
                        enabled: uiShell.starterLanguage.length > 0 && !uiShell.contentBusy && !uiShell.draftSaving && !uiShell.draftPersistenceBlocked
                        onClicked: uiShell.resetDraftCode()
                    }
                }
            }
        }
    }
}
