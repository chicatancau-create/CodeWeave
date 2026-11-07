import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Item {
    property QtObject ds
        id: analyticsPage

        // Computed once so every row agrees on the same window.
        readonly property string todayKey: Qt.formatDate(new Date(), "yyyy-MM-dd")
        readonly property string weekStartKey: {
            const d = new Date();
            d.setDate(d.getDate() - 6);
            return Qt.formatDate(d, "yyyy-MM-dd");
        }
        readonly property string period: weekStartKey + " 至 " + todayKey

        // Table geometry. The web uses table-layout:fixed with the header row
        // setting widths: 3.2em and 7em resolve against the 12.5px header font,
        // giving 40px and 87.5px; column 2 is 24%; columns 4 and 5 split the rest.
        readonly property real tblW: Math.max(0, width - ds.s32 * 2)
        // .an-specs caps at 78ch; ~7px per char at the 14px body size.
        readonly property real specWidth: Math.min(tblW, 546)
        readonly property real colNum: 40
        readonly property real colName: Math.floor(tblW * 0.24)
        readonly property real colValue: 87.5
        readonly property real colRest: Math.max(0, (tblW - colNum - colName - colValue) / 2)
        function metric(key, fallback) {
            const value = uiShell.analysisSnapshot[key]
            return value === undefined || value === null ? fallback : String(value)
        }
        readonly property string reviewRate: {
            const passed = uiShell.analysisSnapshot.reviewPassed;
            const failed = uiShell.analysisSnapshot.reviewFailed;
            if (passed === undefined || failed === undefined) return "暂无数据";
            const total = Number(passed) + Number(failed);
            return total === 0 ? "样本不足" : Math.round(Number(passed) / total * 100) + "%";
        }
        readonly property string reviewRateDetail: {
            const passed = uiShell.analysisSnapshot.reviewPassed;
            const failed = uiShell.analysisSnapshot.reviewFailed;
            if (passed === undefined || failed === undefined) return "暂无复测数据";
            return "近 7 天复测 " + (Number(passed) + Number(failed))
                + " 次（通过 " + passed + " · 未通过 " + failed + "）";
        }

        ScrollView {
            anchors.fill: parent
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            clip: true

            Rectangle {
                width: analyticsPage.width
                implicitHeight: pageCol.implicitHeight + ds.s32 * 2
                color: ds.page
                border.color: ds.line
                border.width: 1
                radius: ds.radius

                ColumnLayout {
                    id: pageCol
                    anchors {
                        left: parent.left
                        right: parent.right
                        top: parent.top
                        margins: ds.s32
                        rightMargin: 29
                    }
                    spacing: 0

                    // .module-heading — flush stack, no bottom margin
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.bottomMargin: 0
                        spacing: ds.s20
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0
                            // .eyebrow — the page's only mono text
                            RowLayout {
                                spacing: ds.s8
                                Rectangle {   // .eyebrow-dot
                                    implicitWidth: 6
                                    implicitHeight: 6
                                    radius: 3
                                    color: ds.accent
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Text {
                                    text: "学习分析"
                                    color: ds.muted
                                    font.family: ds.mono
                                    font.pixelSize: 13
                                    font.letterSpacing: 3.1
                                    font.capitalization: Font.AllUppercase
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                            Text {
                                text: "学习分析仪表盘"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 24
                                font.weight: Font.DemiBold
                                font.letterSpacing: -0.5
                                lineHeight: 1.4
                            }
                            Text {
                                Layout.topMargin: ds.s8
                                text: "统计周期：近 7 天（" + analyticsPage.period + "，按学习证据时间）。"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                elide: Text.ElideRight
                            }
                        }
                    }

                    // dl.an-specs
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        Layout.bottomMargin: ds.s24
                        spacing: 0
                        Rectangle {   // list top hairline
                            Layout.fillWidth: true
                            Layout.maximumWidth: analyticsPage.specWidth
                            height: 1
                            color: ds.line
                        }
                        Repeater {
                            model: [
                                { dt: "窗口",
                                  dd: analyticsPage.weekStartKey + " 至 "
                                      + analyticsPage.todayKey + "（含今天，共 7 个本地日期）" },
                                { dt: "归日口径",
                                  dd: "证据时间一律按本地日期归日，不把 UTC 日期当本地日期" },
                                { dt: "数据来源",
                                  dd: "仅本机学习证据：课程与复测记录、挑战验收记录、打卡记录" }
                            ]
                            delegate: ColumnLayout {
                                required property var modelData
                                Layout.fillWidth: true
                                Layout.maximumWidth: analyticsPage.specWidth
                                spacing: 0
                                RowLayout {
                                    Layout.fillWidth: true
                                    Layout.topMargin: ds.s12
                                    Layout.bottomMargin: ds.s12
                                    spacing: ds.s12
                                    Text {
                                        // 11ch at 12.5px, uppercase-tracked
                                        Layout.preferredWidth: 128
                                        text: modelData.dt
                                        color: ds.muted
                                        font.family: ds.ui
                                        font.pixelSize: 13
                                        font.letterSpacing: 2.5
                                        font.capitalization: Font.AllUppercase
                                    }
                                    Text {
                                        Layout.fillWidth: true
                                        text: modelData.dd
                                        color: ds.ink
                                        opacity: 0.82
                                        font.family: ds.ui
                                        font.pixelSize: 14
                                        lineHeight: 1.6
                                        wrapMode: Text.WordWrap
                                    }
                                }
                                Rectangle {
                                    Layout.fillWidth: true
                                    height: 1
                                    color: ds.line
                                }
                            }
                        }
                    }

                    // section.an-block ×3 — bare grids, no surface
                    Repeater {
                        model: [
                            { idx: "01", icon: "◈", title: "近 7 天学习活动",
                              rows: [
                                { n: "完成课程单元", v: analyticsPage.metric("completedUnits", "暂无数据"), b: "按 lessonId 去重，仅计通过证据",
                                  d: "窗口 " + analyticsPage.period + " 内的课程证据" },
                                { n: "课程练习次数", v: analyticsPage.metric("practiceCount", "暂无数据"), b: "同一单元重复练习分别计数，与上一行是两个口径",
                                  d: "窗口 " + analyticsPage.period + " 内的课程证据" },
                                { n: "挑战通过记录", v: analyticsPage.metric("verifiedPasses", "暂无数据"), b: "仅统计 Challenge 类型且通过的记录",
                                  d: "无分母，不折算百分比" },
                                { n: "挑战通过（旧版迁移口径）", v: "暂无数据",
                                  b: "记录缺失 status，按迁移语义单列为旧版，不混入上一行",
                                  d: "无分母，不折算百分比" },
                                { n: "复测通过", v: analyticsPage.metric("reviewPassed", "暂无数据"), b: "kind=review 且 passed 的证据",
                                  d: "当前数据源未提供复测分类" },
                                { n: "复测未通过", v: analyticsPage.metric("reviewFailed", "暂无数据"), b: "kind=review 且未通过的证据",
                                  d: "当前数据源未提供复测分类" }
                              ],
                              note: "" },
                            { idx: "02", icon: "▲", title: "近 7 天复测通过率",
                              rows: [
                                { n: "近 7 天复测通过率", v: analyticsPage.reviewRate,
                                  b: "通过 /（通过 + 未通过），四舍五入到整数百分比",
                                  d: analyticsPage.reviewRateDetail,
                                  a: analyticsPage.reviewRate === "样本不足"
                                      ? "下一步：到复习中心完成一次复测后，这里会显示比率。"
                                      : "该比率只反映近 7 天复测结果，不代表到期任务完成率。" },
                                { n: "到期任务完成率", v: "未统计",
                                  b: "需要计划任务分母；本机没有可复现的历史排期记录（STAT-01 第 4 条）",
                                  d: "无分母，不折算百分比",
                                  a: "下一步：等复习中心的排期按生效节奏累计出可复现的分母；本页不提供手填任务数的入口，也不拿活动次数顶替。" }
                              ],
                              note: "复测通过率只统计近 7 天的通过与未通过复测记录。" },
                            { idx: "03", icon: "◷", title: "连续打卡",
                              rows: [
                                { n: "连续打卡天数", v: analyticsPage.metric("streakDays", "暂无数据"),
                                  b: "从今天往回数连续有打卡记录的日期（countStreak）",
                                  d: "当前数据源未提供打卡记录" },
                                { n: "今日打卡状态", v: analyticsPage.metric("todayCheckin", "暂无数据"), b: "打卡记录按本地日期键判定",
                                  d: "今天 " + analyticsPage.todayKey },
                                { n: "学习时长（近 7 天）", v: "未统计",
                                  b: "没有时长数据源；不追溯编造（STAT-01 第 6 条）",
                                  d: "无分母，不折算百分比",
                                  a: "下一步：本页没有可开启的时长统计，也不拿活动次数折算时长；要跟踪投入时间请用下面「连续打卡」那一档，它是替代口径、不是时长。" }
                              ],
                              note: "学习时长按 STAT-01 第 6 条保持「未统计」：本机没有时长数据源，不用活动次数推算。" }
                        ]
                        delegate: ColumnLayout {
                            required property var modelData
                            required property int index
                            Layout.fillWidth: true
                            Layout.topMargin: index === 0 ? 0 : ds.s24
                            spacing: 0

                            // .an-block-heading — hairline underline, baseline row
                            RowLayout {
                                Layout.fillWidth: true
                                Layout.bottomMargin: ds.s10
                                spacing: ds.s12
                                Text {
                                    text: modelData.idx
                                    color: ds.accent
                                    font.family: ds.ui
                                    font.pixelSize: 32
                                    font.weight: Font.DemiBold
                                    font.letterSpacing: -0.96
                                    Layout.alignment: Qt.AlignBaseline
                                }
                                Text {
                                    text: modelData.icon
                                    color: ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 15
                                    Layout.alignment: Qt.AlignBaseline
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: modelData.title
                                    color: ds.ink
                                    font.family: ds.ui
                                    font.pixelSize: 20
                                    font.letterSpacing: -0.4
                                    lineHeight: 1.15
                                    Layout.alignment: Qt.AlignBaseline
                                }
                            }
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.bottomMargin: ds.s16
                                height: 1
                                color: ds.lineRaised
                            }

                            // table — fixed columns, hairline rows
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 0

                                // thead
                                Item {
                                    Layout.fillWidth: true
                                    implicitHeight: 34
                                    Rectangle {
                                        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                                        height: 1
                                        color: ds.lineRaised
                                    }
                                    RowLayout {
                                        anchors.fill: parent
                                        spacing: 0
                                        Repeater {
                                            model: [
                                                { t: "次", w: analyticsPage.colNum },
                                                { t: "指标", w: analyticsPage.colName },
                                                { t: "数值", w: analyticsPage.colValue },
                                                { t: "派生口径", w: analyticsPage.colRest },
                                                { t: "分母", w: analyticsPage.colRest }
                                            ]
                                            delegate: Text {
                                                required property var modelData
                                                Layout.preferredWidth: modelData.w
                                                Layout.alignment: Qt.AlignTop
                                                text: modelData.t
                                                color: ds.muted
                                                font.family: ds.ui
                                                font.pixelSize: 13
                                                font.letterSpacing: 2.5
                                                font.capitalization: Font.AllUppercase
                                                wrapMode: Text.WordWrap
                                            }
                                        }
                                    }
                                }

                                // tbody
                                Repeater {
                                    model: modelData.rows
                                    delegate: Item {
                                        required property var modelData
                                        required property int index
                                        Layout.fillWidth: true
                                        implicitHeight: rowCol.implicitHeight + ds.s32
                                        Rectangle {
                                            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                                            height: 1
                                            color: ds.line
                                        }
                                        RowLayout {
                                            id: rowCol
                                            anchors {
                                                left: parent.left
                                                right: parent.right
                                                top: parent.top
                                                topMargin: ds.s14
                                                rightMargin: 0
                                            }
                                            spacing: 0
                                            Text {   // .an-row-idx
                                                Layout.preferredWidth: analyticsPage.colNum
                                                Layout.alignment: Qt.AlignTop
                                                text: (index + 1) < 10 ? "0" + (index + 1) : "" + (index + 1)
                                                color: ds.muted
                                                font.family: ds.ui
                                                font.pixelSize: 13
                                            }
                                            Text {   // .an-cell-name
                                                Layout.preferredWidth: analyticsPage.colName
                                                Layout.alignment: Qt.AlignTop
                                                text: modelData.n
                                                color: ds.ink
                                                font.family: ds.ui
                                                font.pixelSize: 14
                                                lineHeight: 1.55
                                                wrapMode: Text.WordWrap
                                            }
                                            Text {   // .an-cell-value — not dimmed for 样本不足
                                                Layout.preferredWidth: analyticsPage.colValue
                                                Layout.alignment: Qt.AlignTop
                                                text: modelData.v
                                                color: ds.ink
                                                opacity: 0.82
                                                font.family: ds.ui
                                                font.pixelSize: 14
                                                lineHeight: 1.55
                                                wrapMode: Text.WordWrap
                                            }
                                            ColumnLayout {   // .an-cell-basis (+ action)
                                                Layout.preferredWidth: analyticsPage.colRest
                                                Layout.alignment: Qt.AlignTop
                                                spacing: ds.s6
                                                Text {
                                                    Layout.fillWidth: true
                                                    text: modelData.b
                                                    color: ds.muted
                                                    font.family: ds.ui
                                                    font.pixelSize: 13
                                                    lineHeight: 1.6
                                                    wrapMode: Text.WordWrap
                                                }
                                                Text {
                                                    Layout.fillWidth: true
                                                    visible: modelData.a !== undefined
                                                    text: modelData.a !== undefined ? modelData.a : ""
                                                    color: ds.muted
                                                    font.family: ds.ui
                                                    font.pixelSize: 13
                                                    lineHeight: 1.6
                                                    wrapMode: Text.WordWrap
                                                }
                                            }
                                            Text {   // .an-cell-den
                                                Layout.preferredWidth: analyticsPage.colRest
                                                Layout.alignment: Qt.AlignTop
                                                text: modelData.d
                                                color: modelData.d.indexOf("无分母") === 0 ? ds.ink : ds.muted
                                                font.family: ds.ui
                                                font.pixelSize: 13
                                                lineHeight: 1.6
                                                wrapMode: Text.WordWrap
                                            }
                                        }
                                    }
                                }
                            }

                            // .an-honest — flat hairline strip, not a card
                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: 0
                                Layout.preferredWidth: analyticsPage.tblW
                                visible: modelData.note !== ""
                                text: modelData.note
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                lineHeight: 1.6
                                wrapMode: Text.WordWrap
                                topPadding: ds.s12
                            }
                            Rectangle {
                                Layout.fillWidth: true
                                visible: modelData.note !== ""
                                Layout.topMargin: 0
                                height: 1
                                color: ds.line
                            }
                        }
                    }
                }
            }
        }
    }
