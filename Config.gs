/**
 * 店間便・拠点間移動 到着日検索Webアプリ
 * 設定定数
 */

const CONFIG = {
  // 探索日数上限（無限ループ防止）
  MAX_SEARCH_DAYS: 60,

  // スプレッドシートID（実際のIDに置き換えてください）
  SPREADSHEET_ID: '',

  // シート名
  SHEETS: {
    LOCATIONS: '拠点マスタ',
    TRANSFER_RULES: '積み込み・移動ルール',
    LOCATION_WEEKDAYS: '拠点別積み込み曜日',
    LOCATION_CALENDAR: '拠点カレンダー',
    HOLIDAYS: '連休定義'
  },

  // 拠点マスタのカラム
  LOCATION_COLS: {
    ID: 0,        // 拠点ID
    NAME: 1,      // 拠点名
    TYPE: 2,      // 種別
    COLOCATED: 3  // 併設先拠点ID（空欄可）
  },

  // 積み込み・移動ルールのカラム
  TRANSFER_RULE_COLS: {
    FROM_LOCATION: 0,      // 出発拠点
    LOAD_WEEKDAY: 1,       // 積み込み曜日
    TO_LOCATION: 2,        // 到着拠点
    ARRIVAL_WEEKDAY: 3,    // 到着曜日
    SAME_DAY_TRANSFER: 4,  // 同日積替可否
    TRANSFER_TYPE: 5       // 種別（店間便/店引）
  },

  // 移動種別
  TRANSFER_TYPE: {
    STORE_PICKUP: '店引',    // 店引（優先）
    INTER_STORE: '店間便'    // 店間便
  },

  // 拠点別積み込み曜日のカラム
  LOCATION_WEEKDAY_COLS: {
    LOCATION_ID: 0,    // 拠点ID
    WEEKDAY: 1         // 曜日（0:日〜6:土）
  },

  // 拠点カレンダーのカラム
  CALENDAR_COLS: {
    LOCATION_ID: 0,    // 拠点ID
    DATE: 1,           // 日付
    STATUS: 2          // ステータス（休業/振替稼働/臨時稼働）
  },

  // 連休定義のカラム
  HOLIDAY_COLS: {
    NAME: 0,           // 連休名
    START_DATE: 1,     // 開始日
    END_DATE: 2,       // 終了日
    LOCATION_ID: 3     // 対象拠点ID（空欄の場合は全拠点）
  },

  // カレンダーステータス
  CALENDAR_STATUS: {
    CLOSED: '休業',
    SUBSTITUTE: '振替稼働',
    TEMPORARY: '臨時稼働'
  },

  // 曜日マッピング（日本語 -> 数値）
  WEEKDAY_MAP: {
    '日': 0, '日曜': 0, '日曜日': 0,
    '月': 1, '月曜': 1, '月曜日': 1,
    '火': 2, '火曜': 2, '火曜日': 2,
    '水': 3, '水曜': 3, '水曜日': 3,
    '木': 4, '木曜': 4, '木曜日': 4,
    '金': 5, '金曜': 5, '金曜日': 5,
    '土': 6, '土曜': 6, '土曜日': 6
  },

  // 曜日名（数値 -> 日本語）
  WEEKDAY_NAMES: ['日', '月', '火', '水', '木', '金', '土']
};

/**
 * 曜日文字列を数値に変換
 * @param {string} weekdayStr - 曜日文字列
 * @returns {number} 曜日数値（0:日〜6:土）、変換失敗時は-1
 */
function parseWeekday(weekdayStr) {
  if (typeof weekdayStr === 'number') {
    return weekdayStr >= 0 && weekdayStr <= 6 ? weekdayStr : -1;
  }
  const str = String(weekdayStr).trim();
  return CONFIG.WEEKDAY_MAP[str] !== undefined ? CONFIG.WEEKDAY_MAP[str] : -1;
}

/**
 * 日付を文字列形式に変換（YYYY-MM-DD）
 * @param {Date} date - 日付オブジェクト
 * @returns {string} 日付文字列
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 日付文字列をDateオブジェクトに変換
 * @param {string|Date} dateInput - 日付文字列またはDateオブジェクト
 * @returns {Date} Dateオブジェクト
 */
function parseDate(dateInput) {
  if (dateInput instanceof Date) {
    return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
  }
  const parts = String(dateInput).split(/[-\/]/);
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

/**
 * 日付に日数を加算
 * @param {Date} date - 基準日
 * @param {number} days - 加算日数
 * @returns {Date} 加算後の日付
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
