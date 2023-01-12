/* eslint-disable arrow-parens */
import config from 'config';
import models from 'db/models';
import { updateRecordCache2 } from 'db/cache';
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
    if (user && user.getDataValue('pending_claim_tron_reward') > 0) {
        const pendingClaimTronReward =
            user.getDataValue('pending_claim_tron_reward') / 1e6;
        log('[DEBUG_TRX_REWARD]', {
            pendingClaimTronReward,
            vestsPerTrx,
        });
        // transaction
        t1 = process.uptime() * 1000;
        yield models.sequelize.transaction().then(transaction => {
            // clear pending_claim_tron_reward
            return user
                .update(
                    {
                        pending_claim_tron_reward: 0,
                    },
                    {
                        transaction,
                    }
                )
                .then(() =>
                    models.TronReward.create(
                        {
                            username,
                            tron_addr: user.get('tron_addr'),
                            block_num: 0,
                            steem_tx_id: '',
                            reward_vests: `${pendingClaimTronReward *
                                vestsPerTrx} VESTS`,
                            reward_steem: '0 STEEM',
                            reward_sbd: '0 SBD',
                            vests_per_steem: 0,
                            reward_type: 1,
                        },
                        {
                            transaction,
                        }
                    )
                )
                .then(() => transaction.commit())
                .catch(err => {
                    transaction.rollback();
                    log('clear_pending_claim_tron_reward_error:', {
                        msg: err.message,
                    });
                });
        });
        t2 = process.uptime() * 1000;
        log('[timer] clearPendingClaimTronReward transaction:', { t: t2 - t1 });
        t1 = process.uptime() * 1000;
        yield updateRecordCache2(
            models.TronUser,
            models.escAttrs({ username })
        );
        log('[timer] clearPendingClaimTronReward updateRecordCache2:', {
            t: process.uptime() * 1000 - t1,
        });
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
