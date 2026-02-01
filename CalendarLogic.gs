/**
 * 店間便・拠点間移動 到着日検索Webアプリ
 * カレンダーロジック - 稼働日判定
 *
 * 優先順位ルール:
 * ① 拠点カレンダー（日付例外）
 * ② 連休設定
 * ③ 通常の曜日ルール
 */

/**
 * 稼働日判定クラス
 */
class CalendarChecker {
  /**
   * @param {Object} data - loadAllData()で取得したデータ
   */
  constructor(data) {
    this.locationCalendar = data.locationCalendar;  // 拠点カレンダー（日付例外）
    this.holidays = data.holidays;                   // 連休定義
    this.locationWeekdays = data.locationWeekdays;   // 拠点別積み込み曜日
  }

  /**
   * 指定日が拠点の稼働日かどうかを判定
   * @param {string} locationId - 拠点ID
   * @param {Date} date - 判定日
   * @returns {boolean} 稼働日ならtrue
   */
  isOperatingDay(locationId, date) {
    const dateStr = formatDate(date);
    const weekday = date.getDay();

    // ① 拠点カレンダー（日付例外）をチェック - 最優先
    const calendarKey = `${locationId}_${dateStr}`;
    if (this.locationCalendar.has(calendarKey)) {
      const calendarEntry = this.locationCalendar.get(calendarKey);
      const status = calendarEntry.status;

      // 振替稼働または臨時稼働なら稼働日
      if (status === CONFIG.CALENDAR_STATUS.SUBSTITUTE ||
          status === CONFIG.CALENDAR_STATUS.TEMPORARY) {
        return true;
      }
      // 休業なら非稼働日
      if (status === CONFIG.CALENDAR_STATUS.CLOSED) {
        return false;
      }
    }

    // ② 連休設定をチェック
    // 拠点固有の連休
    if (this.holidays.has(locationId)) {
      if (this.holidays.get(locationId).has(dateStr)) {
        return false;  // 連休中は非稼働
      }
    }
    // 全拠点共通の連休
    if (this.holidays.has('ALL')) {
      if (this.holidays.get('ALL').has(dateStr)) {
        return false;  // 連休中は非稼働
      }
    }

    // ③ 通常の曜日ルールをチェック
    if (this.locationWeekdays.has(locationId)) {
      return this.locationWeekdays.get(locationId).has(weekday);
    }

    // 曜日ルールが未設定の場合は稼働日とみなす
    return true;
  }

  /**
   * 指定日から次の稼働日を探す
   * @param {string} locationId - 拠点ID
   * @param {Date} startDate - 開始日
   * @param {number} maxDays - 最大探索日数
   * @returns {Date|null} 次の稼働日、見つからない場合はnull
   */
  findNextOperatingDay(locationId, startDate, maxDays = CONFIG.MAX_SEARCH_DAYS) {
    let current = new Date(startDate);

    for (let i = 0; i < maxDays; i++) {
      if (this.isOperatingDay(locationId, current)) {
        return current;
      }
      current = addDays(current, 1);
    }

    return null;  // 見つからなかった
  }

  /**
   * 指定曜日の次の日付を取得
   * @param {Date} baseDate - 基準日
   * @param {number} targetWeekday - 目標曜日（0:日〜6:土）
   * @param {boolean} includeToday - 基準日を含むかどうか
   * @returns {Date} 次の指定曜日の日付
   */
  getNextWeekday(baseDate, targetWeekday, includeToday = true) {
    const current = new Date(baseDate);
    const currentWeekday = current.getDay();

    let daysToAdd;
    if (includeToday && currentWeekday === targetWeekday) {
      daysToAdd = 0;
    } else {
      daysToAdd = (targetWeekday - currentWeekday + 7) % 7;
      if (daysToAdd === 0) {
        daysToAdd = 7;  // 翌週の同じ曜日
      }
    }

    return addDays(current, daysToAdd);
  }

  /**
   * 指定日の稼働状況の詳細を取得
   * @param {string} locationId - 拠点ID
   * @param {Date} date - 判定日
   * @returns {Object} 稼働状況の詳細
   */
  getOperatingStatus(locationId, date) {
    const dateStr = formatDate(date);
    const weekday = date.getDay();
    const weekdayName = CONFIG.WEEKDAY_NAMES[weekday];

    // 拠点カレンダーの確認
    const calendarKey = `${locationId}_${dateStr}`;
    if (this.locationCalendar.has(calendarKey)) {
      const entry = this.locationCalendar.get(calendarKey);
      return {
        isOperating: entry.status !== CONFIG.CALENDAR_STATUS.CLOSED,
        reason: `拠点カレンダー: ${entry.status}`,
        priority: 1
      };
    }

    // 連休の確認
    const isHoliday = (this.holidays.has(locationId) && this.holidays.get(locationId).has(dateStr)) ||
                      (this.holidays.has('ALL') && this.holidays.get('ALL').has(dateStr));
    if (isHoliday) {
      return {
        isOperating: false,
        reason: '連休期間',
        priority: 2
      };
    }

    // 通常曜日ルール
    const hasWeekdayRule = this.locationWeekdays.has(locationId);
    const isWeekdayOperating = hasWeekdayRule ?
      this.locationWeekdays.get(locationId).has(weekday) : true;

    return {
      isOperating: isWeekdayOperating,
      reason: hasWeekdayRule ?
        (isWeekdayOperating ? `通常稼働日（${weekdayName}曜日）` : `通常休業日（${weekdayName}曜日）`) :
        '曜日ルール未設定（稼働扱い）',
      priority: 3
    };
  }
}

/**
 * CalendarCheckerのインスタンスを作成
 * @param {Object} data - loadAllData()で取得したデータ
 * @returns {CalendarChecker} インスタンス
 */
function createCalendarChecker(data) {
  return new CalendarChecker(data);
}
