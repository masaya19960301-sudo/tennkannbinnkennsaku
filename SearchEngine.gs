/**
 * 店間便・拠点間移動 到着日検索Webアプリ
 * 経路探索エンジン
 *
 * 検索仕様:
 * - 到着日が最も早い経路を優先
 * - 同じ到着日なら経由数が最も少ない経路を優先
 * - 同日積替可の場合は到着当日に次工程へ進める
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
   * 優先順位: 1.到着日が早い 2.経由数が少ない
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

    const baseDate = parseDate(searchDate);
    const maxDate = addDays(baseDate, CONFIG.MAX_SEARCH_DAYS);

    // 最良の結果を保持（到着日が早い、同着なら経由数が少ない）
    let bestResult = null;

    // 状態: {location, date, path, hops}
    // 優先度付きキューの代わりに配列を使用し、到着日順にソートして処理
    const queue = [];

    // 訪問済み管理: "拠点ID_日付" -> 最小経由数
    const visited = new Map();

    // 初期状態：検索基準日から探索開始
    // 出発拠点の各稼働日を初期キューに追加
    for (let d = 0; d < CONFIG.MAX_SEARCH_DAYS; d++) {
      const checkDate = addDays(baseDate, d);
      if (this.calendarChecker.isOperatingDay(fromLocationId, checkDate)) {
        const dateStr = formatDate(checkDate);
        queue.push({
          location: fromLocationId,
          date: checkDate,
          path: [{
            location: fromLocationId,
            locationName: this.locations.get(fromLocationId).name,
            date: dateStr,
            action: '出発'
          }],
          hops: 0
        });
        visited.set(`${fromLocationId}_${dateStr}`, 0);
      }
    }

    // キューを日付順にソート
    queue.sort((a, b) => a.date - b.date);

    while (queue.length > 0) {
      const current = queue.shift();

      // 枝刈り: 既に見つかった最良解より遅い場合はスキップ
      if (bestResult) {
        const bestArrival = parseDate(bestResult.arrivalDate);
        if (current.date > bestArrival) {
          continue;
        }
      }

      // 探索日数上限チェック
      if (current.date > maxDate) {
        continue;
      }

      // この拠点から出発可能なルールを取得
      const availableRules = this.rulesByOrigin.get(current.location) || [];
      const currentWeekday = current.date.getDay();

      for (const rule of availableRules) {
        // この日付がルールの積み込み曜日と一致するか確認
        if (currentWeekday !== rule.loadWeekday) {
          continue;
        }

        // 積み込み曜日が一致 - この拠点が稼働しているか確認
        if (!this.calendarChecker.isOperatingDay(current.location, current.date)) {
          continue;
        }

        // 到着日を計算
        const arrivalDate = this.calculateArrivalDate(current.date, rule.loadWeekday, rule.arrivalWeekday);

        // 到着拠点が稼働しているか確認
        if (!this.calendarChecker.isOperatingDay(rule.toLocation, arrivalDate)) {
          continue;
        }

        // 枝刈り: 既に見つかった最良解より遅い場合はスキップ
        if (bestResult) {
          const bestArrival = parseDate(bestResult.arrivalDate);
          if (arrivalDate > bestArrival) {
            continue;
          }
          // 同じ到着日で経由数が多い場合もスキップ
          if (arrivalDate.getTime() === bestArrival.getTime() &&
              current.hops + 1 >= bestResult.route.length - 1) {
            continue;
          }
        }

        const newHops = current.hops + 1;

        // 目的地に到着した場合
        if (rule.toLocation === toLocationId) {
          const finalPath = [...current.path, {
            location: rule.toLocation,
            locationName: this.locations.get(rule.toLocation).name,
            date: formatDate(arrivalDate),
            action: '到着'
          }];

          const newResult = {
            success: true,
            arrivalDate: formatDate(arrivalDate),
            route: finalPath,
            routeLocations: finalPath.map(p => p.locationName),
            routeDates: finalPath.map(p => p.date),
            daysRequired: Math.ceil((arrivalDate - baseDate) / (1000 * 60 * 60 * 24)),
            message: `最短${formatDate(arrivalDate)}に到着可能です`
          };

          // 最良解の更新判定
          if (!bestResult || this.isBetterResult(newResult, bestResult)) {
            bestResult = newResult;
          }
          continue;
        }

        // 中継地点の場合
        const newPath = [...current.path, {
          location: rule.toLocation,
          locationName: this.locations.get(rule.toLocation).name,
          date: formatDate(arrivalDate),
          action: rule.sameDayTransfer ? '到着・積替' : '到着'
        }];

        // 同日積替可の場合は同じ日から次の便を探索
        // 同日積替不可の場合は翌日から探索
        const nextSearchDate = rule.sameDayTransfer ? arrivalDate : addDays(arrivalDate, 1);

        // この中継地点から出発可能な全ルールについて、次の出発日を計算
        const outboundRules = this.rulesByOrigin.get(rule.toLocation) || [];
        const addedDates = new Set();  // 同じ日付の重複追加を防止

        for (const outRule of outboundRules) {
          // このルールの積み込み曜日に合わせた次の出発日を計算
          const nextDepartureDate = this.getNextWeekdayDate(nextSearchDate, outRule.loadWeekday);

          if (nextDepartureDate > maxDate) continue;

          const dateStr = formatDate(nextDepartureDate);
          if (addedDates.has(dateStr)) continue;  // 同じ日付は1回だけ追加

          // その日が稼働日かどうか確認
          if (!this.calendarChecker.isOperatingDay(rule.toLocation, nextDepartureDate)) {
            continue;
          }

          const nextKey = `${rule.toLocation}_${dateStr}`;
          const nextExistingHops = visited.get(nextKey);

          if (nextExistingHops === undefined || newHops < nextExistingHops) {
            visited.set(nextKey, newHops);
            queue.push({
              location: rule.toLocation,
              date: nextDepartureDate,
              path: newPath,
              hops: newHops
            });
            addedDates.add(dateStr);
          }
        }
      }

      // キューを再ソート（日付順、同日なら経由数順）
      queue.sort((a, b) => {
        const dateDiff = a.date - b.date;
        if (dateDiff !== 0) return dateDiff;
        return a.hops - b.hops;
      });
    }

    if (bestResult) {
      return bestResult;
    }

    // 到達不可
    return {
      success: false,
      error: `${this.locations.get(fromLocationId).name} から ${this.locations.get(toLocationId).name} への経路が見つかりません（${CONFIG.MAX_SEARCH_DAYS}日以内）`
    };
  }

  /**
   * 新しい結果が既存の最良解より良いかどうかを判定
   * @param {Object} newResult - 新しい結果
   * @param {Object} bestResult - 現在の最良解
   * @returns {boolean} 新しい結果の方が良い場合true
   */
  isBetterResult(newResult, bestResult) {
    const newArrival = parseDate(newResult.arrivalDate);
    const bestArrival = parseDate(bestResult.arrivalDate);

    // 到着日が早い方が良い
    if (newArrival < bestArrival) {
      return true;
    }

    // 同じ到着日なら経由数が少ない方が良い
    if (newArrival.getTime() === bestArrival.getTime()) {
      return newResult.route.length < bestResult.route.length;
    }

    return false;
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
   * 指定日以降の、指定曜日の最初の日付を取得
   * @param {Date} baseDate - 基準日
   * @param {number} targetWeekday - 目標曜日（0:日〜6:土）
   * @returns {Date} 次の指定曜日の日付
   */
  getNextWeekdayDate(baseDate, targetWeekday) {
    const current = new Date(baseDate);
    const currentWeekday = current.getDay();

    let daysToAdd = (targetWeekday - currentWeekday + 7) % 7;
    // 同じ曜日の場合は当日を返す
    return addDays(current, daysToAdd);
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
