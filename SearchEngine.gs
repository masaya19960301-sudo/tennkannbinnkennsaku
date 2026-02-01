/**
 * 店間便・拠点間移動 到着日検索Webアプリ
 * 経路探索エンジン
 *
 * 検索仕様:
 * - 検索基準日から日付を1日ずつ進めながら探索
 * - 同日積替可の場合は到着当日に次工程へ進める
 * - 最初に到達した到着拠点を最短到達とみなす
 */

/**
 * 経路探索エンジンクラス
 */
class RouteSearchEngine {
  /**
   * @param {Object} data - loadAllData()で取得したデータ
   */
  constructor(data) {
    this.data = data;
    this.locations = data.locations;
    this.transferRules = data.transferRules;
    this.calendarChecker = createCalendarChecker(data);

    // 出発拠点別にルールをインデックス化
    this.rulesByOrigin = this.indexRulesByOrigin();
  }

  /**
   * 出発拠点別にルールをインデックス化
   * @returns {Map<string, Array<Object>>} 出発拠点ID -> ルール配列のマップ
   */
  indexRulesByOrigin() {
    const index = new Map();

    for (const rule of this.transferRules) {
      if (!index.has(rule.fromLocation)) {
        index.set(rule.fromLocation, []);
      }
      index.get(rule.fromLocation).push(rule);
    }

    return index;
  }

  /**
   * 最短経路を検索
   * @param {string} fromLocationId - 出発拠点ID
   * @param {string} toLocationId - 到着拠点ID
   * @param {Date} searchDate - 検索基準日
   * @returns {Object} 検索結果
   */
  search(fromLocationId, toLocationId, searchDate) {
    // バリデーション
    if (!this.locations.has(fromLocationId)) {
      return {
        success: false,
        error: `出発拠点「${fromLocationId}」が見つかりません`
      };
    }
    if (!this.locations.has(toLocationId)) {
      return {
        success: false,
        error: `到着拠点「${toLocationId}」が見つかりません`
      };
    }
    if (fromLocationId === toLocationId) {
      return {
        success: true,
        arrivalDate: formatDate(searchDate),
        route: [{
          location: fromLocationId,
          locationName: this.locations.get(fromLocationId).name,
          date: formatDate(searchDate),
          action: '出発地点 = 到着地点'
        }],
        message: '出発拠点と到着拠点が同じです'
      };
    }

    // BFS（幅優先探索）で最短経路を探索
    const baseDate = parseDate(searchDate);
    const maxDate = addDays(baseDate, CONFIG.MAX_SEARCH_DAYS);

    // 状態: {location: 拠点ID, date: 日付, path: 経路履歴}
    const queue = [];
    const visited = new Set();  // "拠点ID_日付" 形式で訪問済みを管理

    // 初期状態：出発拠点の次の稼働日から開始
    const startDate = this.calendarChecker.findNextOperatingDay(fromLocationId, baseDate);
    if (!startDate) {
      return {
        success: false,
        error: `出発拠点「${this.locations.get(fromLocationId).name}」の稼働日が見つかりません（${CONFIG.MAX_SEARCH_DAYS}日以内）`
      };
    }

    queue.push({
      location: fromLocationId,
      date: startDate,
      path: [{
        location: fromLocationId,
        locationName: this.locations.get(fromLocationId).name,
        date: formatDate(startDate),
        action: '出発'
      }]
    });
    visited.add(`${fromLocationId}_${formatDate(startDate)}`);

    while (queue.length > 0) {
      const current = queue.shift();

      // 探索日数上限チェック
      if (current.date > maxDate) {
        continue;
      }

      // この拠点から出発可能なルールを取得
      const availableRules = this.rulesByOrigin.get(current.location) || [];

      for (const rule of availableRules) {
        // この日付がルールの積み込み曜日と一致するか確認
        const currentWeekday = current.date.getDay();

        if (currentWeekday === rule.loadWeekday) {
          // 積み込み曜日が一致 - この拠点が稼働しているか確認
          if (!this.calendarChecker.isOperatingDay(current.location, current.date)) {
            continue;  // 非稼働日はスキップ
          }

          // 到着日を計算
          const arrivalDate = this.calculateArrivalDate(current.date, rule.loadWeekday, rule.arrivalWeekday);

          // 到着拠点が稼働しているか確認
          if (!this.calendarChecker.isOperatingDay(rule.toLocation, arrivalDate)) {
            continue;  // 到着拠点が非稼働日はスキップ
          }

          // 目的地に到着した場合
          if (rule.toLocation === toLocationId) {
            const finalPath = [...current.path, {
              location: rule.toLocation,
              locationName: this.locations.get(rule.toLocation).name,
              date: formatDate(arrivalDate),
              action: '到着'
            }];

            return {
              success: true,
              arrivalDate: formatDate(arrivalDate),
              route: finalPath,
              routeLocations: finalPath.map(p => p.locationName),
              routeDates: finalPath.map(p => p.date),
              daysRequired: Math.ceil((arrivalDate - baseDate) / (1000 * 60 * 60 * 24)),
              message: `最短${formatDate(arrivalDate)}に到着可能です`
            };
          }

          // 中継地点の場合 - キューに追加
          const visitKey = `${rule.toLocation}_${formatDate(arrivalDate)}`;
          if (!visited.has(visitKey)) {
            visited.add(visitKey);

            const newPath = [...current.path, {
              location: rule.toLocation,
              locationName: this.locations.get(rule.toLocation).name,
              date: formatDate(arrivalDate),
              action: rule.sameDayTransfer ? '到着・積替' : '到着'
            }];

            // 同日積替可の場合は同じ日から次の便を探索
            // 同日積替不可の場合は翌日から探索
            const nextSearchDate = rule.sameDayTransfer ? arrivalDate : addDays(arrivalDate, 1);
            const nextOperatingDate = this.calendarChecker.findNextOperatingDay(rule.toLocation, nextSearchDate);

            if (nextOperatingDate && nextOperatingDate <= maxDate) {
              queue.push({
                location: rule.toLocation,
                date: nextOperatingDate,
                path: newPath
              });
            }
          }
        }
      }

      // 翌日も同じ拠点から探索を続ける（別の曜日のルールを試すため）
      const nextDay = addDays(current.date, 1);
      const nextVisitKey = `${current.location}_${formatDate(nextDay)}`;

      if (!visited.has(nextVisitKey) && nextDay <= maxDate) {
        const nextOperatingDate = this.calendarChecker.findNextOperatingDay(current.location, nextDay);

        if (nextOperatingDate && nextOperatingDate <= maxDate) {
          const nextKey = `${current.location}_${formatDate(nextOperatingDate)}`;
          if (!visited.has(nextKey)) {
            visited.add(nextKey);
            queue.push({
              location: current.location,
              date: nextOperatingDate,
              path: current.path
            });
          }
        }
      }
    }

    // 到達不可
    return {
      success: false,
      error: `${this.locations.get(fromLocationId).name} から ${this.locations.get(toLocationId).name} への経路が見つかりません（${CONFIG.MAX_SEARCH_DAYS}日以内）`
    };
  }

  /**
   * 到着日を計算
   * @param {Date} loadDate - 積み込み日
   * @param {number} loadWeekday - 積み込み曜日
   * @param {number} arrivalWeekday - 到着曜日
   * @returns {Date} 到着日
   */
  calculateArrivalDate(loadDate, loadWeekday, arrivalWeekday) {
    // 同じ曜日の場合、同日到着とみなす
    if (loadWeekday === arrivalWeekday) {
      return new Date(loadDate);
    }

    // 到着曜日までの日数を計算
    let daysToArrival = (arrivalWeekday - loadWeekday + 7) % 7;
    if (daysToArrival === 0) {
      daysToArrival = 7;  // 翌週
    }

    return addDays(loadDate, daysToArrival);
  }

  /**
   * 拠点間の直行便があるかチェック
   * @param {string} fromLocationId - 出発拠点ID
   * @param {string} toLocationId - 到着拠点ID
   * @returns {Array<Object>} 該当するルール一覧
   */
  getDirectRoutes(fromLocationId, toLocationId) {
    const rules = this.rulesByOrigin.get(fromLocationId) || [];
    return rules.filter(r => r.toLocation === toLocationId);
  }

  /**
   * 指定拠点から出発可能な全ルートを取得
   * @param {string} locationId - 拠点ID
   * @returns {Array<Object>} ルール一覧
   */
  getRoutesFrom(locationId) {
    return this.rulesByOrigin.get(locationId) || [];
  }
}

/**
 * RouteSearchEngineのインスタンスを作成
 * @param {Object} data - loadAllData()で取得したデータ
 * @returns {RouteSearchEngine} インスタンス
 */
function createSearchEngine(data) {
  return new RouteSearchEngine(data);
}

/**
 * 経路検索を実行（APIエンドポイント用）
 * @param {string} fromLocationId - 出発拠点ID
 * @param {string} toLocationId - 到着拠点ID
 * @param {string} searchDateStr - 検索基準日（YYYY-MM-DD形式）
 * @returns {Object} 検索結果
 */
function searchRoute(fromLocationId, toLocationId, searchDateStr) {
  try {
    const data = loadAllData();
    const engine = createSearchEngine(data);
    const searchDate = parseDate(searchDateStr);

    return engine.search(fromLocationId, toLocationId, searchDate);
  } catch (e) {
    return {
      success: false,
      error: `検索中にエラーが発生しました: ${e.message}`
    };
  }
}
