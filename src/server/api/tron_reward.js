/* eslint-disable arrow-parens */
/* eslint-disable require-yield */
/* eslint-disable no-unused-vars */
import koa_router from 'koa-router';
import koa_body from 'koa-body';
import models from 'db/models';
import steem from '@steemit/steem-js';
import { getRecordCache, updateRecordCache } from 'db/cache';
import config from 'config';
import { logRequest } from 'server/utils/loggers';
import { getRemoteIp, rateLimitReq } from 'server/utils/misc';
import { unsignData } from 'server/utils/encrypted';
import { clearPendingClaimTronReward } from 'db/utils/user_utils';

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
        const q = this.request.query;
        if (!q) {
            this.body = JSON.stringify({ error: 'need_params' });
            return;
        }
        const username = q.username;
        const tronAddr = q.tron_addr;
        if (!username && !tronAddr) {
            this.body = JSON.stringify({
                error: 'need_username_or_tron_addr_param',
            });
            return;
        }

        const conditions = {};
        if (username) conditions.username = username;
        if (tronAddr) conditions.tron_addr = tronAddr;

        let tronUser = yield getRecordCache(
            models.TronUser,
            models.escAttrs(conditions)
        );
        if (tronUser === null) {
            // check if on chain
            try {
                const pubKey = yield getUserPublicKey(username);
                if (pubKey === null) {
                    // user does not exist on chain
                    this.body = JSON.stringify({ error: 'username_not_exist' });
                    return;
                }
            } catch (e) {
                this.body = JSON.stringify({ error: e.message });
                return;
            }
            // insert user data into db
            const insertData = {
                username,
            };
            try {
                yield models.TronUser.create(insertData);
                tronUser = yield getRecordCache(
                    models.TronUser,
                    models.escAttrs(conditions)
                );
            } catch (e) {
                this.body = JSON.stringify({ error: e.message });
                return;
            }
        }

        // during pending of transfering trx
        let pendingClaimTronReward = tronUser.pending_claim_tron_reward;
        if (this.session.pendingClaim !== undefined) {
            const now = parseInt(Date.now() / 1000, 10);
            if (now - this.session.pendingClaim > 60 * 15) {
                this.session.pendingClaim = undefined;
            } else {
                pendingClaimTronReward = '0 TRX';
            }
        }

        const result = {
            username: tronUser.username,
            tron_addr: tronUser.tron_addr,
            pending_claim_tron_reward: pendingClaimTronReward,
            tip_count: tronUser.tip_count,
        };
        this.body = JSON.stringify({ status: 'ok', result });
    });

    router.post('/tron_user', koaBody, function*() {
        const data = this.request.body;
        logRequest('tron_user', this, JSON.stringify(data));
        if (typeof data !== 'object') {
            this.body = JSON.stringify({
                error: 'valid_input_data',
            });
            return;
        }
        if (data.username === undefined) {
            this.body = JSON.stringify({
                error: 'username_required',
            });
            return;
        }
        // get public key
        const authType =
            data.auth_type !== undefined ? data.auth_type : 'posting';
        let pubKey = null;
        try {
            pubKey = yield getUserPublicKey(data.username, authType);
        } catch (e) {
            this.body = JSON.stringify({
                error: e.message,
            });
            return;
        }
        if (pubKey === null) {
            this.body = JSON.stringify({
                error: 'username_not_exist_on_chain',
            });
            return;
        }

        // auth
        try {
            if (!unsignData(data, pubKey)) {
                this.body = JSON.stringify({
                    error: 'data_is_invalid',
                });
                return;
            }
        } catch (e) {
            this.body = JSON.stringify({
                error: e.message,
            });
            return;
        }

        // find user in db
        const conditions = { username: data.username };
        const tronUser = yield getRecordCache(
            models.TronUser,
            models.escAttrs(conditions)
        );
        if (tronUser === null) {
            this.body = JSON.stringify({ error: 'user_not_exist' });
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
            // update db
            yield models.TronUser.update(updateData, {
                where: models.escAttrs(conditions),
            });
            // update redis cache
            yield updateRecordCache(
                models.TronUser,
                models.escAttrs(conditions),
                updateData
            );
        }

        // when update tron_addr, check if pending_claim_tron_reward empty
        if (data.tron_addr) {
            clearPendingClaimTronReward(tronUser.username);
        }

        // because the delay of transfering trx,
        // need set an temporary var to make pending_amount 0
        if (data.claim_reward !== undefined) {
            this.session.pendingClaim = parseInt(Date.now() / 1000, 10);
        }

        this.body = JSON.stringify({ status: 'ok' });
    });
}

async function getUserPublicKey(username, authType = 'posting') {
    const user = await steem.api.getAccountsAsync([username]);
    if (user.length === 0) return null;
    if (user[0][authType] === undefined) return null;
    return user[0][authType].key_auths[0][0];
}
