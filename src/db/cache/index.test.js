/* eslint-disable no-undef */
import { parseResultToArr } from 'db/cache';

describe('DB Cache', () => {
    it('test parseResultToArr function', () => {
        const result = { a: 1, b: 2 };
        const result2 = parseResultToArr(result);
        expect(result2.sort()).toEqual(['a', 1, 'b', 2].sort());
    });
});
