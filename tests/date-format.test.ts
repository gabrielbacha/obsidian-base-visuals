import { moment } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	dateFormatPreview,
	formatDateText,
	inferNumericDateOrder,
	isValidDateFormat,
	parseDateText,
} from '../src/core/date-format';

describe('date formatting', () => {
	let previousLocale: string;

	beforeEach(() => {
		previousLocale = moment.locale();
		moment.locale('en-gb');
	});

	afterEach(() => moment.locale(previousLocale));

	it('formats day-first rendered dates with presets and custom patterns', () => {
		expect(formatDateText('13/02/2027', 'DD MMM YYYY', 'day-first')).toBe('13 Feb 2027');
		expect(formatDateText('13/02/2027', 'MMM-YY', 'day-first')).toBe('Feb-27');
		expect(formatDateText('13/02/2027', 'MMM YYYY', 'day-first')).toBe('Feb 2027');
	});

	it('keeps ISO parsing unambiguous', () => {
		expect(formatDateText('2027-02-13', 'DD MMM YYYY', 'month-first')).toBe('13 Feb 2027');
	});

	it('infers numeric ordering from an unambiguous value in the column', () => {
		expect(inferNumericDateOrder(['02/03/2027', '13/02/2027'])).toBe('day-first');
		expect(inferNumericDateOrder(['02/13/2027', '03/04/2027'])).toBe('month-first');
		expect(inferNumericDateOrder(['02/03/2027'])).toBe('locale');
	});

	it('rejects invalid dates instead of guessing', () => {
		expect(parseDateText('31/02/2027', 'day-first')).toBeNull();
		expect(formatDateText('not a date', 'DD MMM YYYY')).toBeNull();
	});

	it('validates custom patterns and produces a stable preview', () => {
		expect(isValidDateFormat('DD MMM YYYY')).toBe(true);
		expect(isValidDateFormat('MMM-YY')).toBe(true);
		expect(isValidDateFormat('[quarter] Q YYYY')).toBe(true);
		expect(isValidDateFormat('plain text')).toBe(false);
		expect(dateFormatPreview('DD MMM YYYY')).toBe('13 Feb 2027');
	});
});
