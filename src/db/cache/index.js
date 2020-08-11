/* eslint-disable arrow-parens */
/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
import config from 'config';
import { createClient } from 'redis';
import { promisify } from 'util';
import { log } from 'server/utils/loggers';

const env = process.env.NODE_ENV || 'development';
const EXPIRED_TIME = 60 * 5; // second
const redisUrl = config.get('redis_url');
const client = new createClient({ url: redisUrl });
const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);
const hgetallAsync = promisify(client.hgetall).bind(client);
const hmsetAsync = promisify(client.hmset).bind(client);
const hgetAsync = promisify(client.hget).bind(client);
const hsetAsync = promisify(client.hset).bind(client);
const expireAsync = promisify(client.expire).bind(client);

client.on('error', err => {
    console.error('redis_error:', err.code);
});

function* getRecordCache(
    model,
    conditions = {},
    field = null,
    cacheAll = true
) {
    if (!model) {
        return null;
    }
    if (conditions === {}) {
        return null;
    }

    const keyPrefix = model.getCachePrefix();
    const fields = model.getCacheFields();
    const conditionsStr = parseResultToArr(conditions).join('_');
    const cacheKey = `${keyPrefix}${conditionsStr}_${
        cacheAll ? '_all_fields' : ''
    }`;
    let result;
    try {
        // get all items
        if (!field) {
            result =
                env === 'production'
                    ? yield hgetallAsync(cacheKey)
                    : log('getRecordCache', { msg: 'non_production' });
            if (!result) {
                // not hit cache
                log('getRecordCache', {
                    msg: 'not_hit_get_all_item_cache',
                    cacheKey,
                });
                const dbOptions = {
                    where: conditions,
                };
                if (cacheAll === false) {
                    dbOptions.attributes = fields;
                }
                result = yield model.findOne(dbOptions);
                if (!result) return null;
                result = result.get();
                if (env === 'production') {
                    yield hmsetAsync(cacheKey, ...parseResultToArr(result));
                    yield expireAsync([cacheKey, EXPIRED_TIME]);
                } else {
                    log('getRecordCache', { msg: 'non_production' });
                }
            }
            return result;
        }
        // get one item
        if (cacheAll === false) {
            if (fields.indexOf(field) === -1) {
                return null;
            }
        }
        result =
            env === 'production'
                ? yield hgetAsync(cacheKey, field)
                : log('getRecordCache', { msg: 'non_production' });
        if (!result) {
            // not hit cache
            log('getRecordCache', {
                msg: 'not_hit_get_one_item_cache',
                cacheKey,
            });
            const dbOptions = {
                where: conditions,
            };
            if (cacheAll === false) {
                dbOptions.attributes = fields;
            }
            result = yield model.findOne(dbOptions);
            if (!result) return null;
            result = result.get();
            if (env === 'production') {
                yield hmsetAsync(cacheKey, ...parseResultToArr(result));
                yield expireAsync([cacheKey, EXPIRED_TIME]);
            } else {
                log('getRecordCache', { msg: 'non_production' });
            }
        }
        return result;
    } catch (e) {
        log('getRecordCache', { msg: e.message, cacheKey });
        return null;
    }
}

function parseResultToArr(result = {}) {
    const nResult = [];
    Object.keys(result).forEach(k => {
        nResult.push(k);
        nResult.push(result[k]);
    });
    return nResult;
}

function* updateRecordCache(
    model,
    conditions = {},
    data = [],
    cacheAll = true
) {
    if (env !== 'production') {
        log('updateRecordCache', { msg: 'non_production' });
        return false;
    }
    if (conditions.length <= 0) return false;
    const keyPrefix = model.getCachePrefix();
    const conditionsStr = parseResultToArr(conditions).join('_');
    const cacheKey = `${keyPrefix}${conditionsStr}_${
        cacheAll ? '_all_fields' : ''
    }`;
    try {
        if (data !== []) {
            yield hmsetAsync(cacheKey, ...data);
            yield expireAsync([cacheKey, EXPIRED_TIME]);
        }
        return true;
    } catch (e) {
        log('updateRecordCache', { msg: e.message, cacheKey });
        return false;
    }
}

module.exports = {
    getRecordCache,
    updateRecordCache,
    parseResultToArr,
};
