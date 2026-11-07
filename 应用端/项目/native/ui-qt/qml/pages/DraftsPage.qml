import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"

Item {
    property var hostRoot
    property QtObject ds
        id: draftsPage

        ColumnLayout {
            anchors.fill: parent
            spacing: ds.s28   // root gap clamp(20px, 2.4vw, 28px)

            Rectangle {
                Layout.fillWidth: true
                visible: hostRoot.isErrorStatus(uiShell.contentStatus)
                implicitHeight: draftStatusRow.implicitHeight + ds.s16
                radius: ds.radiusSm
                color: ds.bannerBg
                border.color: ds.warning
                RowLayout {
                    id: draftStatusRow
                    anchors.fill: parent
                    anchors.margins: ds.s8
                    Text {
                        Layout.fillWidth: true
                        text: uiShell.contentStatus
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                    }
                    QuietButton {
                                ds: draftsPage.ds
                        label: "重试保存"
                        enabled: uiShell.hasSelectedContent && !uiShell.draftSaving
                        onClicked: uiShell.saveDraft()
                    }
                    QuietButton {
                        ds: draftsPage.ds
                        label: "知道了"
                        onClicked: uiShell.dismissContentStatus()
                    }
                }
            }

            // .module-heading.project-overview
            RowLayout {
                Layout.fillWidth: true
                Layout.bottomMargin: 0
                spacing: ds.s32
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0
                    // .eyebrow — 7px HOLLOW ring here, 13px mono label
                    RowLayout {
                        spacing: ds.s10
                        Rectangle {
                            implicitWidth: 7
                            implicitHeight: 7
                            radius: 4
                            color: "transparent"
                            border.color: ds.accent
                            border.width: 1
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Text {
                            text: "我的练习项目"
                            color: ds.muted
                            font.family: ds.mono
                            font.pixelSize: 13
                            font.letterSpacing: 3.1
                            font.capitalization: Font.AllUppercase
                            Layout.alignment: Qt.AlignVCenter
                        }
                    }
                    Text {
                        Layout.topMargin: ds.s6
                        Layout.bottomMargin: ds.s8
                        text: "代码草稿"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 24
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.5
                        lineHeight: 1.4
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "保存你的练习代码，随时回来继续。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 14
                        lineHeight: 1.6
                        elide: Text.ElideRight
                    }
                }

                // .project-create
                RowLayout {
                    spacing: ds.s10
                    Layout.alignment: Qt.AlignBottom
                    ColumnLayout {
                        spacing: ds.s6
                        Text {
                            text: "新项目语言"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.letterSpacing: 0.8
                        }
                        Rectangle {   // .setting-select
                            implicitWidth: 148
                            implicitHeight: 44
                            radius: ds.radiusSm
                            color: ds.inset
                            border.color: ds.lineStrong
                            border.width: 1
                            RowLayout {
                                anchors { fill: parent; leftMargin: ds.s12; rightMargin: ds.s12 }
                                spacing: ds.s6
                                Text {
                                    Layout.fillWidth: true
                                    text: uiShell.starterLanguage !== ""
                                          ? uiShell.starterLanguage : "python"
                                    color: ds.ink
                                    font.family: ds.mono
                                    font.pixelSize: 14
                                    elide: Text.ElideRight
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Text {
                                    text: "▾"
                                    color: ds.faint
                                    font.family: ds.ui
                                    font.pixelSize: 11
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                            Accessible.role: Accessible.ComboBox
                            Accessible.name: "新项目语言"
                        }
                    }
                    // .project-create .primary-action — outlined pill (0,3,0 wins)
                    Rectangle {
                        id: newProjectBtn
                        implicitWidth: npLabel.implicitWidth + 40
                        implicitHeight: 44
                        radius: 100
                        color: npHover.hovered ? ds.accentFill : "transparent"
                        border.color: ds.accent
                        border.width: 1
                        Layout.alignment: Qt.AlignBottom
                        Text {
                            id: npLabel
                            anchors.centerIn: parent
                            text: "新建项目"
                            color: ds.ink
                            font.family: ds.mono
                            font.pixelSize: 14
                            font.weight: Font.DemiBold
                            font.letterSpacing: 0.26
                        }
                        HoverHandler { id: npHover; cursorShape: Qt.PointingHandCursor }
                        TapHandler { onTapped: uiShell.selectPage("编辑器") }
                        Accessible.role: Accessible.Button
                        Accessible.name: "新建项目"
                    }
                }
            }

            // heading hairline
            Rectangle {
                Layout.fillWidth: true
                Layout.topMargin: ds.s0
                height: 1
                color: ds.line
            }

            // .projects-layout — minmax(220px,300px) + 1fr
            RowLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: ds.s24

                // .project-list-column
                ColumnLayout {
                    Layout.minimumWidth: 220
                    Layout.maximumWidth: 300
                    Layout.preferredWidth: 300
                    Layout.fillHeight: true
                    spacing: ds.s10

                    // .projects-section-title — count on the right
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.bottomMargin: ds.s8
                        spacing: ds.s10
                        Text {
                            Layout.fillWidth: true
                            text: "项目清单"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.letterSpacing: 2.6
                            font.capitalization: Font.AllUppercase
                        }
                        Text {
                            text: uiShell.hasSelectedContent ? "01 个" : "00 个"
                            color: "#7a828f"
                            font.family: ds.ui
                            font.pixelSize: 13
                        }
                    }
                    Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }

                    // .project-card — real draft, when a course is open
                    Rectangle {
                        id: projectCard
                        Layout.fillWidth: true
                        implicitHeight: 72
                        visible: uiShell.hasSelectedContent
                        radius: ds.radius
                        // 静止态: 透明背景
                        // 悬停态: 遮光层底色 rgba(220, 233, 251, 0.028)
                        // 选中态: 遮光层二档 rgba(220, 233, 251, 0.055)
                        color: draftHover.hovered ? Qt.rgba(220/255, 233/255, 251/255, 0.055)
                                                  : "transparent"
                        border.color: ds.line
                        border.width: 1

                        // 平滑过渡（150ms）
                        Behavior on color {
                            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                        }

                        // 悬停/选中左条（与 dirty 状态解耦）
                        // 悬停态: 2px accent 左条
                        // 选中态: 3px accent 左条（这里暂时按悬停显示，选中需要额外状态）
                        Rectangle {
                            anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
                            width: draftHover.hovered ? 2 : 0
                            color: ds.accent
                            Behavior on width {
                                NumberAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                            }
                        }

                        // 近距发光（选中态 - 这里暂时不启用，因为没有明确的选中状态）
                        // layer.enabled: selected && (ds.useLayerEffects !== false)
                        // layer.effect: Glow { ... }

                        RowLayout {
                            anchors { fill: parent; leftMargin: ds.s12; rightMargin: ds.s12 }
                            spacing: ds.s10
                            Text {   // .project-card-no
                                text: "01"
                                color: ds.accent
                                font.family: ds.ui
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                                font.letterSpacing: 1.8
                                Layout.alignment: Qt.AlignTop
                                Layout.topMargin: ds.s6
                            }
                            Rectangle {   // .project-icon — 28px square, radius 0
                                implicitWidth: 28
                                implicitHeight: 28
                                radius: 0
                                color: "transparent"
                                border.color: ds.line
                                border.width: 1
                                Layout.alignment: Qt.AlignVCenter
                                Text {
                                    anchors.centerIn: parent
                                    text: "<>"
                                    color: "#7a828f"
                                    font.family: ds.mono
                                    font.pixelSize: 10
                                }
                            }
                            ColumnLayout {   // .project-card-body
                                Layout.fillWidth: true
                                spacing: ds.s4
                                Text {
                                    Layout.fillWidth: true
                                    text: uiShell.documentId || "未命名草稿"
                                    color: ds.ink
                                    font.family: ds.ui
                                    font.pixelSize: 14
                                    font.weight: Font.DemiBold
                                    lineHeight: 1.5
                                    elide: Text.ElideRight
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: (uiShell.starterLanguage || "—") + " · "
                                          + (uiShell.draftDirty ? "有未保存改动" : "已保存")
                                    color: ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                    font.letterSpacing: 0.5
                                    elide: Text.ElideRight
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: "revision " + uiShell.draftRevision
                                    color: "#7a828f"
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                    elide: Text.ElideRight
                                }
                            }
                        }
                        HoverHandler { id: draftHover; cursorShape: Qt.PointingHandCursor }
                        TapHandler { onTapped: uiShell.selectPage("编辑器") }
                    }

                    // .empty-state — dashed border, radius 8
                    Rectangle {
                        Layout.fillWidth: true
                        implicitHeight: emptyCol.implicitHeight + ds.s32
                        visible: !uiShell.hasSelectedContent
                        radius: ds.radius
                        color: "transparent"
                        border.color: ds.lineStrong
                        border.width: 1
                        ColumnLayout {
                            id: emptyCol
                            anchors { fill: parent; margins: ds.s16 }
                            spacing: ds.s8
                            Text {
                                text: "<>"
                                color: "#7a828f"
                                font.family: ds.mono
                                font.pixelSize: 22
                                Layout.alignment: Qt.AlignLeft
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "还没有保存的项目"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 14
                                font.weight: Font.DemiBold
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "创建第一个项目开始练习"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                lineHeight: 1.6
                                wrapMode: Text.WordWrap
                            }
                        }
                    }

                    Item { Layout.fillHeight: true }
                }

                // .project-detail — bordered panel, transparent fill
                Rectangle {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    radius: ds.radius
                    color: "transparent"
                    border.color: ds.line
                    border.width: 1

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: ds.s20
                        spacing: ds.s16

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s12
                            Text {
                                Layout.fillWidth: true
                                text: uiShell.hasSelectedContent
                                      ? (uiShell.documentId || "未命名草稿")
                                      : "未选择草稿"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 16
                                font.weight: Font.DemiBold
                                elide: Text.ElideRight
                            }
                            QuietButton {
                                ds: draftsPage.ds
                                implicitHeight: 32
                                label: "复制"
                                enabled: false
                            }
                            QuietButton {
                                ds: draftsPage.ds
                                implicitHeight: 32
                                label: "删除"
                                enabled: false
                            }
                        }

                        Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }

                        // .project-zone--draft
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s10
                            Text {
                                text: "01"
                                color: ds.accent
                                font.family: ds.ui
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                                font.letterSpacing: 1.8
                                Layout.alignment: Qt.AlignVCenter
                            }
                            Text {
                                text: "本机草稿"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 14
                                font.weight: Font.DemiBold
                                Layout.alignment: Qt.AlignVCenter
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "改动即时写入本机 · 未快照前回不到旧版本"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                                elide: Text.ElideRight
                                Layout.alignment: Qt.AlignVCenter
                            }
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            color: ds.editorBg
                            border.color: ds.line
                            border.width: 1
                            ScrollView {
                                anchors.fill: parent
                                anchors.margins: ds.s12
                                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                                TextArea {
                                    text: uiShell.draftCode
                                    readOnly: true
                                    wrapMode: TextArea.Wrap
                                    color: ds.muted
                                    font.family: ds.mono
                                    font.pixelSize: 12
                                    background: null
                                    placeholderText: "选择一门课程后可在此预览草稿"
                                    placeholderTextColor: ds.faint
                                    Accessible.name: "草稿预览"
                                }
                            }
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s10
                            Text {
                                Layout.fillWidth: true
                                text: "保存状态：" + (uiShell.draftSaving ? "保存中…"
                                      : (uiShell.draftDirty ? "未保存" : "已保存"))
                                      + " · revision " + uiShell.draftRevision
                                      + " / saved " + uiShell.savedRevision
                                color: uiShell.draftDirty ? ds.warning : ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                                elide: Text.ElideRight
                            }
                            QuietButton {
                                ds: draftsPage.ds
                                implicitHeight: 32
                                label: "保存检查点"
                                enabled: uiShell.hasSelectedContent
                                         && !uiShell.draftPersistenceBlocked
                                onClicked: uiShell.saveDraft()
                            }
                            QuietButton {
                                ds: draftsPage.ds
                                implicitHeight: 32
                                label: "打开工作台"
                                enabled: uiShell.hasSelectedContent
                                onClicked: uiShell.selectPage("编辑器")
                            }
                        }
                    }
                }
            }
        }
    }
