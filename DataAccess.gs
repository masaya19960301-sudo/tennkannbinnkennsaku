/**
 * 店間便・拠点間移動 到着日検索Webアプリ
 * データアクセス層 - スプレッドシートからのデータ読み込み
 */

/**
 * スプレッドシートを取得
 * @returns {Spreadsheet} スプレッドシートオブジェクト
 */
function getSpreadsheet() {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  // IDが未設定の場合はアクティブなスプレッドシートを使用
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * シートからデータを取得（ヘッダー行を除く）
 * @param {string} sheetName - シート名
 * @returns {Array<Array>} データ配列
 */
function getSheetData(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`シート「${sheetName}」が見つかりません`);
  }
  const data = sheet.getDataRange().getValues();
  // ヘッダー行を除いて返す
  return data.slice(1);
}

/**
 * 全データを一括読み込み
 * @returns {Object} 全テーブルデータ
 */
function loadAllData() {
  const data = {
    locations: loadLocations(),
    transferRules: loadTransferRules(),
    locationWeekdays: loadLocationWeekdays(),
    locationCalendar: loadLocationCalendar(),
    holidays: loadHolidays()
  };
  return data;
}

/**
 * 拠点マスタを読み込み
 * @returns {Map<string, Object>} 拠点ID -> 拠点情報のマップ
 */
function loadLocations() {
  const rows = getSheetData(CONFIG.SHEETS.LOCATIONS);
  const locations = new Map();

  for (const row of rows) {
    const id = String(row[CONFIG.LOCATION_COLS.ID]).trim();
    if (!id) continue;

    // 併設先拠点ID（空欄の場合は空文字）
    const colocated = String(row[CONFIG.LOCATION_COLS.COLOCATED] || '').trim();

    locations.set(id, {
      id: id,
      name: String(row[CONFIG.LOCATION_COLS.NAME]).trim(),
      type: String(row[CONFIG.LOCATION_COLS.TYPE]).trim(),
      colocated: colocated  // 併設先拠点ID
    });
  }

  return locations;
}

/**
 * 積み込み・移動ルールを読み込み
 * @returns {Array<Object>} 移動ルール配列
 */
function loadTransferRules() {
  const rows = getSheetData(CONFIG.SHEETS.TRANSFER_RULES);
  const rules = [];

  for (const row of rows) {
    const fromLocation = String(row[CONFIG.TRANSFER_RULE_COLS.FROM_LOCATION]).trim();
    const toLocation = String(row[CONFIG.TRANSFER_RULE_COLS.TO_LOCATION]).trim();
    if (!fromLocation || !toLocation) continue;

    const loadWeekday = parseWeekday(row[CONFIG.TRANSFER_RULE_COLS.LOAD_WEEKDAY]);
    const arrivalWeekday = parseWeekday(row[CONFIG.TRANSFER_RULE_COLS.ARRIVAL_WEEKDAY]);

    if (loadWeekday === -1 || arrivalWeekday === -1) continue;

    // 同日積替可否の判定（「可」「○」「TRUE」「1」などを真とする）
    const sameDayValue = row[CONFIG.TRANSFER_RULE_COLS.SAME_DAY_TRANSFER];
    const sameDayTransfer = isTrueValue(sameDayValue);

    // 種別（店間便/店引）- 「店引」の場合は優先度が高い
    const transferTypeValue = row[CONFIG.TRANSFER_RULE_COLS.TRANSFER_TYPE];
    const transferType = String(transferTypeValue || '').trim();
    const isStorePickup = transferType === CONFIG.TRANSFER_TYPE.STORE_PICKUP;

    rules.push({
      fromLocation: fromLocation,
      loadWeekday: loadWeekday,
      toLocation: toLocation,
      arrivalWeekday: arrivalWeekday,
      sameDayTransfer: sameDayTransfer,
      transferType: transferType || CONFIG.TRANSFER_TYPE.INTER_STORE,  // デフォルトは店間便
      isStorePickup: isStorePickup  // 店引かどうかのフラグ
    });
  }

  return rules;
}

/**
 * 拠点別積み込み曜日を積み込み・移動ルールから自動計算
 * @returns {Map<string, Set<number>>} 拠点ID -> 稼働曜日セットのマップ
 */
function loadLocationWeekdays() {
  const rules = loadTransferRules();
  const weekdays = new Map();

  // 各ルールの出発拠点と積み込み曜日を収集
  for (const rule of rules) {
    const locationId = rule.fromLocation;
    const weekday = rule.loadWeekday;

    if (!weekdays.has(locationId)) {
      weekdays.set(locationId, new Set());
    }
    weekdays.get(locationId).add(weekday);
  }

  return weekdays;
}

/**
 * 拠点カレンダー（日付例外）を読み込み
 * @returns {Map<string, Object>} "拠点ID_日付" -> ステータスのマップ
 */
function loadLocationCalendar() {
  const rows = getSheetData(CONFIG.SHEETS.LOCATION_CALENDAR);
  const calendar = new Map();

  for (const row of rows) {
    const locationId = String(row[CONFIG.CALENDAR_COLS.LOCATION_ID]).trim();
    if (!locationId) continue;

    const dateValue = row[CONFIG.CALENDAR_COLS.DATE];
    if (!dateValue) continue;

    const date = parseDate(dateValue);
    const dateStr = formatDate(date);
    const status = String(row[CONFIG.CALENDAR_COLS.STATUS]).trim();

    const key = `${locationId}_${dateStr}`;
    calendar.set(key, {
      locationId: locationId,
      date: dateStr,
      status: status
    });
  }

  return calendar;
}

/**
 * 連休定義を読み込み（日付を展開）
 * @returns {Map<string, Set<string>>} 拠点ID -> 連休日付セットのマップ（"ALL"は全拠点共通）
 */
function loadHolidays() {
  const rows = getSheetData(CONFIG.SHEETS.HOLIDAYS);
  const holidays = new Map();

  for (const row of rows) {
    const startDate = row[CONFIG.HOLIDAY_COLS.START_DATE];
    const endDate = row[CONFIG.HOLIDAY_COLS.END_DATE];
    if (!startDate || !endDate) continue;

    const start = parseDate(startDate);
    const end = parseDate(endDate);

    // 対象拠点（空欄の場合は"ALL"として全拠点に適用）
    const locationId = String(row[CONFIG.HOLIDAY_COLS.LOCATION_ID] || '').trim() || 'ALL';

    if (!holidays.has(locationId)) {
      holidays.set(locationId, new Set());
    }

    // 期間内の全日付を展開
    let current = new Date(start);
    while (current <= end) {
      holidays.get(locationId).add(formatDate(current));
      current = addDays(current, 1);
    }
  }

  return holidays;
}

/**
 * 値が「真」を表すかどうかを判定
 * @param {any} value - 判定する値
 * @returns {boolean} 真の場合true
 */
function isTrueValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const str = String(value).trim().toLowerCase();
  return ['可', '○', '◯', 'true', '1', 'yes', 'ok'].includes(str);
}

/**
 * 拠点一覧を取得（UI用）
 * @returns {Array<Object>} 拠点一覧
 */
function getLocationList() {
  const locations = loadLocations();
  const list = [];

  for (const [id, loc] of locations) {
    // 併設先の拠点名を取得
    let colocatedName = '';
    if (loc.colocated && locations.has(loc.colocated)) {
      colocatedName = locations.get(loc.colocated).name;
    }

    list.push({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      colocated: loc.colocated || '',  // 併設先拠点ID
      colocatedName: colocatedName,     // 併設先拠点名
      displayName: `${loc.name}（${loc.id}）`
    });
  }

  // 拠点名でソート
  list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  return list;
}

// ==================== 書き込み機能 ====================

/**
 * 次の空き拠点IDを生成
 * @param {string} type - 種別（配送センター/店舗）
 * @returns {string} 新しい拠点ID
 */
function generateLocationId(type) {
  const locations = loadLocations();
  const prefix = type === '配送センター' ? 'DC' : 'ST';

  // 既存のIDから使用中の番号を収集
  const usedNumbers = new Set();
  for (const [id, loc] of locations) {
    if (id.startsWith(prefix)) {
      const numStr = id.substring(2);
      const num = parseInt(numStr, 10);
      if (!isNaN(num)) {
        usedNumbers.add(num);
      }
    }
  }

  // 空いている番号を探す（001から999まで）
  for (let i = 1; i <= 999; i++) {
    if (!usedNumbers.has(i)) {
      return prefix + String(i).padStart(3, '0');
    }
  }

  throw new Error('空き番号がありません');
}

/**
 * 拠点を追加
 * @param {Object} location - 拠点情報 {name, type}
 * @returns {Object} 追加結果
 */
function addLocation(location) {
  try {
    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEETS.LOCATIONS);
    if (!sheet) throw new Error('拠点マスタシートが見つかりません');

    // 拠点ID自動生成
    const newId = generateLocationId(location.type);

    // 最終行に追加（併設先も含む4列）
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, 1, 4).setValues([[
      newId,
      location.name,
      location.type,
      location.colocated || ''  // 併設先拠点ID
    ]]);

    return { success: true, id: newId, message: `拠点「${location.name}」を追加しました` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 拠点を更新
 * @param {Object} location - 拠点情報 {id, name, type}
 * @returns {Object} 更新結果
 */
function updateLocation(location) {
  try {
    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEETS.LOCATIONS);
    if (!sheet) throw new Error('拠点マスタシートが見つかりません');

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === location.id) {
        // 拠点名、種別、併設先の3列を更新
        sheet.getRange(i + 1, 2, 1, 3).setValues([[
          location.name,
          location.type,
          location.colocated || ''  // 併設先拠点ID
        ]]);
        return { success: true, message: `拠点「${location.name}」を更新しました` };
      }
    }

    return { success: false, error: '拠点が見つかりません' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 拠点を削除
 * @param {string} locationId - 拠点ID
 * @returns {Object} 削除結果
 */
function deleteLocation(locationId) {
  try {
    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEETS.LOCATIONS);
    if (!sheet) throw new Error('拠点マスタシートが見つかりません');

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === locationId) {
        sheet.deleteRow(i + 1);
        return { success: true, message: `拠点を削除しました` };
      }
    }

    return { success: false, error: '拠点が見つかりません' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * ルール一覧を取得（拠点名付き）
 * @param {string} locationId - 拠点ID（出発または到着）
 * @param {string} direction - 'from'（出発）または 'to'（到着）
 * @returns {Array<Object>} ルール一覧
 */
function getRulesForLocation(locationId, direction) {
  const rules = loadTransferRulesRaw();
  const locations = loadLocations();

  const filtered = rules.filter(rule => {
    if (direction === 'from') {
      return rule.fromLocation === locationId;
    } else {
      return rule.toLocation === locationId;
    }
  });

  // 拠点名を付加
  return filtered.map(rule => ({
    ...rule,
    fromLocationName: locations.get(rule.fromLocation)?.name || rule.fromLocation,
    toLocationName: locations.get(rule.toLocation)?.name || rule.toLocation,
    loadWeekdayName: CONFIG.WEEKDAY_NAMES[rule.loadWeekday],
    arrivalWeekdayName: CONFIG.WEEKDAY_NAMES[rule.arrivalWeekday]
  }));
}

/**
 * 積み込み・移動ルールを読み込み（行番号付き）
 * @returns {Array<Object>} 移動ルール配列（行番号付き）
 */
function loadTransferRulesRaw() {
  const rows = getSheetData(CONFIG.SHEETS.TRANSFER_RULES);
  const rules = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fromLocation = String(row[CONFIG.TRANSFER_RULE_COLS.FROM_LOCATION]).trim();
    const toLocation = String(row[CONFIG.TRANSFER_RULE_COLS.TO_LOCATION]).trim();
    if (!fromLocation || !toLocation) continue;

    const loadWeekday = parseWeekday(row[CONFIG.TRANSFER_RULE_COLS.LOAD_WEEKDAY]);
    const arrivalWeekday = parseWeekday(row[CONFIG.TRANSFER_RULE_COLS.ARRIVAL_WEEKDAY]);
    if (loadWeekday === -1 || arrivalWeekday === -1) continue;

    const sameDayValue = row[CONFIG.TRANSFER_RULE_COLS.SAME_DAY_TRANSFER];
    const sameDayTransfer = isTrueValue(sameDayValue);

    const transferTypeValue = row[CONFIG.TRANSFER_RULE_COLS.TRANSFER_TYPE];
    const transferType = String(transferTypeValue || '').trim();

    rules.push({
      rowIndex: i + 2,  // ヘッダー行 + 0始まりインデックス
      fromLocation: fromLocation,
      loadWeekday: loadWeekday,
      toLocation: toLocation,
      arrivalWeekday: arrivalWeekday,
      sameDayTransfer: sameDayTransfer,
      sameDayTransferText: sameDayTransfer ? '可' : '',
      transferType: transferType || ''
    });
  }

  return rules;
}

/**
 * ルールを追加
 * @param {Object} rule - ルール情報
 * @returns {Object} 追加結果
 */
function addRule(rule) {
  try {
    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEETS.TRANSFER_RULES);
    if (!sheet) throw new Error('積み込み・移動ルールシートが見つかりません');

    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, 1, 6).setValues([[
      rule.fromLocation,
      rule.loadWeekday,
      rule.toLocation,
      rule.arrivalWeekday,
      rule.sameDayTransfer ? '可' : '',
      rule.transferType || ''
    ]]);

    return { success: true, message: 'ルールを追加しました' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * ルールを更新
 * @param {Object} rule - ルール情報（rowIndex必須）
 * @returns {Object} 更新結果
 */
function updateRule(rule) {
  try {
    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEETS.TRANSFER_RULES);
    if (!sheet) throw new Error('積み込み・移動ルールシートが見つかりません');

    sheet.getRange(rule.rowIndex, 1, 1, 6).setValues([[
      rule.fromLocation,
      rule.loadWeekday,
      rule.toLocation,
      rule.arrivalWeekday,
      rule.sameDayTransfer ? '可' : '',
      rule.transferType || ''
    ]]);

    return { success: true, message: 'ルールを更新しました' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * ルールを削除
 * @param {number} rowIndex - 行番号
 * @returns {Object} 削除結果
 */
function deleteRule(rowIndex) {
  try {
    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEETS.TRANSFER_RULES);
    if (!sheet) throw new Error('積み込み・移動ルールシートが見つかりません');

    sheet.deleteRow(rowIndex);
    return { success: true, message: 'ルールを削除しました' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 全ルールを取得（管理画面用）
 * @returns {Array<Object>} ルール一覧
 */
function getAllRulesWithNames() {
  const rules = loadTransferRulesRaw();
  const locations = loadLocations();

  return rules.map(rule => ({
    ...rule,
    fromLocationName: locations.get(rule.fromLocation)?.name || rule.fromLocation,
    toLocationName: locations.get(rule.toLocation)?.name || rule.toLocation,
    loadWeekdayName: CONFIG.WEEKDAY_NAMES[rule.loadWeekday],
    arrivalWeekdayName: CONFIG.WEEKDAY_NAMES[rule.arrivalWeekday]
  }));
}
