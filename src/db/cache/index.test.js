/* eslint-disable no-undef */
import { parseResultToArr, parseNullToEmptyString } from 'db/cache';

describe('DB Cache', () => {
    it('test parseResultToArr function', () => {
        const result = { a: 1, b: 2 };
        const result2 = parseResultToArr(result);
        expect(result2.sort()).toEqual(['a', 1, 'b', 2].sort());
    });
    it('test parseResultToArr, convert null to empty string', () => {
        const result = { a: null };
        const result2 = parseResultToArr(result);
        expect(result2[1]).toEqual('');
    });
    it('test parseNullToEmptyString function', () => {
        const result = { a: null };
        const result2 = parseNullToEmptyString(result);
        expect(result2.a).toEqual('');
    });
});
