/* eslint-disable no-restricted-syntax */
/* eslint-disable no-unused-vars */
/* eslint-disable vars-on-top */
/* eslint-disable no-var */
import path from 'path';
import fs from 'fs';
import { esc } from 'db/models';
import { auth } from '@steemit/steem-js';
import { Signature, PublicKey } from '@steemit/steem-js/lib/auth/ecc';
import { randomBytes } from 'crypto';

const emailRegex = /^([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x22([^\x0d\x22\x5c\x80-\xff]|\x5c[\x00-\x7f])*\x22)(\x2e([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x22([^\x0d\x22\x5c\x80-\xff]|\x5c[\x00-\x7f])*\x22))*\x40([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x5b([^\x0d\x5b-\x5d\x80-\xff]|\x5c[\x00-\x7f])*\x5d)(\x2e([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x5b([^\x0d\x5b-\x5d\x80-\xff]|\x5c[\x00-\x7f])*\x5d))*$/;
const DATA_TIMEOUT = 60 * 2; // second

function getRemoteIp(req) {
    const remote_address =
        req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const ip_match = remote_address
        ? remote_address.match(/(\d+\.\d+\.\d+\.\d+)/)
        : null;
    return ip_match ? ip_match[1] : esc(remote_address);
}

var ip_last_hit = new Map();
function rateLimitReq(ctx, req) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const now = Date.now();

    // purge hits older than minutes_max
    ip_last_hit.forEach((v, k) => {
        const seconds = (now - v) / 1000;
        if (seconds > 1) {
            ip_last_hit.delete(ip);
        }
    });

    let result = false;
    // if ip is still in the map, abort
    if (ip_last_hit.has(ip)) {
        // console.log(`api rate limited for ${ip}: ${req}`);
        // throw new Error(`Rate limit reached: one call per ${minutes_max} minutes allowed.`);
        console.error(`Rate limit reached: one call per 1 second allowed.`);
        ctx.status = 429;
        ctx.body = 'Too Many Requests';
        result = true;
    }

    // record api hit
    ip_last_hit.set(ip, now);
    return result;
}

function checkCSRF(ctx, csrf) {
    try {
        ctx.assertCSRF(csrf);
    } catch (e) {
        ctx.status = 403;
        ctx.body = 'invalid csrf token';
        console.log(
            '-- invalid csrf token -->',
            ctx.request.method,
            ctx.request.url,
            ctx.session.uid
        );
        return false;
    }
    return true;
}

function getSupportedLocales() {
    const locales = [];
    const files = fs.readdirSync(
        path.join(__dirname, '../../..', 'src/app/locales')
    );
    for (const filename of files) {
        const match_res = filename.match(/(\w+)\.json?$/);
        if (match_res) locales.push(match_res[1]);
    }
    return locales;
}

function signData(data, privKey) {
    let d = '';
    if (typeof data === 'string') d = data;
    if (typeof data === 'object') d = JSON.stringify(data);
    if (!auth.isWif(privKey)) {
        throw new Error('unexpected_private_key');
    }

    const nonce = randomBytes(8).toString('hex');
    const timestamp = getUtcTimestamp();

    const sign = Signature.sign(`${d}${nonce}${timestamp}`, privKey);
    const signature = sign.toHex();
    return {
        ...data,
        nonce,
        timestamp,
        signature,
    };
}

function unsignData(data, pubKey) {
    const { nonce, timestamp, signature } = data;
    const currentTimestamp = getUtcTimestamp();
    if (nonce === undefined) {
        throw new Error('lost_nonce');
    }
    if (timestamp === undefined) {
        throw new Error('lost_timestamp');
    }
    if (signature === undefined) {
        throw new Error('lost_signature');
    }
    if (currentTimestamp - timestamp > DATA_TIMEOUT) {
        throw new Error('data_timeout');
    }
    const d = JSON.stringify(data, (k, v) => {
        if (['nonce', 'timestamp', 'signature'].indexOf(k) === -1) {
            return v;
        }
        return undefined;
    });
    const msg = new Buffer(`${d}${nonce}${timestamp}`);
    const sign = Signature.fromHex(signature);
    return sign.verifyBuffer(msg, PublicKey.fromString(pubKey));
}

function getUtcTimestamp() {
    const now = new Date();
    const utcTimestamp = Date.UTC(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
        now.getMilliseconds()
    );
    return `${parseInt(utcTimestamp / 1000, 10)}`;
}

module.exports = {
    emailRegex,
    getRemoteIp,
    rateLimitReq,
    checkCSRF,
    getSupportedLocales,
    signData,
    unsignData,
};
