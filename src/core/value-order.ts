export function leadingOrderNumber(value: string): number | null {
	const match = /^\s*(\d+)(?=\s|[.):\]-])/u.exec(value);
	if (!match?.[1]) return null;
	const number = Number.parseInt(match[1], 10);
	return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function compareNaturalValues(first: string, second: string): number {
	return first.localeCompare(second, undefined, {
		numeric: true,
		sensitivity: 'base',
	});
}
