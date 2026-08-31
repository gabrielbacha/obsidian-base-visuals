import { moment } from 'obsidian';

export type NumericDateOrder = 'day-first' | 'month-first' | 'locale';

export const DATE_FORMAT_PRESETS = [
	{ format: 'DD MMM YYYY', label: 'Day month year' },
	{ format: 'MMM-YY', label: 'Month and short year' },
	{ format: 'MMM YYYY', label: 'Month and year' },
	{ format: 'YYYY-MM-DD', label: 'ISO date' },
] as const;

const NUMERIC_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

export function formatDateText(
	value: string,
	format: string,
	order: NumericDateOrder = 'locale',
): string | null {
	const parsed = parseDateText(value, order);
	return parsed ? parsed.format(format) : null;
}

export function parseDateText(value: string, order: NumericDateOrder = 'locale'): ReturnType<typeof moment> | null {
	const source = value.trim();
	if (!source) return null;
	const iso = moment(source, moment.ISO_8601, true);
	if (iso.isValid()) return iso;

	const numeric = NUMERIC_DATE.exec(source);
	if (numeric) {
		const first = Number(numeric[1]);
		const second = Number(numeric[2]);
		const year = Number(numeric[3]);
		const resolvedOrder = resolveNumericOrder(first, second, order);
		const day = resolvedOrder === 'day-first' ? first : second;
		const month = resolvedOrder === 'day-first' ? second : first;
		const parsed = moment({ year, month: month - 1, date: day });
		if (parsed.isValid() && parsed.year() === year && parsed.month() === month - 1 && parsed.date() === day) {
			return parsed;
		}
		return null;
	}

	const localeFormats = [
		moment.localeData().longDateFormat('L'),
		moment.localeData().longDateFormat('LL'),
		'D MMM YYYY',
		'D MMMM YYYY',
	];
	const localized = moment(source, localeFormats, true);
	return localized.isValid() ? localized : null;
}

export function inferNumericDateOrder(values: readonly string[]): NumericDateOrder {
	for (const value of values) {
		const match = NUMERIC_DATE.exec(value.trim());
		if (!match) continue;
		const first = Number(match[1]);
		const second = Number(match[2]);
		if (first > 12 && second <= 12) return 'day-first';
		if (second > 12 && first <= 12) return 'month-first';
	}
	return 'locale';
}

export function isValidDateFormat(format: string): boolean {
	const normalized = format.trim();
	return normalized.length > 0 && normalized.length <= 48 && /Y{2,4}|M{1,4}|D{1,2}/.test(normalized);
}

export function dateFormatPreview(format: string): string {
	return moment('2027-02-13', 'YYYY-MM-DD', true).format(format);
}

function resolveNumericOrder(first: number, second: number, requested: NumericDateOrder): Exclude<NumericDateOrder, 'locale'> {
	if (first > 12 && second <= 12) return 'day-first';
	if (second > 12 && first <= 12) return 'month-first';
	if (requested !== 'locale') return requested;
	const localeFormat = moment.localeData().longDateFormat('L').toLocaleUpperCase();
	return localeFormat.indexOf('D') < localeFormat.indexOf('M') ? 'day-first' : 'month-first';
}
