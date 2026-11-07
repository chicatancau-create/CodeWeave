import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"

Item {
    objectName: "reviewPageRoot"
    property var hostRoot
    property QtObject ds
        id: reviewPage

        function itemsForGroup(groupKey) {
            return uiShell.reviewItems.filter(function(item) { return item.group === groupKey; });
        }

        function lessonTitle(contentId) {
            const lesson = uiShell.lessonMeta.find(function(item) { return item.id === contentId; });
            return lesson ? lesson.title : contentId;
        }

        ScrollView {
            anchors.fill: parent
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            clip: true

            Rectangle {
                // .cw-review — a bordered, rounded panel (unlike .projects-view)
                width: reviewPage.width
                implicitHeight: reviewCol.implicitHeight + ds.s32 * 2
                color: ds.page
                border.color: ds.line
                border.width: 1
                radius: ds.radius

                ColumnLayout {
                    id: reviewCol
                    anchors {
                        left: parent.left
                        right: parent.right
                        top: parent.top
                        margins: ds.s32
                        rightMargin: 29
                    }
                    spacing: 0

                    // .module-heading
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.bottomMargin: 0
                        spacing: ds.s14
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0
                            RowLayout {
                                spacing: ds.s8
                                Rectangle {   // .eyebrow-dot — 6px FILLED here
                                    implicitWidth: 6
                                    implicitHeight: 6
                                    radius: 3
                                    color: ds.accent
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Text {
                                    text: "复习中心"
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
                                text: "延迟复测"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 24
                                font.weight: Font.DemiBold
                                font.letterSpacing: -0.5
                                lineHeight: 1.4
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "按本机排期：学完后第 1、3、7、14、30 天各一次，共 5 个节点"
                                      + "——按这份节奏回顾已学内容；未通过的复测会降低掌握等级并重新安排。"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                lineHeight: 1.6
                                wrapMode: Text.WordWrap
                            }
                        }
                        // .challenge-stats — the one stat line, bottom-right
                        Text {
                            text: "待复测 " + (uiShell.analysisSnapshot.reviewDueCount === undefined
                                  ? "暂无数据" : uiShell.analysisSnapshot.reviewDueCount)
                                  + " 项 · 未来 7 天 "
                                  + (uiShell.analysisSnapshot.reviewNext7Days === undefined
                                      ? "暂无数据" : uiShell.analysisSnapshot.reviewNext7Days) + " 项"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            Layout.alignment: Qt.AlignBottom
                        }
                    }

                    // .rv-async.rv-empty.rv-async--failed — hairline strip
                    Rectangle {
                        objectName: "reviewContentError"
                        visible: hostRoot.isErrorStatus(uiShell.contentStatus)
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        implicitHeight: asyncCol.implicitHeight + ds.s32
                        color: "transparent"
                        border.color: "transparent"
                        Rectangle {
                            anchors { left: parent.left; right: parent.right; top: parent.top }
                            height: 1
                            color: ds.line
                        }
                        Rectangle {
                            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                            height: 1
                            color: ds.lineStrong
                        }
                        ColumnLayout {
                            id: asyncCol
                            anchors {
                                left: parent.left
                                right: parent.right
                                top: parent.top
                                topMargin: ds.s16
                                rightMargin: ds.s16
                            }
                            spacing: ds.s10
                            Text {
                                Layout.fillWidth: true
                                text: uiShell.contentStatus
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                lineHeight: 1.6
                                wrapMode: Text.WordWrap
                            }
                            QuietButton {
                                ds: reviewPage.ds
                                implicitHeight: 44
                                label: "重试读取"
                                enabled: !uiShell.operationBusy
                                onClicked: uiShell.refreshReviewSummary()
                            }
                            QuietButton {
                                ds: reviewPage.ds
                                label: "知道了"
                                onClicked: uiShell.dismissContentStatus()
                            }
                        }
                    }

                    // .review-center-empty — no scheduled reviews
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        spacing: ds.s10
                        visible: uiShell.reviewSummary === ""
                        Rectangle {
                            implicitWidth: 24
                            implicitHeight: 24
                            radius: 0
                            color: "transparent"
                            Layout.alignment: Qt.AlignLeft
                            Text {
                                anchors.centerIn: parent
                                text: "◷"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 15
                            }
                        }
                        Text {
                            Layout.fillWidth: true
                            text: "当前没有任何计划的复测。完成课程单元后会自动按计划安排。"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 14
                            lineHeight: 1.6
                            wrapMode: Text.WordWrap
                        }
                    }

                    // Records, when the native ledger has any.
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        spacing: 0
                        visible: uiShell.reviewSummary !== ""

                        // .rv-block-heading
                        RowLayout {
                            Layout.fillWidth: true
                            Layout.bottomMargin: ds.s10
                            spacing: ds.s12
                            Text {
                                text: "01"
                                color: ds.accent
                                font.family: ds.ui
                                font.pixelSize: 32
                                font.weight: Font.DemiBold
                                font.letterSpacing: -0.96
                                Layout.alignment: Qt.AlignBaseline
                            }
                            Text {
                                text: "复测记录"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 20
                                font.letterSpacing: -0.4
                                lineHeight: 1.15
                                Layout.alignment: Qt.AlignBaseline
                            }
                            Item { Layout.fillWidth: true }
                            // .rv-mark--today — text only in a heading
                            Text {
                                text: "今日到期"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 13
                                Layout.alignment: Qt.AlignBaseline
                            }
                        }
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.bottomMargin: ds.s16
                            height: 1
                            color: ds.lineRaised
                        }
                    }

                    Repeater {
                        model: [
                            { key: "overdue", label: "逾期复测" },
                            { key: "today", label: "今日到期" },
                            { key: "upcoming", label: "未来 7 天" }
                        ]
                        delegate: ColumnLayout {
                            required property var modelData
                            Layout.fillWidth: true
                            Layout.topMargin: ds.s24
                            spacing: 0

                            RowLayout {
                                Layout.fillWidth: true
                                Layout.bottomMargin: ds.s10
                                Text {
                                    text: modelData.label
                                    color: ds.ink
                                    font.family: ds.ui
                                    font.pixelSize: 18
                                    font.weight: Font.DemiBold
                                }
                                Text {
                                    text: "(" + reviewPage.itemsForGroup(modelData.key).length + ")"
                                    color: ds.muted
                                    font.family: ds.mono
                                    font.pixelSize: 13
                                }
                                Item { Layout.fillWidth: true }
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                Layout.bottomMargin: ds.s6
                                spacing: ds.s10
                                Repeater {
                                    model: ["课程 / 练习", "到期日", "下一节点", "掌握度", "操作"]
                                    delegate: Text {
                                        required property string modelData
                                        Layout.fillWidth: true
                                        text: modelData
                                        color: ds.faint
                                        font.family: ds.ui
                                        font.pixelSize: 12
                                    }
                                }
                            }

                            Repeater {
                                model: reviewPage.itemsForGroup(modelData.key)
                                delegate: ColumnLayout {
                                    required property var modelData
                                    Layout.fillWidth: true
                                    spacing: ds.s6

                                    Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }
                                    RowLayout {
                                        Layout.fillWidth: true
                                        Layout.topMargin: ds.s8
                                        Layout.bottomMargin: ds.s8
                                        spacing: ds.s10
                                        Text {
                                            Layout.fillWidth: true
                                            Layout.preferredWidth: 260
                                            text: reviewPage.lessonTitle(modelData.contentId)
                                                  + " / " + modelData.exerciseId
                                            color: ds.ink
                                            font.family: ds.ui
                                            font.pixelSize: 13
                                            elide: Text.ElideRight
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            Layout.preferredWidth: 110
                                            text: modelData.dueKey || "—"
                                            color: ds.muted
                                            font.family: ds.mono
                                            font.pixelSize: 12
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            Layout.preferredWidth: 110
                                            text: "第 " + (modelData.nextNodeIndex + 1) + " 次"
                                            color: ds.muted
                                            font.family: ds.ui
                                            font.pixelSize: 12
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            Layout.preferredWidth: 90
                                            text: "等级 " + modelData.masteryLevel
                                            color: ds.muted
                                            font.family: ds.ui
                                            font.pixelSize: 12
                                        }
                                        RowLayout {
                                            Layout.fillWidth: true
                                            Layout.preferredWidth: 310
                                            spacing: ds.s4
                                            QuietButton {
                                ds: reviewPage.ds
                                                objectName: "reviewPass-" + modelData.itemId
                                                implicitHeight: 36
                                                label: "通过"
                                                enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                                                onClicked: uiShell.reviewItem(modelData.itemId, true, "")
                                            }
                                            QuietButton {
                                ds: reviewPage.ds
                                                objectName: "reviewSnooze-" + modelData.itemId
                                                implicitHeight: 36
                                                label: "稍后提醒"
                                                enabled: uiShell.hasActiveAccount && !uiShell.operationBusy
                                                onClicked: uiShell.snoozeReview(modelData.itemId)
                                            }
                                            QuietButton {
                                ds: reviewPage.ds
                                                objectName: "reviewOpen-" + modelData.itemId
                                                implicitHeight: 36
                                                label: "查看课程"
                                                enabled: uiShell.publishedIds.indexOf(modelData.contentId) >= 0
                                                onClicked: uiShell.openPublishedContent(
                                                    uiShell.publishedIds.indexOf(modelData.contentId))
                                            }
                                        }
                                    }
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s8
                                visible: reviewPage.itemsForGroup(modelData.key).length === 0
                                text: "此分组暂无复测项目。"
                                color: ds.faint
                                font.family: ds.ui
                                font.pixelSize: 13
                            }
                        }
                    }

                    // Progress summary from the native ledger
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        spacing: 0
                        visible: uiShell.progressSummary !== ""
                        Rectangle {
                            Layout.fillWidth: true
                            height: 1
                            color: ds.line
                        }
                        Text {
                            Layout.fillWidth: true
                            Layout.topMargin: ds.s12
                            text: uiShell.progressSummary
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            lineHeight: 1.6
                            wrapMode: Text.WordWrap
                        }
                    }

                    // .rv-footnote
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        height: 1
                        color: ds.line
                    }
                    Text {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s12
                        Layout.preferredWidth: 616
                        text: uiShell.analysisSnapshot.reviewScheduledCount === undefined
                              ? "本页只列 reviewDueKey 已安排的记录；暂无排期数据。"
                              : "本页只列 reviewDueKey 已安排的记录：逾期 "
                                + uiShell.analysisSnapshot.reviewOverdueCount + " 项，今日 "
                                + uiShell.analysisSnapshot.reviewTodayCount + " 项，未来 7 天 "
                                + uiShell.analysisSnapshot.reviewFuture7Days + " 项，合计 "
                                + uiShell.analysisSnapshot.reviewScheduledCount
                                + " 项；没有到期安排的记录不计入任何分母。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 13
                        lineHeight: 1.6
                        wrapMode: Text.WordWrap
                    }
                }
            }
        }
    }
