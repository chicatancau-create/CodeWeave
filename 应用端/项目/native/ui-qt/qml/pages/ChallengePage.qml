import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"

Item {
    property QtObject ds
        id: challengePage
        objectName: "challengePageRoot"
        property string searchText: ""
        property string stageFilter: "全部"
        property string trackFilter: "全部"
        property string difficultyFilter: "全部"
        property string runnerFilter: "全部"
        property string sortFilter: "A—M 顺序"
        property bool moreFiltersOpen: false
        property int currentPage: 1
        property var detailTrigger: null
        function openDetail(challengeId, trigger) {
            detailTrigger = trigger;
            uiShell.openChallenge(challengeId);
        }
        Connections {
            target: uiShell
            function onChallengeSelectionChanged() {
                if (!challengePage.visible) return;
                if (uiShell.challengeDetailOpen) {
                    Qt.callLater(function() {
                        detailBack.forceActiveFocus();
                    });
                } else {
                    Qt.callLater(function() {
                        if (challengePage.detailTrigger) challengePage.detailTrigger.forceActiveFocus();
                        else challengeSearch.forceActiveFocus();
                    });
                }
            }
        }
        readonly property int pageSize: 12
        readonly property var filteredChallenges: filterChallenges()
        function chStatus(item) {
            const record = uiShell.challengeProgress[item.id];
            if (record && (record.status === "passed" || record.status === "verified")) return "passed";
            if (record && record.status === "submitted") return "pending-verify";
            if (record && record.status === "rejected") return "rejected";
            return item.runner === "external" ? "external-pending" : "not-started";
        }
        function statusLabel(item) {
            const status = chStatus(item);
            if (status === "passed") return "已通过";
            if (status === "pending-verify") return "待确认";
            if (status === "rejected") return "未通过";
            return status === "external-pending" ? "待实验" : "未开始";
        }
        function statusColor(item) {
            const status = chStatus(item);
            if (status === "passed") return ds.success;
            if (status === "pending-verify") return ds.accent;
            if (status === "rejected") return ds.danger;
            return status === "external-pending" ? ds.warning : ds.faint;
        }
        function challengeSequence(item) {
            const index = uiShell.challengeMeta.findIndex(function(challenge) {
                return challenge.id === item.id;
            });
            return index < 0 ? "" : (index + 1 < 10 ? "0" : "") + (index + 1);
        }
        readonly property int pageCount: Math.max(1, Math.ceil(filteredChallenges.length / pageSize))
        onPageCountChanged: currentPage = Math.min(currentPage, pageCount)
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
            objectName: "challengeListRoot"
            anchors.fill: parent
            spacing: 0
            visible: !uiShell.challengeDetailOpen

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
                            objectName: "challengeSearch"
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
                            objectName: "challengeStageFilter"
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
                            objectName: "challengeTrackFilter"
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
                            objectName: "challengeDifficultyFilter"
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
                            objectName: "challengeRunnerFilter"
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
                            objectName: "challengeSortFilter"
                            Layout.preferredWidth: 150
                            implicitHeight: 44
                            model: ["A—M 顺序", "标题"]
                            currentIndex: Math.max(0, model.indexOf(challengePage.sortFilter))
                            onActivated: { challengePage.sortFilter = currentText; challengePage.currentPage = 1; }
                        }
                    }
                    Item { Layout.fillWidth: true }
                    QuietButton {
                        objectName: "challengeClearMoreFilters"
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
                    objectName: "challengeClearSummaryFilters"
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
                            id: challengeCard
                            objectName: "challengeCard-" + modelData.id
                            required property var modelData
                            required property int index
                            width: challengeGrid.cellWidth
                            height: challengeGrid.cellHeight
                            activeFocusOnTab: true
                            Accessible.name: "打开挑战详情：" + modelData.title
                            Accessible.role: Accessible.Button
                            Keys.onReturnPressed: challengePage.openDetail(modelData.id, challengeCard)
                            Keys.onEnterPressed: challengePage.openDetail(modelData.id, challengeCard)
                            Keys.onSpacePressed: challengePage.openDetail(modelData.id, challengeCard)

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
                            border.width: challengeCard.activeFocus ? 1 : 0
                            border.color: ds.accent

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
                                    if (k === "rejected") return ds.danger;             // 人工驳回：danger 色
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
                                        objectName: "challengeSequenceNumber"
                                        text: challengePage.challengeSequence(modelData)
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
                                                text: challengePage.statusLabel(modelData)
                                                color: challengePage.statusColor(modelData)
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
                            TapHandler {
                                onTapped: {
                                    challengePage.openDetail(modelData.id, challengeCard);
                                }
                            }
                        }
                        }
                    }
                    ColumnLayout {
                        anchors.centerIn: parent
                        objectName: "challengeEmptyState"
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
                            objectName: "challengeClearEmptyFilters"
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
                    objectName: "challengePreviousPage"
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
                    objectName: "challengeNextPage"
                                ds: challengePage.ds
                    implicitHeight: 44
                    label: "下一页 ›"
                    enabled: challengePage.currentPage < challengePage.pageCount
                    onClicked: challengePage.currentPage = Math.min(challengePage.pageCount,
                                                                     challengePage.currentPage + 1)
                }
            }
        }

        ColumnLayout {
            id: challengeDetailRoot
            anchors.fill: parent
            spacing: ds.s16
            visible: uiShell.challengeDetailOpen
            focus: visible
            Keys.onEscapePressed: uiShell.closeChallenge()

            RowLayout {
                Layout.fillWidth: true
                spacing: ds.s12
                QuietButton {
                    id: detailBack
                    objectName: "challengeDetailBack"
                    ds: challengePage.ds
                    implicitHeight: 44
                    label: "‹ 返回挑战列表"
                    onClicked: uiShell.closeChallenge()
                }
                Item { Layout.fillWidth: true }
                Text {
                    text: challengePage.challengeSequence(uiShell.selectedChallenge)
                          + " / " + uiShell.challengeMeta.length
                    color: ds.muted
                    font.family: ds.mono
                    font.pixelSize: 13
                }
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: ds.s8
                RowLayout {
                    spacing: ds.s10
                    Text {
                        text: "阶段 " + (uiShell.selectedChallenge.stageId || "—")
                        color: ds.accent
                        font.family: ds.mono
                        font.pixelSize: 13
                    }
                    Text {
                        text: uiShell.selectedChallenge.track || "未分类"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 13
                    }
                    Text {
                        text: uiShell.selectedChallenge.runner === "external" ? "外部环境实验"
                              : uiShell.selectedChallenge.runner === "teaching" ? "教学运行器" : "Qt JS 隔离运行"
                        color: uiShell.selectedChallenge.runner === "external" ? ds.warning : ds.success
                        font.family: ds.ui
                        font.pixelSize: 13
                    }
                }
                Text {
                    objectName: "challengeDetailTitle"
                    Layout.fillWidth: true
                    text: uiShell.selectedChallenge.title || "挑战详情"
                    color: ds.ink
                    font.family: ds.ui
                    font.pixelSize: 24
                    font.weight: Font.DemiBold
                    wrapMode: Text.WordWrap
                }
                Text {
                    Layout.fillWidth: true
                    text: uiShell.selectedChallenge.description || "暂无关卡说明。"
                    color: ds.muted
                    font.family: ds.ui
                    font.pixelSize: 14
                    wrapMode: Text.WordWrap
                }
            }

            RowLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: ds.s16
                ScrollView {
                    id: overviewScroll
                    objectName: "challengeOverviewSection"
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.preferredWidth: 1
                    clip: true
                    contentWidth: availableWidth
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                    ColumnLayout {
                        width: overviewScroll.availableWidth
                        spacing: ds.s12
                        Text {
                            Layout.fillWidth: true
                            text: "目标输出"
                            color: ds.accent
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.weight: Font.DemiBold
                        }
                        Text {
                            Layout.fillWidth: true
                            text: {
                                const values = uiShell.selectedChallenge.targetOutput || [];
                                return values.length ? values.map(function(value) { return "› " + value; }).join("\n")
                                                     : "暂无目标输出。";
                            }
                            color: ds.ink
                            font.family: ds.mono
                            font.pixelSize: 13
                            wrapMode: Text.WordWrap
                        }
                        Text {
                            Layout.fillWidth: true
                            text: "证据清单"
                            color: ds.accent
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.weight: Font.DemiBold
                        }
                        Text {
                            Layout.fillWidth: true
                            text: {
                                const values = uiShell.selectedChallenge.evidence || [];
                                return values.length ? values.map(function(value) { return "□  " + value; }).join("\n")
                                                     : "暂无证据清单。";
                            }
                            color: ds.ink
                            font.family: ds.ui
                            font.pixelSize: 13
                            lineHeight: 1.5
                            wrapMode: Text.WordWrap
                        }
                        Text {
                            Layout.fillWidth: true
                            text: "技术栈与说明"
                            color: ds.accent
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.weight: Font.DemiBold
                        }
                        Text {
                            Layout.fillWidth: true
                            text: "技术栈：" + ((uiShell.selectedChallenge.stack || []).join(" / ") || "暂无")
                                  + "\n\n" + (uiShell.selectedChallenge.explanation || "暂无补充说明。")
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            lineHeight: 1.5
                            wrapMode: Text.WordWrap
                        }
                        Text {
                            Layout.fillWidth: true
                            text: "前置关卡"
                            color: ds.accent
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.weight: Font.DemiBold
                        }
                        Text {
                            Layout.fillWidth: true
                            text: {
                                const values = uiShell.selectedChallenge.prerequisites || [];
                                return values.length ? values.join("、") : "无前置关卡";
                            }
                            color: ds.ink
                            font.family: ds.ui
                            font.pixelSize: 13
                            wrapMode: Text.WordWrap
                        }
                    }
                }

                Rectangle { Layout.fillHeight: true; width: 1; color: ds.line }

                ScrollView {
                    id: labScroll
                    objectName: "challengeLabSection"
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.preferredWidth: 1
                    clip: true
                    contentWidth: availableWidth
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                    ColumnLayout {
                        width: labScroll.availableWidth
                        spacing: ds.s12
                        Text {
                            text: "编写与运行"
                            color: ds.accent
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.weight: Font.DemiBold
                        }
                        Text {
                            Layout.fillWidth: true
                            text: uiShell.selectedChallenge.runner === "external"
                                  ? "本关需要在本地外部环境完成。"
                                  : "运行检查尚未提交，不影响学习进度。"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            wrapMode: Text.WordWrap
                        }
                        Text {
                            text: "代码草稿"
                            color: ds.ink
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.weight: Font.DemiBold
                        }
                        TextArea {
                            objectName: "challengeStarterCode"
                            Layout.fillWidth: true
                            Layout.preferredHeight: 240
                            readOnly: uiShell.selectedChallenge.runner === "external" || uiShell.challengeRunBusy
                            selectByMouse: true
                            text: uiShell.challengeCode
                            onTextChanged: if (!readOnly && text !== uiShell.challengeCode) uiShell.updateChallengeCode(text)
                            color: ds.codeInk
                            font.family: ds.mono
                            font.pixelSize: 13
                            wrapMode: TextEdit.WrapAnywhere
                            background: Rectangle {
                                color: ds.inset
                                border.color: ds.lineStrong
                                border.width: 1
                            }
                        }
                        QuietButton {
                            objectName: "challengeRunUnavailable"
                            ds: challengePage.ds
                            implicitHeight: 44
                            label: uiShell.challengeRunBusy ? "取消运行" : "运行检查"
                            enabled: uiShell.selectedChallenge.runner !== "external"
                                     && !uiShell.executionBusy && !uiShell.operationBusy
                            onClicked: uiShell.challengeRunBusy ? uiShell.cancelChallenge() : uiShell.runChallenge()
                            Layout.alignment: Qt.AlignRight
                        }
                        MotionAwareBusyIndicator {
                            ds: challengePage.ds
                            busy: uiShell.challengeRunBusy
                            accessibleName: "正在运行挑战"
                            Layout.alignment: Qt.AlignRight
                            Layout.preferredHeight: 28
                            Layout.preferredWidth: 28
                        }
                        ColumnLayout {
                            objectName: "challengeJudgement"
                            Layout.fillWidth: true
                            spacing: ds.s8
                            visible: Object.keys(uiShell.challengeRunResult).length > 0
                            Text {
                                objectName: "challengeJudgementStatus"
                                Layout.fillWidth: true
                                text: uiShell.challengeRunResult.error ||
                                      (uiShell.challengeRunResult.passed ? "验收点全部命中" : "验收点尚未全部命中")
                                color: uiShell.challengeRunResult.error || !uiShell.challengeRunResult.passed
                                       ? ds.danger : ds.success
                                font.family: ds.ui
                                font.pixelSize: 13
                                wrapMode: Text.WrapAnywhere
                            }
                            Repeater {
                                model: uiShell.challengeRunResult.cases || []
                                delegate: Text {
                                    required property var modelData
                                    required property int index
                                    objectName: "challengeJudgementCase-" + index
                                    Layout.fillWidth: true
                                    text: (modelData.matched ? "命中 · " : "未命中 · ") + modelData.expected
                                          + "\n" + (modelData.matched ? "＝ " + modelData.actual : modelData.reason)
                                    color: modelData.matched ? ds.success : ds.danger
                                    font.family: ds.mono
                                    font.pixelSize: 12
                                    wrapMode: Text.WrapAnywhere
                                }
                            }
                            Text {
                                objectName: "challengeExtraLines"
                                Layout.fillWidth: true
                                visible: (uiShell.challengeRunResult.extraLines || []).length > 0
                                text: "多印：" + (uiShell.challengeRunResult.extraLines || []).join(" / ")
                                color: ds.warning
                                font.family: ds.mono
                                font.pixelSize: 12
                                wrapMode: Text.WrapAnywhere
                            }
                        }
                        ChallengeSubmissionPanel {
                            ds: challengePage.ds
                            Layout.fillWidth: true
                        }
                    }
                }
            }

            Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }
            RowLayout {
                Layout.fillWidth: true
                spacing: ds.s12
                Text {
                    text: "提交记录"
                    color: ds.accent
                    font.family: ds.ui
                    font.pixelSize: 13
                    font.weight: Font.DemiBold
                }
                Text {
                    Layout.fillWidth: true
                    text: "本关已保存 " + uiShell.challengeHistory.length + " 条提交记录"
                    color: ds.muted
                    font.family: ds.ui
                    font.pixelSize: 13
                    wrapMode: Text.WordWrap
                }
            }
        }
    }
