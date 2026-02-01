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

    locations.set(id, {
      id: id,
      name: String(row[CONFIG.LOCATION_COLS.NAME]).trim(),
      type: String(row[CONFIG.LOCATION_COLS.TYPE]).trim()
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
 * 拠点別積み込み曜日（通常ルール）を読み込み
 * @returns {Map<string, Set<number>>} 拠点ID -> 稼働曜日セットのマップ
 */
function loadLocationWeekdays() {
  const rows = getSheetData(CONFIG.SHEETS.LOCATION_WEEKDAYS);
  const weekdays = new Map();

  for (const row of rows) {
    const locationId = String(row[CONFIG.LOCATION_WEEKDAY_COLS.LOCATION_ID]).trim();
    if (!locationId) continue;

    const weekday = parseWeekday(row[CONFIG.LOCATION_WEEKDAY_COLS.WEEKDAY]);
    if (weekday === -1) continue;

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
    list.push({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      displayName: `${loc.name}（${loc.id}）`
    });
  }

  // 拠点名でソート
  list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  return list;
}
