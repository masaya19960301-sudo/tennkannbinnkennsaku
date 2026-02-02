/**
 * 店間便・拠点間移動 到着日検索Webアプリ
 * メインエントリーポイント
 *
 * Google Apps Script Webアプリとしてデプロイして使用
 */

/**
 * Webアプリのエントリーポイント（GET）
 * @param {Object} e - イベントオブジェクト
 * @returns {HtmlOutput} HTMLページ
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('店間便 到着日検索')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 拠点一覧を取得（UI呼び出し用）
 * @returns {Array<Object>} 拠点一覧
 */
function getLocations() {
  try {
    return getLocationList();
  } catch (e) {
    console.error('拠点一覧取得エラー:', e);
    return [];
  }
}

/**
 * 経路検索を実行（UI呼び出し用）
 * @param {string} fromLocationId - 出発拠点ID
 * @param {string} toLocationId - 到着拠点ID
 * @param {string} searchDateStr - 検索基準日（YYYY-MM-DD形式）
 * @returns {Object} 検索結果
 */
function executeSearch(fromLocationId, toLocationId, searchDateStr) {
  try {
    // 入力バリデーション
    if (!fromLocationId || !toLocationId || !searchDateStr) {
      return {
        success: false,
        error: '出発拠点、到着拠点、検索基準日をすべて入力してください'
      };
    }

    // 日付の妥当性チェック
    const searchDate = parseDate(searchDateStr);
    if (isNaN(searchDate.getTime())) {
      return {
        success: false,
        error: '検索基準日の形式が正しくありません'
      };
    }

    // 経路検索を実行
    return searchRoute(fromLocationId, toLocationId, searchDateStr);

  } catch (e) {
    console.error('検索実行エラー:', e);
    return {
      success: false,
      error: `検索中にエラーが発生しました: ${e.message}`
    };
  }
}

/**
 * 拠点の稼働状況を取得（デバッグ・管理用）
 * @param {string} locationId - 拠点ID
 * @param {string} startDateStr - 開始日
 * @param {number} days - 日数
 * @returns {Array<Object>} 稼働状況一覧
 */
function getLocationSchedule(locationId, startDateStr, days = 14) {
  try {
    const data = loadAllData();
    const checker = createCalendarChecker(data);
    const startDate = parseDate(startDateStr);
    const schedule = [];

    for (let i = 0; i < days; i++) {
      const date = addDays(startDate, i);
      const status = checker.getOperatingStatus(locationId, date);

      schedule.push({
        date: formatDate(date),
        weekday: CONFIG.WEEKDAY_NAMES[date.getDay()],
        isOperating: status.isOperating,
        reason: status.reason
      });
    }

    return schedule;
  } catch (e) {
    console.error('スケジュール取得エラー:', e);
    return [];
  }
}

/**
 * サンプルデータを作成（初期設定用）
 * 既存のシートがない場合に呼び出すとサンプルシートを作成
 */
function createSampleData() {
  const ss = getSpreadsheet();

  // 拠点マスタ
  let sheet = ss.getSheetByName(CONFIG.SHEETS.LOCATIONS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.LOCATIONS);
    sheet.getRange(1, 1, 1, 3).setValues([['拠点ID', '拠点名', '種別']]);
    sheet.getRange(2, 1, 5, 3).setValues([
      ['DC001', '東京DC', '配送センター'],
      ['DC002', '大阪DC', '配送センター'],
      ['DC003', '名古屋DC', '配送センター'],
      ['ST001', '新宿店', '店舗'],
      ['ST002', '梅田店', '店舗']
    ]);
  }

  // 積み込み・移動ルール
  sheet = ss.getSheetByName(CONFIG.SHEETS.TRANSFER_RULES);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.TRANSFER_RULES);
    sheet.getRange(1, 1, 1, 5).setValues([['出発拠点', '積み込み曜日', '到着拠点', '到着曜日', '同日積替可否']]);
    sheet.getRange(2, 1, 8, 5).setValues([
      ['DC001', '月', 'DC002', '火', '可'],
      ['DC001', '水', 'DC003', '木', '可'],
      ['DC002', '火', 'DC003', '水', '可'],
      ['DC002', '木', 'ST002', '金', ''],
      ['DC003', '水', 'DC001', '木', '可'],
      ['DC003', '金', 'ST001', '土', ''],
      ['DC001', '金', 'ST001', '土', ''],
      ['DC002', '月', 'DC001', '火', '可']
    ]);
  }

  // 拠点別積み込み曜日
  sheet = ss.getSheetByName(CONFIG.SHEETS.LOCATION_WEEKDAYS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.LOCATION_WEEKDAYS);
    sheet.getRange(1, 1, 1, 2).setValues([['拠点ID', '曜日']]);
    sheet.getRange(2, 1, 15, 2).setValues([
      ['DC001', '月'], ['DC001', '火'], ['DC001', '水'], ['DC001', '木'], ['DC001', '金'],
      ['DC002', '月'], ['DC002', '火'], ['DC002', '木'], ['DC002', '金'],
      ['DC003', '月'], ['DC003', '水'], ['DC003', '木'], ['DC003', '金'],
      ['ST001', '土'], ['ST002', '金']
    ]);
  }

  // 拠点カレンダー
  sheet = ss.getSheetByName(CONFIG.SHEETS.LOCATION_CALENDAR);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.LOCATION_CALENDAR);
    sheet.getRange(1, 1, 1, 3).setValues([['拠点ID', '日付', 'ステータス']]);
    // サンプルデータは空で作成（必要に応じて追加）
  }

  // 連休定義
  sheet = ss.getSheetByName(CONFIG.SHEETS.HOLIDAYS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.HOLIDAYS);
    sheet.getRange(1, 1, 1, 4).setValues([['連休名', '開始日', '終了日', '対象拠点ID']]);
    // サンプルデータは空で作成（必要に応じて追加）
  }

  return 'サンプルデータを作成しました';
}

// ==================== 管理機能API ====================

/**
 * 拠点を追加（UI呼び出し用）
 */
function apiAddLocation(name, type) {
  return addLocation({ name: name, type: type });
}

/**
 * 拠点を更新（UI呼び出し用）
 */
function apiUpdateLocation(id, name, type) {
  return updateLocation({ id: id, name: name, type: type });
}

/**
 * 拠点を削除（UI呼び出し用）
 */
function apiDeleteLocation(locationId) {
  return deleteLocation(locationId);
}

/**
 * 指定拠点のルール一覧を取得（UI呼び出し用）
 * @param {string} locationId - 拠点ID
 * @param {string} direction - 'from'（出発）または 'to'（到着）
 */
function apiGetRulesForLocation(locationId, direction) {
  try {
    return {
      success: true,
      rules: getRulesForLocation(locationId, direction)
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 全ルール一覧を取得（UI呼び出し用）
 */
function apiGetAllRules() {
  try {
    return {
      success: true,
      rules: getAllRulesWithNames()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * ルールを追加（UI呼び出し用）
 */
function apiAddRule(fromLocation, loadWeekday, toLocation, arrivalWeekday, sameDayTransfer, transferType) {
  return addRule({
    fromLocation: fromLocation,
    loadWeekday: loadWeekday,
    toLocation: toLocation,
    arrivalWeekday: arrivalWeekday,
    sameDayTransfer: sameDayTransfer,
    transferType: transferType
  });
}

/**
 * ルールを更新（UI呼び出し用）
 */
function apiUpdateRule(rowIndex, fromLocation, loadWeekday, toLocation, arrivalWeekday, sameDayTransfer, transferType) {
  return updateRule({
    rowIndex: rowIndex,
    fromLocation: fromLocation,
    loadWeekday: loadWeekday,
    toLocation: toLocation,
    arrivalWeekday: arrivalWeekday,
    sameDayTransfer: sameDayTransfer,
    transferType: transferType
  });
}

/**
 * ルールを削除（UI呼び出し用）
 */
function apiDeleteRule(rowIndex) {
  return deleteRule(rowIndex);
}

/**
 * 曜日一覧を取得（UI呼び出し用）
 */
function apiGetWeekdays() {
  return CONFIG.WEEKDAY_NAMES.map((name, index) => ({
    value: name,
    index: index
  }));
}

/**
 * テスト用：経路検索のテスト実行
 */
function testSearch() {
  const result = executeSearch('DC001', 'ST002', '2025-01-06');
  console.log(JSON.stringify(result, null, 2));
}

/**
 * テスト用：拠点一覧のテスト
 */
function testGetLocations() {
  const locations = getLocations();
  console.log(JSON.stringify(locations, null, 2));
}
