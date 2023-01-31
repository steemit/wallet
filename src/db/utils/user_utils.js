/* eslint-disable arrow-parens */
import config from 'config';
import models from 'db/models';
import { clearPendingRewardCache } from 'db/cache';
import { Model } from 'sequelize';
import { log } from 'server/utils/loggers';

const clearPendingClaimTronReward = function*(username) {
    const vestsPerTrx = Number(config.get('tron_reward.vests_per_trx'));
    let t1, t2;
    t1 = process.uptime() * 1000;
    const user = yield models.TronUser.findOne({
        where: {
            username,
        },
    });
    t2 = process.uptime() * 1000;
    log('[timer] clearPendingClaimTronReward findOne', { t: t2 - t1 });
    if (user) {
        t1 = process.uptime() * 1000;
        yield models.TronReward.update(
            {
                tron_addr: user.tron_addr,
            },
            {
                where: {
                    username,
                    tron_addr: null,
                    reward_type: 0,
                },
            }
        );
        t2 = process.uptime() * 1000;
        // clear redis cache
        yield clearPendingRewardCache(models.TronReward, username);
        log('[timer] clearPendingClaimTronReward transaction:', { t: t2 - t1 });
    }
};

const insertUserData = function*(data) {
    const t1 = process.uptime() * 1000;
    try {
        const result = yield models.TronUser.create(data);
        log('[timer] insertUserData:', {
            t: process.uptime() * 1000 - t1,
            result,
        });
        return true;
    } catch (e) {
        log('insertUserData failed:', { e });
        return false;
    }
};

const updateUserData = function*(username, data) {
    const t1 = process.uptime() * 1000;
    try {
        const user = yield models.TronUser.findOne({
            where: {
                username,
            },
        });
        if (!user) throw new Error('not_found_tron_user_when_updateUserData');
        const result = yield user.update(data);
        log('[timer] updateUserData:', {
            t: process.uptime() * 1000 - t1,
            result,
        });
        return true;
    } catch (e) {
        log('updateUserData failed:', { e });
        return false;
    }
};

module.exports = {
    clearPendingClaimTronReward,
    insertUserData,
    updateUserData,
};
