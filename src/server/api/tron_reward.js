/* eslint-disable arrow-parens */
/* eslint-disable require-yield */
/* eslint-disable no-unused-vars */
import koa_router from 'koa-router';
import koa_body from 'koa-body';
import models from 'db/models';
import steem from '@steemit/steem-js';
import {
    getRecordCache2,
    updateRecordCache2,
    clearRecordCache2,
} from 'db/cache';
import config from 'config';
import { logRequest, log } from 'server/utils/loggers';
import { getRemoteIp, rateLimitReq } from 'server/utils/misc';
import { authData } from '@steemfans/auth-data';
import {
    clearPendingClaimTronReward,
    insertUserData,
    updateUserData,
} from 'db/utils/user_utils';

export default function useTronRewardApi(app) {
    const router = koa_router({ prefix: '/api/v1/tron' });
    app.use(router.routes());
    const koaBody = koa_body();

    router.get('/get_config', function*() {
        // if (rateLimitReq(this, this.req)) return;
        try {
            const result = {};
            result.tron_reward_switch = config.get('tron_reward.switch');
            result.vests_per_trx = config.get('tron_reward.vests_per_trx');
            result.unbind_tip_limit = config.get(
                'tron_reward.unbind_tip_limit'
            );
            this.body = JSON.stringify({ status: 'ok', result });
        } catch (e) {
            logRequest('/api/v1/tron/get_config', this, { msg: e.message });
            this.body = JSON.stringify({ error: e.message });
        }
    });

    router.get('/tron_user', function*() {
        const t1 = process.uptime() * 1000;
        const q = this.request.query;
        if (!q) {
            this.body = JSON.stringify({ error: 'need_params' });
            log('[timer] get /tron_user all', {
                t: process.uptime() * 1000 - t1,
            });
            return;
        }
        const username = q.username;
        const tronAddr = q.tron_addr;
        if (!username && !tronAddr) {
            this.body = JSON.stringify({
                error: 'need_username_or_tron_addr_param',
            });
            log('[timer] get /tron_user all', {
                t: process.uptime() * 1000 - t1,
            });
            return;
        }

        const conditions = {};
        if (username) conditions.username = username;
        if (tronAddr) conditions.tron_addr = tronAddr;

        let tronUser = yield getRecordCache2(
            models.TronUser,
            models.escAttrs(conditions)
        );
        // let tronUser = null
        if (tronUser === null) {
            // check if on chain
            try {
                const pubKeys = yield getUserPublicKey(username);
                if (pubKeys.length === 0) {
                    // user does not exist on chain
                    this.body = JSON.stringify({ error: 'username_not_exist' });
                    log('[timer] get /tron_user all', {
                        t: process.uptime() * 1000 - t1,
                    });
                    return;
                }
            } catch (e) {
                this.body = JSON.stringify({ error: e.message });
                log('[timer] get /tron_user all', {
                    t: process.uptime() * 1000 - t1,
                });
                return;
            }
            // insert user data into db
            const insertData = {
                username,
            };
            try {
                yield models.TronUser.create(insertData);
                tronUser = yield getRecordCache2(
                    models.TronUser,
                    models.escAttrs(conditions)
                );
            } catch (e) {
                this.body = JSON.stringify({ error: e.message });
                log('[timer] get /tron_user all', {
                    t: process.uptime() * 1000 - t1,
                });
                return;
            }
        }

        const result = {
            username: tronUser.username,
            tron_addr: tronUser.tron_addr,
            pending_claim_tron_reward: tronUser.pending_claim_tron_reward,
            tip_count: tronUser.tip_count,
        };

        this.body = JSON.stringify({ status: 'ok', result });
        log('[timer] get /tron_user all', { t: process.uptime() * 1000 - t1 });
    });

    router.post('/tron_user', koaBody, function*() {
        const t1 = process.uptime() * 1000;
        const data =
            typeof this.request.body === 'string'
                ? JSON.parse(this.request.body)
                : this.request.body;
        log('[post:/tron_user]input data:', { data });
        if (typeof data !== 'object') {
            this.body = JSON.stringify({
                error: 'valid_input_data',
            });
            log('[timer] post /tron_user all', {
                t: process.uptime() * 1000 - t1,
            });
            return;
        }
        if (data.username === undefined) {
            this.body = JSON.stringify({
                error: 'username_required',
            });
            log('[timer] post /tron_user all', {
                t: process.uptime() * 1000 - t1,
            });
            return;
        }
        // get public key
        const authType =
            data.auth_type !== undefined ? data.auth_type : 'posting';
        let pubKeys = [];
        try {
            pubKeys = yield getUserPublicKey(data.username, authType);
        } catch (e) {
            this.body = JSON.stringify({
                error: e.message,
            });
            log('[timer] post /tron_user all', {
                t: process.uptime() * 1000 - t1,
            });
            return;
        }
        if (pubKeys.length === 0) {
            this.body = JSON.stringify({
                error: 'username_not_exist_on_chain',
            });
            log('[timer] post /tron_user all', {
                t: process.uptime() * 1000 - t1,
            });
            return;
        }

        // auth
        try {
            const isDataInvalid = pubKeys.every(pubKey => {
                if (authData(data, pubKey)) {
                    log('[timer] post /tron_user all', {
                        t: process.uptime() * 1000 - t1,
                    });
                    return false;
                }
                log('[timer] post /tron_user all', {
                    t: process.uptime() * 1000 - t1,
                });
                return true;
            });
            if (isDataInvalid === true) {
                this.body = JSON.stringify({
                    error: 'data_is_invalid',
                });
                log('[timer] post /tron_user all', {
                    t: process.uptime() * 1000 - t1,
                });
                return;
            }
        } catch (e) {
            this.body = JSON.stringify({
                error: e.message,
            });
            log('[timer] post /tron_user all', {
                t: process.uptime() * 1000 - t1,
            });
            return;
        }

        // find user in db
        const conditions = { username: data.username };
        const tronUser = yield getRecordCache2(
            models.TronUser,
            models.escAttrs(conditions)
        );
        if (tronUser === null) {
            this.body = JSON.stringify({ error: 'user_not_exist' });
            log('[timer] post /tron_user all', {
                t: process.uptime() * 1000 - t1,
            });
            return;
        }

        // update data
        const updateData = {};
        const availableUpdateFields = ['tron_addr', 'tip_count'];
        Object.keys(data).forEach(k => {
            if (availableUpdateFields.indexOf(k) !== -1) {
                updateData[k] = data[k];
            }
        });
        if (Object.keys(updateData).length > 0) {
            // update avtive field
            updateData.is_tron_addr_actived = 0;
            updateData.tron_addr_active_time = null;
            // update db
            yield models.TronUser.update(updateData, {
                where: models.escAttrs(conditions),
            });
            // update redis cache
            yield updateRecordCache2(
                models.TronUser,
                models.escAttrs(conditions)
            );
        }

        // when update tron_addr, check if pending_claim_tron_reward empty
        if (data.tron_addr) {
            try {
                clearPendingClaimTronReward(tronUser.username);
            } catch (e) {
                this.body = JSON.stringify({
                    error: e.message,
                });
                log('[timer] post /tron_user all', {
                    t: process.uptime() * 1000 - t1,
                    e,
                });
                return;
            }
        }

        this.body = JSON.stringify({ status: 'ok' });
        log('[timer] post /tron_user all', { t: process.uptime() * 1000 - t1 });
    });

    /**
     * !!!! This API MUST NOT USE in the frontend !!!!
     * data = {
     *   internal_api_token: '',
     *   data_from: '', // faucet, tron-reward
     *   method: 'insert|update',
     *   username: '',
     *   will_update_data: {},
     * }
     */
    router.post('/tron_user_from_internal', koaBody, function*() {
        const t1 = process.uptime() * 1000;
        const data =
            typeof this.request.body === 'string'
                ? JSON.parse(this.request.body)
                : this.request.body;
        console.log('input data:::', data);
        const internalApiToken = config.get('internal_api_token');
        // check if set env
        if (!internalApiToken || internalApiToken === 'xxxx') {
            this.body = JSON.stringify({ error: 'not_set_internal_api_token' });
            log('[timer] post /tron_user_from_internal all', {
                t: process.uptime() * 1000 - t1,
                data_from: data.data_from,
            });
            return;
        }
        // check if token correct
        if (
            !data.internal_api_token ||
            data.internal_api_token !== internalApiToken
        ) {
            this.body = JSON.stringify({ error: 'internal_api_token_error' });
            log('[timer] post /tron_user_from_internal all', {
                t: process.uptime() * 1000 - t1,
                data_from: data.data_from,
            });
            return;
        }

        if (['insert', 'update'].indexOf(data.method) === -1) {
            this.body = JSON.stringify({ error: 'method_is_incorrect' });
            log('[timer] post /tron_user_from_internal all', {
                t: process.uptime() * 1000 - t1,
                data_from: data.data_from,
            });
            return;
        }

        let result;
        if (data.method === 'insert') {
            if (!data.will_update_data.username) {
                this.body = JSON.stringify({ error: 'username_not_exist' });
                log('[timer] post /tron_user_from_internal all', {
                    t: process.uptime() * 1000 - t1,
                    data_from: data.data_from,
                });
                return;
            }
            const willInsertData = {
                username: data.will_update_data.username,
            };
            const allNotNullFields = {
                tron_addr: null,
                is_new_user: 0,
                pending_claim_tron_reward: 0,
                is_tron_addr_actived: 0,
                tip_count: 0,
            };
            Object.keys(allNotNullFields).forEach(field => {
                if (Object.keys(data.will_update_data).indexOf(field) === -1) {
                    willInsertData[field] = allNotNullFields[field];
                } else {
                    willInsertData[field] = data.will_update_data[field];
                }
            });
            result = yield insertUserData(willInsertData);
        } else if (data.method === 'update') {
            result = yield updateUserData(data.username, data.will_update_data);
        }

        this.body = JSON.stringify({ status: 'ok' });
        log('[timer] post /tron_user_from_internal all', {
            t: process.uptime() * 1000 - t1,
            data_from: data.data_from,
        });
    });

    router.post('/claim_pending_trx_reward', koaBody, function*() {
        const t1 = process.uptime() * 1000;
        const data =
            typeof this.request.body === 'string'
                ? JSON.parse(this.request.body)
                : this.request.body;
        log('[post:/claim_pending_trx_reward]input data:', { data });
        if (typeof data !== 'object') {
            this.body = JSON.stringify({
                error: 'valid_input_data',
            });
            log('[timer] post /claim_pending_trx_reward all', {
                t: process.uptime() * 1000 - t1,
                e: 'valid_input_data',
            });
            return;
        }
        if (data.username === undefined) {
            this.body = JSON.stringify({
                error: 'username_required',
            });
            log('[timer] post /claim_pending_trx_reward all', {
                t: process.uptime() * 1000 - t1,
                e: 'username_required',
            });
            return;
        }
        try {
            const user = getRecordCache2(
                models.TronUser,
                models.escAttrs({ username: data.username })
            );
            if (user) {
                yield clearPendingClaimTronReward(data.username);
            }
            this.body = JSON.stringify({
                status: 'ok',
            });
            log('[timer] post /claim_pending_trx_reward all', {
                t: process.uptime() * 1000 - t1,
            });
        } catch (e) {
            this.body = JSON.stringify({
                error: e.message,
            });
            log('[timer] post /claim_pending_trx_reward all', {
                t: process.uptime() * 1000 - t1,
                e,
            });
        }
    });

    /**
     * !!!! This API MUST NOT USE in the frontend !!!!
     */
    router.get('/clear_cache', function*() {
        const q = this.request.query;
        if (!q) {
            this.body = JSON.stringify({ error: 'need_params' });
            return;
        }
        const token = q.token;
        const cacheType = q.type;
        const data = q.data;
        if (!token && !cacheType && !data) {
            this.body = JSON.stringify({
                error: 'params_error',
            });
            return;
        }
        const internalApiToken = config.get('internal_api_token');
        // check if set env
        if (!internalApiToken || internalApiToken === 'xxxx') {
            this.body = JSON.stringify({ error: 'not_set_internal_api_token' });
            return;
        }
        // check if token correct
        if (token !== internalApiToken) {
            this.body = JSON.stringify({ error: 'internal_api_token_error' });
            return;
        }

        if (cacheType === 'user') {
            yield clearRecordCache2(models.TronUser, { username: data });
        }
        this.body = JSON.stringify({ status: 'ok' });
    });
}

async function getUserPublicKey(username, authType = 'posting') {
    const t1 = process.uptime() * 1000;
    const users = await steem.api.getAccountsAsync([username]);
    log('[timer] getUserPublicKey:', { t: process.uptime() * 1000 - t1 });
    if (users.length === 0) return [];
    if (authType === 'memo' && users[0]['memo_key'])
        return [users[0]['memo_key']];
    if (users[0][authType] === undefined) return [];
    const result = [];
    users[0][authType].key_auths.forEach((v, i) => {
        result.push(users[0][authType].key_auths[i][0]);
    });
    return result;
}
