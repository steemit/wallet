/* eslint-disable require-yield */
/* eslint-disable no-unused-vars */
import koa_router from 'koa-router';
import koa_body from 'koa-body';
import models from 'db/models';
import { getRecordCache } from 'db/cache';
import config from 'config';
import { logRequest } from 'server/utils/loggers';
import { getRemoteIp, rateLimitReq } from 'server/utils/misc';
import { broadcast } from '@steemit/steem-js';

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

        const tronUser = yield getRecordCache(
            models.TronUser,
            models.escAttrs(conditions)
        );
        if (tronUser === null) {
            this.body = JSON.stringify({ error: 'username_not_exist' });
            return;
        }
        const result = {
            username: tronUser.username,
            tron_addr: tronUser.tron_addr,
            pending_claim_tron_reward: tronUser.pending_claim_tron_reward,
            tip_count: tronUser.tip_count,
        };
        this.body = JSON.stringify({ status: 'ok', result });
    });
}
