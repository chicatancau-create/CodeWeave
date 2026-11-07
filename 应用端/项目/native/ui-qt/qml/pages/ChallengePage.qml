import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"

Item {
    property QtObject ds
        id: challengePage
        property string searchText: ""
        property string stageFilter: "全部"
        property string trackFilter: "全部"
        property string difficultyFilter: "全部"
        property string runnerFilter: "全部"
        property string sortFilter: "A—M 顺序"
        property bool moreFiltersOpen: false
        property int currentPage: 1
        readonly property int pageSize: 12
        readonly property var filteredChallenges: filterChallenges()
        function chStatus(item) {
            return item.runner === "external" ? "external-pending" : "not-started";
        }
        readonly property int pageCount: Math.max(1, Math.ceil(filteredChallenges.length / pageSize))
        readonly property var pageChallenges: filteredChallenges.slice((currentPage - 1) * pageSize,
                                                                       currentPage * pageSize)
        readonly property string activeFilterSummary: {
            const labels = [];
            if (searchText.trim()) labels.push("搜索：" + searchText.trim());
            if (stageFilter !== "全部") labels.push("阶段：" + stageFilter);
            if (trackFilter !== "全部") labels.push("轨道：" + trackFilter);
            if (difficultyFilter !== "全部") labels.push("难度：" + difficultyFilter);
            if (runnerFilter !== "全部") labels.push("运行方式：" + runnerFilter);
            if (sortFilter !== "A—M 顺序") labels.push("排序：" + sortFilter);
            return labels.join("  ·  ");
        }

        function uniqueValues(field) {
            const values = [];
            uiShell.challengeMeta.forEach(function(item) {
                const value = item[field] || "";
                if (value && values.indexOf(value) < 0) values.push(value);
            });
            values.sort();
            values.unshift("全部");
            return values;
        }

        function filterChallenges() {
            const query = searchText.trim().toLocaleLowerCase();
            const result = uiShell.challengeMeta.filter(function(item) {
                const searchable = [item.title, item.description, item.stageId, item.track,
                                    (item.stack || []).join(" ")].join(" ").toLocaleLowerCase();
                return (!query || searchable.indexOf(query) >= 0)
                    && (stageFilter === "全部" || item.stageId === stageFilter)
                    && (trackFilter === "全部" || item.track === trackFilter)
                    && (difficultyFilter === "全部" || item.difficulty === difficultyFilter)
                    && (runnerFilter === "全部" || item.runner === runnerFilter);
            });
            if (sortFilter === "标题") result.sort(function(a, b) { return a.title.localeCompare(b.title); });
            return result;
        }

        function clearFilters() {
            challengeSearch.text = "";
            searchText = "";
            stageFilter = "全部";
            trackFilter = "全部";
            difficultyFilter = "全部";
            runnerFilter = "全部";
            sortFilter = "A—M 顺序";
            currentPage = 1;
        }

        ColumnLayout {
            anchors.fill: parent
            spacing: 0

            // .module-heading.challenge-overview
            RowLayout {
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s20
                spacing: ds.s32

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0
                    // .eyebrow — mono 13px, 0.24em tracking, uppercase, 7px ring
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
                            text: "实战挑战"
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
                        text: "挑战关卡"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 24
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.5
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "通过实际问题检验学习效果，每个关卡独立验收。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 14
                        elide: Text.ElideRight
                    }
                }

                // .challenge-overview-stats — right-aligned column, 2px bar
                ColumnLayout {
                    Layout.alignment: Qt.AlignTop
                    Layout.preferredWidth: 240
                    spacing: ds.s10
                    Text {
                        Layout.fillWidth: true
                        text: "共 " + uiShell.challengeMeta.length + " 关 · 筛选后 "
                              + challengePage.filteredChallenges.length + " 关"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 14
                        horizontalAlignment: Text.AlignRight
                    }
                }
            }

            // .challenge-filters
            Rectangle {
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s20
                implicitHeight: filterRow.implicitHeight + (challengePage.moreFiltersOpen ? 72 : 0) + ds.s32
                radius: ds.radius
                color: "#12161d"
                border.color: ds.line
                border.width: 1

                RowLayout {
                    id: filterRow
                    anchors { left: parent.left; right: parent.right; top: parent.top;
                              leftMargin: ds.s16; rightMargin: ds.s16; topMargin: ds.s16 }
                    spacing: ds.s14

                    // .challenge-filters-label
                    RowLayout {
                        spacing: ds.s8
                        Text {
                            text: "◫"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Text {
                            text: "筛选"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.letterSpacing: 2.6
                            font.capitalization: Font.AllUppercase
                            Layout.alignment: Qt.AlignVCenter
                        }
                    }

                    // .challenge-filter-search
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.preferredWidth: 220
                        spacing: ds.s4
                        Text {
                            text: "搜索"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.letterSpacing: 0.8
                        }
                        TextField {
                            id: challengeSearch
                            Layout.fillWidth: true
                            implicitHeight: 44
                            placeholderText: "标题 / 技术栈 / 说明"
                            placeholderTextColor: ds.faint
                            color: ds.ink
                            font.family: ds.mono
                            font.pixelSize: 14
                            leftPadding: ds.s10
                            rightPadding: ds.s10
                            background: Rectangle {
                                radius: ds.radiusSm
                                color: ds.inset
                                border.color: parent.activeFocus ? ds.accent : ds.lineStrong
                                border.width: 1
                            }
                            Accessible.name: "搜索关卡"
                            onTextChanged: {
                                challengePage.searchText = text;
                                challengePage.currentPage = 1;
                            }
                        }
                    }

                    ColumnLayout {
                        spacing: ds.s4
                        Text { text: "阶段"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13 }
                        ComboBox {
                            Layout.preferredWidth: 108
                            implicitHeight: 44
                            model: challengePage.uniqueValues("stageId")
                            currentIndex: Math.max(0, model.indexOf(challengePage.stageFilter))
                            onActivated: { challengePage.stageFilter = currentText; challengePage.currentPage = 1; }
                        }
                    }

                    ColumnLayout {
                        spacing: ds.s4
                        Text { text: "轨道"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13 }
                        ComboBox {
                            Layout.preferredWidth: 140
                            implicitHeight: 44
                            model: challengePage.uniqueValues("track")
                            currentIndex: Math.max(0, model.indexOf(challengePage.trackFilter))
                            onActivated: { challengePage.trackFilter = currentText; challengePage.currentPage = 1; }
                        }
                    }

                    Item { Layout.fillWidth: true }

                    QuietButton {
                                ds: challengePage.ds
                        implicitHeight: 44
                        label: challengePage.moreFiltersOpen ? "收起筛选" : "更多筛选"
                        onClicked: challengePage.moreFiltersOpen = !challengePage.moreFiltersOpen
                    }
                }

                RowLayout {
                    anchors { left: parent.left; right: parent.right; bottom: parent.bottom;
                              leftMargin: ds.s16; rightMargin: ds.s16; bottomMargin: ds.s12 }
                    visible: challengePage.moreFiltersOpen
                    spacing: ds.s12
                    ColumnLayout {
                        spacing: ds.s4
                        Text { text: "难度"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13 }
                        ComboBox {
                            Layout.preferredWidth: 140
                            implicitHeight: 44
                            model: challengePage.uniqueValues("difficulty")
                            currentIndex: Math.max(0, model.indexOf(challengePage.difficultyFilter))
                            onActivated: { challengePage.difficultyFilter = currentText; challengePage.currentPage = 1; }
                        }
                    }
                    ColumnLayout {
                        spacing: ds.s4
                        Text { text: "运行方式"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13 }
                        ComboBox {
                            Layout.preferredWidth: 170
                            implicitHeight: 44
                            textRole: "label"
                            model: [
                                { value: "全部", label: "全部" },
                                { value: "teaching", label: "教学运行器" },
                                { value: "external", label: "外部环境实验" }
                            ]
                            currentIndex: Math.max(0, model.findIndex(function(item) {
                                return item.value === challengePage.runnerFilter;
                            }))
                            onActivated: {
                                challengePage.runnerFilter = model[currentIndex].value;
                                challengePage.currentPage = 1;
                            }
                        }
                    }
                    ColumnLayout {
                        spacing: ds.s4
                        Text { text: "排序"; color: ds.muted; font.family: ds.ui; font.pixelSize: 13 }
                        ComboBox {
                            Layout.preferredWidth: 150
                            implicitHeight: 44
                            model: ["A—M 顺序", "标题"]
                            currentIndex: Math.max(0, model.indexOf(challengePage.sortFilter))
                            onActivated: { challengePage.sortFilter = currentText; challengePage.currentPage = 1; }
                        }
                    }
                    Item { Layout.fillWidth: true }
                    QuietButton {
                                ds: challengePage.ds
                        implicitHeight: 44
                        label: "清除筛选"
                        enabled: challengePage.searchText !== "" || challengePage.stageFilter !== "全部"
                                 || challengePage.trackFilter !== "全部"
                                 || challengePage.difficultyFilter !== "全部"
                                 || challengePage.runnerFilter !== "全部"
                                 || challengePage.sortFilter !== "A—M 顺序"
                        onClicked: challengePage.clearFilters()
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s12
                visible: challengePage.activeFilterSummary !== ""
                spacing: ds.s10
                Text {
                    Layout.fillWidth: true
                    text: challengePage.activeFilterSummary
                    color: ds.muted
                    font.family: ds.ui
                    font.pixelSize: 12
                    elide: Text.ElideRight
                }
                QuietButton {
                                ds: challengePage.ds
                    implicitHeight: 36
                    label: "清除筛选"
                    onClicked: challengePage.clearFilters()
                }
            }

            // ol.challenge-grid — the page's own scroll box
            Item {
                Layout.fillWidth: true
                Layout.fillHeight: true
                ScrollView {
                    anchors.fill: parent
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                    GridView {
                        id: challengeGrid
                        anchors.fill: parent
                        cellWidth: Math.max(1, Math.floor(width / 3) - 1)
                        cellHeight: 236
                        model: challengePage.pageChallenges
                        clip: true

                        delegate: Item {
                            required property var modelData
                            required property int index
                            width: challengeGrid.cellWidth
                            height: challengeGrid.cellHeight

                        // .stage-card — mono text, hairline ledger
                        Rectangle {
                            anchors {
                                left: parent.left
                                right: parent.right
                                top: parent.top
                                bottom: parent.bottom
                                rightMargin: ds.s20
                                bottomMargin: ds.s20
                            }
                            radius: ds.radius
                            color: chHover.hovered ? "#161c24" : "transparent"

                            // status left bar — 悬停时宽度从 1px 过渡到 3px（220ms）
                            Rectangle {
                                anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
                                width: chHover.hovered ? 3 : 1
                                color: {
                                    const k = chStatus(modelData);
                                    // 6 档状态色映射
                                    if (k === "not-started") return ds.faint;           // 未开始：faint 色
                                    if (k === "external-pending") return ds.warning;    // 外部待定：warn 色
                                    if (k === "unsupported") return ds.danger;          // 不支持：danger 色
                                    if (k === "ready-to-submit") return ds.info;        // 可提交：info 色
                                    if (k === "pending-verify") return ds.accent;       // 待确认：accent 色
                                    if (k === "passed") return ds.success;              // 已通过：success 色
                                    return ds.line;
                                }

                                Behavior on width {
                                    NumberAnimation { duration: ds.durBase; easing.type: ds.easingType }
                                }
                                Behavior on color {
                                    ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                                }
                            }

                            // Anchored rather than stacked: the meta row is pinned
                            // to the bottom and the text is clipped from the top,
                            // so a long title can never push the meta row into the
                            // next grid cell.
                            Item {
                                anchors.fill: parent
                                anchors.margins: ds.s14
                                clip: true

                                // .stage-card-top
                                RowLayout {
                                    id: cardTop
                                    anchors { left: parent.left; right: parent.right; top: parent.top }
                                    spacing: ds.s10
                                    Text {   // .stage-card-no
                                        text: (index + 1) < 10 ? "0" + (index + 1) : "" + (index + 1)
                                        color: ds.accent
                                        font.family: ds.mono
                                        font.pixelSize: 14
                                        font.letterSpacing: 2
                                        Layout.alignment: Qt.AlignVCenter
                                    }
                                    Rectangle {   // .stage-badge
                                        implicitWidth: 26
                                        implicitHeight: 26
                                        radius: 0
                                        color: "transparent"
                                        border.color: ds.lineStrong
                                        border.width: 1
                                        Layout.alignment: Qt.AlignVCenter
                                        Text {
                                            anchors.centerIn: parent
                                            text: modelData.stageId || ""
                                            color: ds.ink
                                            font.family: ds.mono
                                            font.pixelSize: 13
                                            font.weight: Font.DemiBold
                                        }
                                    }
                                    Item { Layout.fillWidth: true }
                                    // .stage-status
                                    Rectangle {
                                        implicitWidth: stRow.implicitWidth + ds.s20
                                        implicitHeight: 22
                                        radius: 0
                                        color: chStatus(modelData) === "external-pending"
                                               ? "#241f0d" : "transparent"
                                        border.color: chStatus(modelData) === "external-pending"
                                                      ? ds.warning : ds.lineRaised
                                        border.width: 1
                                        Layout.alignment: Qt.AlignVCenter
                                        RowLayout {
                                            id: stRow
                                            anchors.centerIn: parent
                                            spacing: ds.s6
                                            Rectangle {
                                                implicitWidth: 7
                                                implicitHeight: 7
                                                radius: 4
                                                color: chStatus(modelData) === "external-pending"
                                                       ? ds.warning : "transparent"
                                                border.color: chStatus(modelData) === "external-pending"
                                                              ? ds.warning : ds.lineRaised
                                                border.width: 1
                                                Layout.alignment: Qt.AlignVCenter
                                            }
                                            Text {
                                                text: chStatus(modelData) === "external-pending"
                                                      ? "待实验" : "未开始"
                                                color: chStatus(modelData) === "external-pending"
                                                       ? ds.warning : ds.faint
                                                font.family: ds.ui
                                                font.pixelSize: 13
                                                font.weight: Font.DemiBold
                                                font.letterSpacing: 0.8
                                                Layout.alignment: Qt.AlignVCenter
                                            }
                                        }
                                    }
                                }

                                // .stage-card-meta — pinned to the bottom
                                RowLayout {
                                    id: cardMeta
                                    anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                                    spacing: ds.s10
                                    Rectangle {   // .difficulty — neutral for all levels
                                        implicitWidth: difLabel.implicitWidth + ds.s16
                                        implicitHeight: 22
                                        radius: 0
                                        color: "transparent"
                                        border.color: ds.lineRaised
                                        border.width: 1
                                        Layout.alignment: Qt.AlignVCenter
                                        Text {
                                            id: difLabel
                                            anchors.centerIn: parent
                                            text: modelData.difficulty || ""
                                            color: ds.muted
                                            font.family: ds.mono
                                            font.pixelSize: 13
                                            font.letterSpacing: 1.8
                                        }
                                    }
                                    Text {   // .stage-runner
                                        text: modelData.runner === "external"
                                              ? "外部环境实验" : "教学运行器"
                                        color: "#7a828f"
                                        font.family: ds.mono
                                        font.pixelSize: 13
                                        Layout.alignment: Qt.AlignVCenter
                                    }
                                    Item { Layout.fillWidth: true }
                                    Text {   // .stage-card-action
                                        text: "开始挑战"
                                        color: ds.ink
                                        font.family: ds.mono
                                        font.pixelSize: 14
                                        font.weight: Font.DemiBold
                                        Layout.alignment: Qt.AlignVCenter
                                    }
                                }

                                // hairline above the meta row
                                Rectangle {
                                    anchors { left: parent.left; right: parent.right
                                               bottom: cardMeta.top; bottomMargin: ds.s6 }
                                    height: 1
                                    color: ds.line
                                }

                                ColumnLayout {
                                    anchors {
                                        left: parent.left
                                        right: parent.right
                                        top: cardTop.bottom
                                        bottom: cardMeta.top
                                        topMargin: ds.s8
                                        bottomMargin: ds.s14
                                    }
                                    spacing: ds.s6

                                    // .stage-title — shortTitle, mono
                                    Text {
                                        Layout.fillWidth: true
                                        text: (modelData.title || "").replace(/^[A-M] 关卡验收：/, "")
                                        color: ds.ink
                                        font.family: ds.mono
                                        font.pixelSize: 14
                                        font.weight: Font.DemiBold
                                        lineHeight: 1.45
                                        wrapMode: Text.WordWrap
                                        maximumLineCount: 2
                                        elide: Text.ElideRight
                                    }

                                    // .stage-card-summary — description + 本关聚焦
                                    Text {
                                        Layout.fillWidth: true
                                        text: (modelData.description || "")
                                              + ((modelData.stack || []).length > 0
                                                 ? " 本关聚焦：" + modelData.stack.join("、") + "。"
                                                 : "")
                                        color: ds.muted
                                        font.family: ds.mono
                                        font.pixelSize: 14
                                        lineHeight: 1.6
                                        wrapMode: Text.WordWrap
                                        maximumLineCount: 2
                                        elide: Text.ElideRight
                                    }

                                    Item { Layout.fillHeight: true }
                                }
                            }

                            HoverHandler { id: chHover; cursorShape: Qt.PointingHandCursor }
                            // No native challenge runner exists yet, so the card
                            // stays informational rather than navigating somewhere
                            // that would pretend to run it.
                        }
                        }
                    }
                    ColumnLayout {
                        anchors.centerIn: parent
                        width: Math.min(parent.width - ds.s32, 420)
                        visible: challengePage.filteredChallenges.length === 0
                        spacing: ds.s10
                        Text {
                            Layout.fillWidth: true
                            text: uiShell.challengeMeta.length === 0
                                  ? "暂无可用的挑战数据。" : "当前筛选条件下没有匹配的关卡。"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 14
                            horizontalAlignment: Text.AlignHCenter
                            wrapMode: Text.WordWrap
                        }
                        QuietButton {
                                ds: challengePage.ds
                            Layout.alignment: Qt.AlignHCenter
                            implicitHeight: 44
                            label: "清除筛选"
                            visible: uiShell.challengeMeta.length > 0
                            enabled: challengePage.searchText !== "" || challengePage.stageFilter !== "全部"
                                     || challengePage.trackFilter !== "全部"
                                     || challengePage.difficultyFilter !== "全部"
                                     || challengePage.sortFilter !== "A—M 顺序"
                                     || challengePage.runnerFilter !== "全部"
                            onClicked: challengePage.clearFilters()
                        }
                    }
                }
            }

            // nav.challenge-pagination
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: 1
                color: ds.line
            }
            RowLayout {
                Layout.fillWidth: true
                Layout.topMargin: ds.s20
                spacing: ds.s12
                QuietButton {
                                ds: challengePage.ds
                    implicitHeight: 44
                    label: "‹ 上一页"
                    enabled: challengePage.currentPage > 1
                    onClicked: challengePage.currentPage = Math.max(1, challengePage.currentPage - 1)
                }
                Item { Layout.fillWidth: true }
                Text {
                    text: challengePage.filteredChallenges.length === 0
                          ? "暂无匹配关卡" : "第 " + challengePage.currentPage + " / " + challengePage.pageCount + " 页"
                    color: ds.muted
                    font.family: ds.ui
                    font.pixelSize: 14
                    font.letterSpacing: 0.8
                    Layout.alignment: Qt.AlignVCenter
                }
                Item { Layout.fillWidth: true }
                QuietButton {
                                ds: challengePage.ds
                    implicitHeight: 44
                    label: "下一页 ›"
                    enabled: challengePage.currentPage < challengePage.pageCount
                    onClicked: challengePage.currentPage = Math.min(challengePage.pageCount,
                                                                     challengePage.currentPage + 1)
                }
            }
        }
    }
